/**
 * tournament-sync.service.ts — snapshot-first synchronization (SPEC-022).
 *
 * One responsibility: after every authoritative change, broadcast the COMPLETE
 * visible snapshot with a monotonic `seq` to the tournament's Socket.IO room
 * (`tournament:<id>`). Clients never rebuild state from events — incremental
 * `tournament:*` events stay presentation hints; the snapshot IS the state.
 *
 * Implementation: `attach()` subscribes to the live Runtime's bus (`onAny`)
 * and COALESCES each synchronous burst of domain events (a whole turn, a
 * round rollover) into ONE broadcast via a microtask flush — "tras cada
 * cambio autoritativo, el snapshot completo", without N emits per turn.
 * `buildEnvelope()` serves the same envelope to `tournament:join` acks (the
 * SPEC-022 reconnection path). This service lives at the NestJS layer, so
 * reading repositories (usernames) and real time here is fine — determinism
 * constraints apply to the engines, not to synchronization.
 */

import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Server } from "socket.io";
import { User } from "../users/entities/user.entity";
import { TournamentRuntime } from "./runtime/tournament-runtime";
import { mapTournamentPhaseToStatus } from "./runtime/tournament-runtime.service";
import {
	TOURNAMENT_WS_EVENTS,
	TournamentPlayerStateSummary,
	TournamentSnapshotEnvelope,
	TournamentSnapshotV1,
	TournamentTileSummary,
} from "./tournaments.contracts";

/** Socket.IO room of one tournament (SPEC-022 "salas por partida"). */
export const tournamentRoomName = (tournamentId: string): string =>
	`tournament:${tournamentId}`;

interface SyncState {
	readonly runtime: TournamentRuntime;
	readonly usernames: Map<number, string>;
	/** Profile pictures resolved with the usernames (roulette slices, HUD). */
	readonly avatars: Map<number, string | null>;
	/** userIds with at least one socket in the room right now. */
	readonly connected: Set<number>;
	/** userIds who quit the match for good — never reconnectable (tournament:quit). */
	readonly left: Set<number>;
	seq: number;
	/** Coalescing flag: one flush per synchronous event burst. */
	flushScheduled: boolean;
	unsubscribe: () => void;
}

@Injectable()
export class TournamentSyncService {
	private readonly logger = new Logger(TournamentSyncService.name);
	private readonly states = new Map<string, SyncState>();
	/** Set by the TournamentGateway once the shared /ws/ server initializes. */
	private server: Server | null = null;

	constructor(
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
	) {}

	setServer(server: Server): void {
		this.server = server;
	}

	/**
	 * Starts synchronizing a live Runtime: resolves usernames once, subscribes
	 * to its bus and broadcasts the initial snapshot. Called by the Runtime
	 * service right after `startTournament` builds the instance.
	 */
	async attach(tournamentId: string, runtime: TournamentRuntime): Promise<void> {
		if (this.states.has(tournamentId)) {
			return;
		}
		const usernames = new Map<number, string>();
		const avatars = new Map<number, string | null>();
		// `participants` (not `playOrder`): populated from construction, so an
		// attach before/after `start()` resolves the same usernames.
		const ids = [...runtime.participants];
		if (ids.length > 0) {
			const users = await this.userRepo.find({ where: { id: In(ids) } });
			for (const user of users) {
				usernames.set(user.id, user.username);
				avatars.set(user.id, user.avatar ?? null);
			}
		}

		const state: SyncState = {
			runtime,
			usernames,
			avatars,
			connected: new Set(),
			left: new Set(),
			seq: 0,
			flushScheduled: false,
			unsubscribe: () => undefined,
		};
		state.unsubscribe = runtime.events.onAny(() => {
			this.scheduleFlush(tournamentId);
		});
		this.states.set(tournamentId, state);
		this.scheduleFlush(tournamentId);
	}

	/** Whether a tournament is currently being synchronized. */
	isAttached(tournamentId: string): boolean {
		return this.states.has(tournamentId);
	}

	/**
	 * The current envelope for `tournament:join` acks (SPEC-022 "Reconexión":
	 * the snapshot IS the state — no event replay). Null when not attached.
	 */
	buildEnvelope(tournamentId: string): TournamentSnapshotEnvelope | null {
		const state = this.states.get(tournamentId);
		if (!state) {
			return null;
		}
		return { seq: state.seq, snapshot: this.buildSnapshot(tournamentId, state) };
	}

	/** A participant's socket entered the room. */
	markConnected(tournamentId: string, userId: number): void {
		const state = this.states.get(tournamentId);
		if (state && !state.connected.has(userId)) {
			state.connected.add(userId);
			this.scheduleFlush(tournamentId);
		}
	}

	/** A participant's socket left the room (leave or disconnect). */
	markDisconnected(tournamentId: string, userId: number): void {
		const state = this.states.get(tournamentId);
		if (state && state.connected.delete(userId)) {
			this.scheduleFlush(tournamentId);
		}
	}

	/**
	 * A participant quit the match for good (tournament:quit / "Leave match"):
	 * they leave the room AND are barred from ever rejoining (`hasLeft`), unlike
	 * a plain disconnect which stays reconnectable.
	 */
	markLeft(tournamentId: string, userId: number): void {
		const state = this.states.get(tournamentId);
		if (!state) {
			return;
		}
		state.connected.delete(userId);
		if (!state.left.has(userId)) {
			state.left.add(userId);
			this.scheduleFlush(tournamentId);
		}
	}

