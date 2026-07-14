/**
 * tournament-board.ts — Tournament Board System (SPEC-002).
 *
 * ONE INSTANCE PER TOURNAMENT. Its ONLY responsibility is to administer the
 * board state and player movement (SPEC-002 "Objetivo"): it knows WHERE each
 * player is, WHAT the next tile is, and WHAT happens when a player lands — and
 * nothing else. It NEVER modifies scores, inventories, key items or rewards; it
 * only DELEGATES a tile's Actions to the Action Engine (through the injected
 * `TileActionRunner`) and emits events (SPEC-002 "Responsabilidades"). It knows
 * nothing of economy, inventory, minigames, gambling, boss, leaderboard,
 * networking or UI (SPEC-002 "Restricciones Arquitectónicas").
 *
 * Movement is always requested by a command (SPEC-002 "API pública": movePlayer/
 * teleportPlayer) — never an event; the Board never starts movement itself.
 * Players may SHARE a tile — no collision, blocking or priority.
 *
 * Determinism (SPEC-028): no `Math.random`, no `Date.now` — movement is a pure
 * function of the command; timestamps come only from the injected clock.
 */

import { ActionContext, ActionServices } from "../actions/action.interface";
import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import {
	BoardContextFactory,
	BoardDefinition,
	BoardSnapshot,
	MovementResult,
	Tile,
	TileActionRunner,
	TileActionStatusValue,
} from "./board.types";

export interface TournamentBoardOptions {
	readonly tournamentId: string;
	readonly definition: BoardDefinition;
	/** Participant user ids; each starts on `definition.startingTile`. */
	readonly participantIds: readonly number[];
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	/** Tile-resolution seam; a no-op runner is used when omitted (SPEC-002). */
	readonly actionRunner?: TileActionRunner;
	/** Builds the ActionContext for tile resolution; a minimal one when omitted. */
	readonly makeContext?: BoardContextFactory;
	/** Current tournament round for event envelopes; 0 when omitted. */
	readonly getRound?: () => number;
}

/**
 * Default runner used when no Action Engine is injected (v1 standalone): runs
 * nothing (SPEC-002: the Board never executes Actions itself).
 */
const NOOP_ACTION_RUNNER: TileActionRunner = {
	run: () => [],
};

/**
 * The maximum relocation depth (SPEC-002 "Teleports y relocalizaciones
 * forzadas"): a forced relocation may chain at most ONE additional relocation.
 * Depth 0 = the original move; depth 1 = the one permitted extra hop; a
 * relocation attempted at depth ≥ 2 is suppressed (anti-loop).
 */
const MAX_RELOCATION_DEPTH = 2;

export class TournamentBoard {
	private readonly tournamentId: string;
	private readonly definition: BoardDefinition;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly actionRunner: TileActionRunner;
	private readonly makeContext: BoardContextFactory;
	private readonly getRound: () => number;

	private readonly tiles = new Map<string, Tile>();
	/** Predecessor index for negative-step (backward) movement. */
	private readonly predecessors = new Map<string, string>();
	private readonly participantIds: readonly number[];

	private readonly positions = new Map<number, string>();
	/** Per-player resolution depth — drives the anti-loop limit (SPEC-002). */
	private readonly relocationDepth = new Map<number, number>();

	constructor(options: TournamentBoardOptions) {
		this.tournamentId = options.tournamentId;
		this.definition = options.definition;
		this.participantIds = [...options.participantIds];
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("Board") ??
			new TournamentLogger({ tournamentId: this.tournamentId, system: "Board" });
		this.actionRunner = options.actionRunner ?? NOOP_ACTION_RUNNER;
		this.getRound = options.getRound ?? (() => 0);
		this.makeContext =
			options.makeContext ??
			((input): ActionContext => ({
				tournamentId: this.tournamentId,
				playerId: input.playerId,
				round: this.getRound(),
				tileId: input.tileId,
				eventBus: this.bus,
				services: {} as ActionServices,
			}));

		for (const tile of this.definition.tiles) {
			this.tiles.set(tile.id, tile);
		}
		// Build the predecessor index (single-successor board → at most one
		// predecessor per tile in v1; the lowest id wins on the impossible tie).
		for (const tile of this.definition.tiles) {
			const successor = tile.connections[0];
			if (successor !== undefined) {
				const existing = this.predecessors.get(successor);
				if (existing === undefined || tile.id < existing) {
					this.predecessors.set(successor, tile.id);
				}
			}
		}

		this.initialize();
	}

