/**
 * tournament-leaderboard.ts — Tournament Leaderboard System (SPEC-018,
 * Phase-1 in-memory version).
 *
 * ONE INSTANCE PER TOURNAMENT. The Leaderboard is a derived PROJECTION of
 * player ranking — a VIEW of the match state, never the source of truth
 * (SPEC-018 "Filosofía"). The single source of truth for points is always the
 * Economy System (SPEC-011). This engine NEVER calculates, corrects, modifies
 * or awards points: it consumes EXCLUSIVELY the `WalletUpdated` event
 * (SPEC-018 "Fuente de datos"), takes the balance the event carries and
 * reorders positions. It never touches Economy, Runtime, Board, Shop,
 * Inventory, Boss or Gambling (SPEC-018 "Restricciones").
 *
 * It listens; it does not poll (SPEC-018 "Actualización"). The subscription is
 * created on construction and released by `dispose()`.
 *
 * Ranking (SPEC-018 "Criterio principal"/"Desempates"): `points` DESC, with
 * standard competition ranking — equal points SHARE a position and the next
 * distinct group skips by the count of tied players (1,2,2,4). There is NO
 * secondary tiebreaker for the POSITION. For a deterministic array ORDER among
 * equal-points players we present them by `playerId` ascending — this is
 * presentation order only, never a ranking criterion.
 *
 * Determinism (SPEC-028): no `Math.random`, no `Date.now`. Timestamps come
 * exclusively from the injected TournamentClock. Pattern mirrors
 * tournament-runtime.ts / tournament-economy.ts: constructor takes
 * bus/clock/logger, emits via `createTournamentEvent(...)` cast to
 * `AnyTournamentEvent`, and exposes a JSON-safe `serialize()` for embedding in
 * the Runtime snapshot.
 */

import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	LeaderboardEntryPayload,
	TournamentEvent,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";

// ── Owned domain types ─────────────────────────────────────────────────────

/**
 * One ranked player (SPEC-018 "Entry"). `position` uses standard competition
 * ranking (ties share, next group skips). JSON-safe by construction.
 */
export interface LeaderboardEntry {
	readonly playerId: number;
	readonly position: number;
	readonly points: number;
}

/** Complete point-in-time ranking (SPEC-018 "Snapshot"). */
export interface LeaderboardSnapshot {
	readonly tournamentId: string;
	/** `clock.now()` at snapshot time (never `Date.now`). */
	readonly timestamp: number;
	readonly entries: readonly LeaderboardEntry[];
}

/** JSON-safe serialized form for embedding in the Runtime snapshot. */
export interface LeaderboardSerialized {
	readonly tournamentId: string;
	/** True once `generateFinal` has frozen the ranking. */
	readonly frozen: boolean;
	readonly entries: readonly LeaderboardEntry[];
}

export interface TournamentLeaderboardOptions {
	readonly tournamentId: string;
	readonly bus: TournamentEventBus;
	/** Participant user ids; one entry is seeded per id at 0 points. */
	readonly participantIds: readonly number[];
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	/** Current tournament round for event envelopes; 0 when omitted. */
	readonly getRound?: () => number;
}

/** Mutable internal entry; `LeaderboardEntry` is its immutable projection. */
interface EntryState {
	readonly playerId: number;
	points: number;
	position: number;
}

/** Sentinel `previousPosition` for a player not previously in the ranking. */
const UNRANKED_POSITION = 0;

export class TournamentLeaderboard {
	private readonly tournamentId: string;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly getRound: () => number;

	private readonly entries = new Map<number, EntryState>();
	private readonly unsubscribe: () => void;

	/** True once `generateFinal` froze the ranking (SPEC-018 "Final Challenge"). */
	private frozen = false;
	/** Cached final snapshot so a second `generateFinal` is a no-op. */
	private finalSnapshot: LeaderboardSnapshot | null = null;

	constructor(options: TournamentLeaderboardOptions) {
		this.tournamentId = options.tournamentId;
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("Leaderboard") ??
			new TournamentLogger({
				tournamentId: this.tournamentId,
				system: "Leaderboard",
			});
		this.getRound = options.getRound ?? (() => 0);

		// Seed one entry per participant at 0 points (SPEC-018 "Fuente de datos":
		// points come from WalletUpdated — seed at 0 and let the first
		// WalletUpdated set the real balance). Initially all tied at position 1.
		for (const playerId of options.participantIds) {
			if (!this.entries.has(playerId)) {
				this.entries.set(playerId, { playerId, points: 0, position: 0 });
			}
		}
		this.recomputePositions();

		// Subscribe on construction; never poll (SPEC-018 "Actualización").
		this.unsubscribe = this.bus.on("WalletUpdated", (event) =>
			this.onWalletUpdated(event),
		);
	}