	/** Whether a participant quit this match for good (blocks reconnection). */
	hasLeft(tournamentId: string, userId: number): boolean {
		return this.states.get(tournamentId)?.left.has(userId) ?? false;
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/** Coalesce a synchronous burst of domain events into ONE broadcast. */
	private scheduleFlush(tournamentId: string): void {
		const state = this.states.get(tournamentId);
		if (!state || state.flushScheduled) {
			return;
		}
		state.flushScheduled = true;
		queueMicrotask(() => {
			state.flushScheduled = false;
			this.flush(tournamentId);
		});
	}

	private flush(tournamentId: string): void {
		const state = this.states.get(tournamentId);
		if (!state) {
			return;
		}
		state.seq += 1;
		const envelope: TournamentSnapshotEnvelope = {
			seq: state.seq,
			snapshot: this.buildSnapshot(tournamentId, state),
		};
		this.server
			?.to(tournamentRoomName(tournamentId))
			.emit(TOURNAMENT_WS_EVENTS.SNAPSHOT, envelope);

		// The FINAL snapshot (FINISHED/CANCELLED) was just delivered — stop
		// synchronizing; late joins fall back to REST hydration.
		if (state.runtime.isTerminal) {
			state.unsubscribe();
			this.states.delete(tournamentId);
			this.logger.log(`sync detached (terminal): tournament ${tournamentId}`);
		}
	}

	/** The COMPLETE visible state (SPEC-022) from the live Runtime + engines. */
	private buildSnapshot(
		tournamentId: string,
		state: SyncState,
	): TournamentSnapshotV1 {
		const { runtime, usernames, avatars, connected } = state;
		const engines = runtime.gameEngines;
		const phase = runtime.currentPhase;

		const tiles: TournamentTileSummary[] = engines.board
			.getDefinition()
			.tiles.map((tile, index) => ({
				id: tile.id,
				kind: typeof tile.metadata?.kind === "string" ? tile.metadata.kind : "empty",
				order:
					typeof tile.metadata?.index === "number" ? tile.metadata.index : index,
			}));

		const players: TournamentPlayerStateSummary[] = runtime.playOrder.map(
			(userId, seat) => {
				const isBot = runtime.botPlayers.has(userId);
				return {
					userId,
					username: usernames.get(userId) ?? `player-${userId}`,
					avatar: avatars.get(userId) ?? null,
					seat,
					points: engines.economy.getBalance(userId) ?? 0,
					tileId: engines.board.getPosition(userId) ?? null,
					// CPUs are server-driven — never "disconnected".
					connected: isBot || connected.has(userId),
					isBot,
				};
			},
		);

		const activeTurn = engines.turnSystem.getActiveTurn();
		const minigame = engines.minigame.serialize();

		return {
			version: 1,
			tournamentId,
			status: mapTournamentPhaseToStatus(phase).status,
			phase,
			round: runtime.currentRound,
			maxRound: runtime.maxRound,
			turnOrder: [...runtime.playOrder],
			activePlayerId: engines.turnSystem.activePlayerId,
			turnDeadlineAt: activeTurn?.deadlineAt ?? null,
			board: { tiles },
			players,
			keyItems: {
				unlocked: engines.keyItems.getUnlockedCount(),
				required: engines.keyItems.getRequired(),
			},
			gambling: this.gamblingView(runtime),
			minigameMatchId: minigame.pendingMatchId,
			winnerUserId: runtime.winner,
			lastRoll: runtime.lastRoll,
			lastGamble: runtime.lastGamble,
			tieBreak: minigame.tieBreak
				? {
						playerIds: [...minigame.tieBreak.playerIds],
						winnerId: minigame.tieBreak.winnerId,
						resolveAt: minigame.tieBreak.resolveAt,
					}
				: null,
			minigameGate: minigame.launchGate
				? {
						minigameId: minigame.launchGate.minigameId,
						playerIds: [...minigame.launchGate.playerIds],
						readyPlayerIds: [...minigame.launchGate.readyPlayerIds],
						deadlineAt: minigame.launchGate.deadlineAt,
					}
				: null,
			shop: this.shopView(runtime),
		};
	}

	/** The open shop session as everyone may see it (SPEC-012 / SPEC-039). */
	private shopView(
		runtime: TournamentRuntime,
	): TournamentSnapshotV1["shop"] {
		const shop = runtime.gameEngines.shop;
		const session = shop.serialize().session;
		if (!session) {
			return null;
		}
		return {
			playerId: session.playerId,
			deadlineAt: session.deadlineAt,
			offers: shop
				.getCatalogView(session.playerId, runtime.currentRound)
				.map((offer) => ({
					id: offer.id,
					name: offer.name,
					description: offer.description,
					icon: offer.icon,
					price: offer.price,
					available: offer.available,
				})),
		};
	}

	/** The open gambling session as everyone may see it (SPEC-016/039). */
	private gamblingView(
		runtime: TournamentRuntime,
	): TournamentSnapshotV1["gambling"] {
		const session = runtime.gameEngines.gambling.serialize().session;
		if (!session) {
			return null;
		}
		return {
			winnerId: session.winnerId,
			cost: session.cost,
			winChance: session.winChance,
			deadlineAt: session.deadlineAt,
		};
	}
}