	// ── Commands (SPEC-002 "API pública") ────────────────────────────────────

	/** Seats every participant on the starting tile (SPEC-002 "initialize"). */
	initialize(): void {
		this.positions.clear();
		this.relocationDepth.clear();
		for (const playerId of this.participantIds) {
			this.positions.set(playerId, this.definition.startingTile);
		}
	}

	/** Resets the board to its initial state (SPEC-002 "reset"). */
	reset(): void {
		this.initialize();
	}

	/**
	 * Moves a player `steps` tiles along the board and resolves the destination
	 * (SPEC-002 "Movimiento paso a paso"). Positive steps walk the single
	 * successor edge; negative steps walk the predecessor edge (SPEC-006
	 * MovePlayerAction allows negative). `forced = false` (a normal move). An
	 * unknown player or a walk that runs off the board → a controlled `rejected`
	 * result, never a throw.
	 */
	movePlayer(playerId: number, steps: number): MovementResult {
		const from = this.positions.get(playerId);
		if (from === undefined) {
			return this.rejectUnknownPlayer(playerId, "movePlayer");
		}
		if (!this.canRelocate(playerId)) {
			return this.rejectRelocationLimit(playerId, "movePlayer");
		}

		const destination = this.walk(from, steps);
		if (destination === null) {
			this.logger.warn("movePlayer ran off the board; rejected", {
				playerId,
				metadata: { from, steps },
			});
			return { status: "rejected", reason: "no_successor" };
		}
		return this.applyMove(playerId, from, destination, steps, false);
	}

	/**
	 * Teleports a player straight to `tileId` and resolves it (SPEC-002
	 * "teleportPlayer"). `forced = true` — counts as a forced relocation subject
	 * to the anti-loop limit. Unknown tile → `rejected: unknown_tile` (controlled,
	 * never a throw).
	 */
	teleportPlayer(playerId: number, tileId: string): MovementResult {
		const from = this.positions.get(playerId);
		if (from === undefined) {
			return this.rejectUnknownPlayer(playerId, "teleportPlayer");
		}
		if (!this.tiles.has(tileId)) {
			this.logger.warn("teleportPlayer to unknown tile; rejected", {
				playerId,
				metadata: { tileId },
			});
			return { status: "rejected", reason: "unknown_tile" };
		}
		if (!this.canRelocate(playerId)) {
			return this.rejectRelocationLimit(playerId, "teleportPlayer");
		}
		return this.applyMove(playerId, from, tileId, 0, true);
	}

	// ── Read-only observation ────────────────────────────────────────────────

	/** The tile a player occupies, or undefined for an unknown player. */
	getPosition(playerId: number): string | undefined {
		return this.positions.get(playerId);
	}

	/** The player ids currently on a tile (players may share — SPEC-002). */
	getPlayersOn(tileId: string): number[] {
		const players: number[] = [];
		for (const [playerId, position] of this.positions) {
			if (position === tileId) {
				players.push(playerId);
			}
		}
		return players;
	}

	/** A tile definition by id (undefined when it does not exist). */
	getTile(tileId: string): Tile | undefined {
		return this.tiles.get(tileId);
	}