	// ── Event handling (SPEC-018 "Pipeline") ────────────────────────────────

	/**
	 * WalletUpdated → update entry → recompute positions → diff → emit
	 * LeaderboardUpdated (full ranking) + one PlayerPositionChanged per player
	 * whose position actually changed (SPEC-018 "Pipeline"). The balance is
	 * taken verbatim from the event (SPEC-018 "Fuente de datos": never compute
	 * or correct). Ignored entirely once the ranking is frozen (SPEC-018
	 * "Integración con Final Challenge").
	 */
	private onWalletUpdated(event: TournamentEvent<"WalletUpdated">): void {
		if (this.frozen) {
			return;
		}
		const playerId = event.playerId;
		if (playerId === null) {
			// WalletUpdated always targets a concrete wallet; a null playerId is
			// a contract violation upstream — log and ignore, never throw.
			this.logger.warn("WalletUpdated without a playerId ignored");
			return;
		}

		const points = event.payload.currentPoints;
		let entry = this.entries.get(playerId);
		if (!entry) {
			// Defensive add (SPEC-018 "Casos límite"): an unknown player is added
			// to the ranking rather than dropped; never throw.
			this.logger.warn("WalletUpdated for an unknown player: adding to ranking", {
				playerId,
				metadata: { currentPoints: points },
			});
			entry = { playerId, points, position: UNRANKED_POSITION };
			this.entries.set(playerId, entry);
		} else {
			entry.points = points;
		}

		// Capture positions BEFORE recompute to diff against (SPEC-018 "Compare
		// Previous Ranking"). A freshly added player is absent here → treated as
		// previously UNRANKED.
		const previous = new Map<number, number>();
		for (const state of this.entries.values()) {
			previous.set(state.playerId, state.position);
		}

		this.recomputePositions();

		this.emit("LeaderboardUpdated", null, {
			entries: this.projectOrdered(),
		});

		// One PlayerPositionChanged per player whose position actually changed
		// (SPEC-018 "Emitir cambios de posición"), deterministic playerId order.
		for (const state of this.orderedStates()) {
			const before = previous.get(state.playerId) ?? UNRANKED_POSITION;
			if (before !== state.position) {
				this.emit("PlayerPositionChanged", state.playerId, {
					previousPosition: before,
					newPosition: state.position,
					points: state.points,
				});
			}
		}
	}

	// ── Read-only observation (SPEC-018 "Integración con Runtime") ───────────

	/**
	 * Point-in-time ranking (SPEC-018 "Snapshot"). Timestamp from `clock.now()`.
	 * Returns the frozen final ranking once `generateFinal` has run.
	 */
	snapshot(): LeaderboardSnapshot {
		if (this.frozen && this.finalSnapshot) {
			return this.finalSnapshot;
		}
		return {
			tournamentId: this.tournamentId,
			timestamp: this.clock.now(),
			entries: this.projectOrdered(),
		};
	}

	/**
	 * Ordered, immutable ranking for Runtime queries (SPEC-018 "Integración con
	 * Runtime": the Runtime may consult the Leaderboard; the Leaderboard never
	 * modifies the Runtime).
	 */
	getEntries(): readonly LeaderboardEntry[] {
		return this.projectOrdered();
	}

	/** Current position of a player, or undefined if not in the ranking. */
	getPosition(playerId: number): number | undefined {
		return this.entries.get(playerId)?.position;
	}

	/** JSON-safe snapshot (entries + frozen flag) for the Runtime snapshot. */
	serialize(): LeaderboardSerialized {
		return {
			tournamentId: this.tournamentId,
			frozen: this.frozen,
			entries: this.projectOrdered(),
		};
	}

	// ── Final Challenge (SPEC-018 "Integración con Final Challenge") ─────────

	/**
	 * FREEZES the ranking: subsequent WalletUpdated events are ignored and the
	 * ranking stops updating (SPEC-018 "Integración con Final Challenge").
	 *
	 * If `shellHolderId` is provided, that player is 1st regardless of points
	 * and everyone else follows by points DESC (standard competition ranking
	 * starting at position 2). If null/omitted (collective DEFEAT, SPEC-001),
	 * the order is pure points DESC. Emits FinalLeaderboardGenerated.
	 *
	 * Idempotent: a second call while already frozen is a no-op that re-emits
	 * nothing and returns the cached final snapshot.
	 */
	generateFinal(shellHolderId: number | null = null): LeaderboardSnapshot {
		if (this.frozen) {
			this.logger.warn("generateFinal called on an already-frozen leaderboard: no-op");
			return this.finalSnapshot ?? this.snapshot();
		}

		if (shellHolderId !== null && !this.entries.has(shellHolderId)) {
			// Defensive: an unknown shell holder is still seated 1st (mirrors the
			// unknown-player policy) rather than being ignored.
			this.logger.warn("generateFinal shell holder unknown: adding to ranking", {
				playerId: shellHolderId,
			});
			this.entries.set(shellHolderId, {
				playerId: shellHolderId,
				points: 0,
				position: UNRANKED_POSITION,
			});
		}

		this.frozen = true;
		this.applyFinalPositions(shellHolderId);

		this.finalSnapshot = {
			tournamentId: this.tournamentId,
			timestamp: this.clock.now(),
			entries: this.projectOrdered(shellHolderId),
		};

		this.emit("FinalLeaderboardGenerated", null, {
			entries: this.finalSnapshot.entries,
			shellHolderId,
		});

		return this.finalSnapshot;
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	/** Releases the WalletUpdated subscription (avoids listener leaks). */
	dispose(): void {
		this.unsubscribe();
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/**
	 * Assigns standard competition ranking over all entries (SPEC-018
	 * "Desempates"): sort by points DESC, ties share a position, next distinct
	 * group's position = 1 + number of players strictly ahead.
	 */
	private recomputePositions(): void {
		this.assignPositions(this.sortedByPoints([...this.entries.values()]), 1);
	}

	/**
	 * Final positions (SPEC-018 "Integración con Final Challenge"). With a shell
	 * holder: holder is position 1, the rest ranked among themselves starting
	 * at position 2. Without: pure competition ranking from position 1.
	 */
	private applyFinalPositions(shellHolderId: number | null): void {
		if (shellHolderId === null) {
			this.recomputePositions();
			return;
		}
		const holder = this.entries.get(shellHolderId);
		if (holder) {
			holder.position = 1;
		}
		const rest = this.sortedByPoints(
			[...this.entries.values()].filter(
				(state) => state.playerId !== shellHolderId,
			),
		);
		this.assignPositions(rest, 2);
	}

	/**
	 * Writes standard competition positions onto `sorted` (already points DESC).
	 * `startPosition` is the position of the first entry; a new (lower) points
	 * value takes position `startPosition + index`, so ties share and the next
	 * distinct group skips by the tie count (e.g. 1,2,2,4).
	 */
	private assignPositions(sorted: EntryState[], startPosition: number): void {
		for (let i = 0; i < sorted.length; i++) {
			if (i > 0 && sorted[i].points !== sorted[i - 1].points) {
				sorted[i].position = startPosition + i;
			} else {
				sorted[i].position = i === 0 ? startPosition : sorted[i - 1].position;
			}
		}
	}

	/**
	 * Points DESC, then playerId ASC. The playerId tiebreak is PRESENTATION
	 * order only (SPEC-018 "Desempates": no secondary ranking criterion) — it
	 * makes the array deterministic without affecting shared positions.
	 */
	private sortedByPoints(states: EntryState[]): EntryState[] {
		return [...states].sort((a, b) => {
			if (b.points !== a.points) {
				return b.points - a.points;
			}
			return a.playerId - b.playerId;
		});
	}

	/** Entries in presentation order (position ASC, then playerId ASC). */
	private orderedStates(shellHolderId: number | null = null): EntryState[] {
		return [...this.entries.values()].sort((a, b) => {
			if (shellHolderId !== null) {
				if (a.playerId === shellHolderId) return -1;
				if (b.playerId === shellHolderId) return 1;
			}
			if (a.position !== b.position) {
				return a.position - b.position;
			}
			return a.playerId - b.playerId;
		});
	}

	private projectOrdered(
		shellHolderId: number | null = null,
	): readonly LeaderboardEntry[] {
		return this.orderedStates(shellHolderId).map((state) => ({
			playerId: state.playerId,
			position: state.position,
			points: state.points,
		}));
	}

	private emit<TName extends TournamentEventName>(
		name: TName,
		playerId: number | null,
		payload: TournamentEventPayloadMap[TName],
	): void {
		const event = createTournamentEvent({
			name,
			tournamentId: this.tournamentId,
			round: this.getRound(),
			playerId,
			payload,
			timestamp: this.clock.now(),
		});
		this.bus.emit(event as AnyTournamentEvent);
	}
}

// Re-export the event payload shape so consumers can import it from the engine.
export type { LeaderboardEntryPayload };