	/** JSON-safe snapshot for the Runtime snapshot (SPEC-002 "Persistencia"). */
	serialize(): BoardSnapshot {
		return {
			tournamentId: this.tournamentId,
			boardId: this.definition.id,
			positions: [...this.positions.entries()].map(([playerId, tileId]) => ({
				playerId,
				tileId,
			})),
		};
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/**
	 * The movement pipeline shared by move and teleport (SPEC-002 "Movimiento"):
	 * update position → PlayerMoved → TileEntered → resolve Actions → TileResolved
	 * → MovementFinished. Resolution runs INSIDE the relocation-depth guard so a
	 * chained forced relocation is limited to one extra hop (SPEC-002 anti-loop).
	 */
	private applyMove(
		playerId: number,
		from: string,
		to: string,
		steps: number,
		forced: boolean,
	): MovementResult {
		this.positions.set(playerId, to);
		this.emit("PlayerMoved", playerId, {
			fromTileId: from,
			toTileId: to,
			steps,
			forced,
		});
		this.emit("TileEntered", playerId, { tileId: to });

		const actionStatuses = this.resolveTile(playerId, to);

		this.emit("TileResolved", playerId, { tileId: to, actionStatuses });
		this.emit("MovementFinished", playerId, { tileId: to });

		return {
			status: "moved",
			playerId,
			fromTileId: from,
			toTileId: to,
			steps,
			forced,
			actionStatuses,
		};
	}

	/**
	 * Resolves a tile by running its Actions through the injected runner (SPEC-002
	 * "Tile Resolution": Board delegates, never executes). Wrapped in the
	 * per-player relocation-depth guard so an Action that relocates the same
	 * player re-enters at a higher depth (and a second additional relocation is
	 * suppressed — SPEC-002 anti-loop). Never throws.
	 */
	private resolveTile(playerId: number, tileId: string): TileActionStatusValue[] {
		const tile = this.tiles.get(tileId);
		if (!tile) {
			// Should be unreachable (destinations are validated), but stay
			// controlled rather than throw (SPEC-002 "Casos límite").
			this.logger.error("resolveTile for a tile that does not exist", {
				playerId,
				metadata: { tileId },
			});
			return [];
		}

		const depth = (this.relocationDepth.get(playerId) ?? 0) + 1;
		this.relocationDepth.set(playerId, depth);
		try {
			const ctx = this.makeContext({ playerId, tileId });
			const results = this.actionRunner.run(tile.actions, ctx);
			return results.map((result) => result.status);
		} catch (error) {
			// The runner (Action Engine) must never throw; if it does the match
			// keeps going (SPEC-002 aligns with SPEC-008 "Casos límite").
			this.logger.error("tile action runner threw; treated as no results", {
				playerId,
				metadata: {
					tileId,
					error: error instanceof Error ? error.message : String(error),
				},
			});
			return [];
		} finally {
			this.relocationDepth.set(playerId, depth - 1);
		}
	}

	/** True when a (re-entrant) relocation is still within the anti-loop limit. */
	private canRelocate(playerId: number): boolean {
		return (this.relocationDepth.get(playerId) ?? 0) < MAX_RELOCATION_DEPTH;
	}

	/**
	 * Walks `steps` edges from `from` (forward via the single successor, backward
	 * via the predecessor). Returns the destination tile id, or null if the walk
	 * runs off the board (a linear dead-end; a ring never does). Zero steps stay
	 * put and still resolve (SPEC-002).
	 */
	private walk(from: string, steps: number): string | null {
		let current = from;
		const forward = steps >= 0;
		for (let i = 0; i < Math.abs(steps); i++) {
			const next = forward
				? this.tiles.get(current)?.connections[0]
				: this.predecessors.get(current);
			if (next === undefined) {
				return null;
			}
			current = next;
		}
		return current;
	}

	private rejectUnknownPlayer(playerId: number, command: string): MovementResult {
		this.logger.warn(`${command} for unknown player ignored`, { playerId });
		return { status: "rejected", reason: "unknown_player" };
	}

	private rejectRelocationLimit(playerId: number, command: string): MovementResult {
		// A second additional relocation during resolution (SPEC-002 anti-loop):
		// the destination is already resolved once; this further hop is suppressed.
		this.logger.warn(`${command} suppressed: relocation limit reached`, {
			playerId,
		});
		return { status: "rejected", reason: "relocation_limit" };
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
