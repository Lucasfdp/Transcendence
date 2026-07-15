/**
 * tournament-turn-system.ts — Tournament Turn System (SPEC-005).
 *
 * ONE INSTANCE PER TOURNAMENT, running ONE active turn at a time (SPEC-005
 * "Restricciones"). The Runtime starts each player's turn; the Turn System then:
 *   activate → emit PlayerTurnStarted + DiceRollRequested → wait for the roll →
 *   roll (server-side, via the Dice command) → move (Board command) → resolve
 *   tile (the Board does this) → finish → emit PlayerTurnFinished.
 *
 * The player decides WHEN to roll (`requestRoll`); the SERVER always generates
 * the result (SPEC-005 "Lanzamiento del dado"). A per-turn timeout (SPEC-005
 * "Timeout", v1 30s from settings) auto-rolls if the player never does; a
 * disconnection (`handleDisconnect`) auto-resolves immediately (SPEC-005
 * "Desconexión"). Neither ever ejects the player or blocks the match.
 *
 * F3 scope: a turn finishes as soon as movement resolves. The interaction window
 * (WAITING_INTERACTION → ShopClosed, SPEC-005) belongs to the Shop phase (F6)
 * and is intentionally not implemented here.
 *
 * Determinism (SPEC-028): time and timers come only from the injected clock —
 * no `Date.now`, no `setTimeout`; the roll is seeded inside the Dice System.
 */

import { TimerHandle, TournamentClock } from "../infra/clock";
import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentLogger } from "../infra/tournament-logger";
import {
	ActiveTurnState,
	TurnBoardPort,
	TurnCommandResult,
	TurnDicePort,
	TurnSnapshot,
} from "./turn.types";

export interface TournamentTurnSystemOptions {
	readonly tournamentId: string;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	/** Dice command port (SPEC-005 "Dados"). */
	readonly dice: TurnDicePort;
	/** Board command port (SPEC-005 "Movimiento"). */
	readonly board: TurnBoardPort;
	/** Roll timeout in ms (SPEC-024 timeouts.turnSeconds × 1000). */
	readonly turnTimeoutMs: number;
	readonly logger?: TournamentLogger;
	/** Current tournament round for event envelopes; 0 when omitted. */
	readonly getRound?: () => number;
}

interface MutableTurn {
	readonly playerId: number;
	readonly round: number;
	rolled: boolean;
	readonly deadlineAt: number;
	timer: TimerHandle | null;
}

export class TournamentTurnSystem {
	private readonly tournamentId: string;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly dice: TurnDicePort;
	private readonly board: TurnBoardPort;
	private readonly turnTimeoutMs: number;
	private readonly logger: TournamentLogger;
	private readonly getRound: () => number;

	private turn: MutableTurn | null = null;

	constructor(options: TournamentTurnSystemOptions) {
		this.tournamentId = options.tournamentId;
		this.bus = options.bus;
		this.clock = options.clock;
		this.dice = options.dice;
		this.board = options.board;
		this.turnTimeoutMs = options.turnTimeoutMs;
		this.logger =
			options.logger?.child("TurnSystem") ??
			new TournamentLogger({ tournamentId: this.tournamentId, system: "TurnSystem" });
		this.getRound = options.getRound ?? (() => 0);
	}

	// ── Commands ─────────────────────────────────────────────────────────────

	/**
	 * Starts `playerId`'s turn (SPEC-005 "Inicio del turno"): only one turn may be
	 * active, so a start while another turn is in progress is ignored (the Runtime
	 * is the sole sequencer — SPEC-005 "Solo el Runtime cambia de jugador").
	 * Emits PlayerTurnStarted + DiceRollRequested and arms the roll timeout.
	 */
	startTurn(playerId: number): TurnCommandResult {
		if (this.turn !== null) {
			this.logger.warn("startTurn ignored: a turn is already in progress", {
				playerId,
				metadata: { activePlayerId: this.turn.playerId },
			});
			return { status: "ignored", reason: "turn_in_progress" };
		}

		const round = this.getRound();
		const deadlineAt = this.clock.now() + this.turnTimeoutMs;
		this.turn = { playerId, round, rolled: false, deadlineAt, timer: null };

		this.emit("PlayerTurnStarted", playerId, round, { deadlineAt });
		this.emit("DiceRollRequested", playerId, round, { deadlineAt });

		// Arm the roll timeout (SPEC-005 "Timeout"): the server auto-rolls.
		this.turn.timer = this.clock.schedule(this.turnTimeoutMs, () => {
			this.autoResolve(playerId, "timeout");
		});
		return { status: "ok" };
	}

	/**
	 * The active player asks to roll (SPEC-005: the player decides when). Ignored
	 * (and logged) if there is no active turn, the caller is not the active player,
	 * or the turn already rolled — duplicate presses do nothing (SPEC-005 "Casos
	 * límite": jugador pulsa varias veces → ignorar; actuar fuera de turno →
	 * ignorar + registrar).
	 */
	requestRoll(playerId: number): TurnCommandResult {
		if (this.turn === null) {
			return this.ignore(playerId, "no_active_turn");
		}
		if (this.turn.playerId !== playerId) {
			return this.ignore(playerId, "not_active_player");
		}
		if (this.turn.rolled) {
			return this.ignore(playerId, "already_rolled");
		}
		this.resolveTurn(false);
		return { status: "ok" };
	}

	/**
	 * The active player disconnected (SPEC-005 "Desconexión"): auto-resolve the
	 * turn immediately (automatic roll, no optional interactions). A disconnect
	 * for a non-active / already-rolled player is a no-op.
	 */
	handleDisconnect(playerId: number): void {
		if (this.turn && this.turn.playerId === playerId && !this.turn.rolled) {
			this.autoResolve(playerId, "disconnect");
		}
	}

	// ── Read-only observation ────────────────────────────────────────────────

	get activePlayerId(): number | null {
		return this.turn?.playerId ?? null;
	}

	getActiveTurn(): ActiveTurnState | null {
		return this.turn ? this.projectTurn(this.turn) : null;
	}

	serialize(): TurnSnapshot {
		return {
			tournamentId: this.tournamentId,
			activeTurn: this.turn ? this.projectTurn(this.turn) : null,
		};
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/** Timeout / disconnection path: auto-roll if the turn is still open. */
	private autoResolve(playerId: number, cause: "timeout" | "disconnect"): void {
		if (!this.turn || this.turn.playerId !== playerId || this.turn.rolled) {
			return;
		}
		this.logger.log(`auto-resolving turn (${cause})`, { playerId });
		this.resolveTurn(true);
	}

	/**
	 * The roll → move → resolve → finish sequence (SPEC-005 "Flujo"). The server
	 * rolls (Dice command → the Dice System emits DiceRolled), the player moves
	 * (Board command → the Board emits PlayerMoved/TileResolved/MovementFinished
	 * synchronously), then the turn finishes. `auto` marks a server-resolved turn.
	 */
	private resolveTurn(auto: boolean): void {
		const turn = this.turn;
		if (!turn) {
			return;
		}
		turn.rolled = true;
		if (turn.timer) {
			this.clock.cancel(turn.timer);
			turn.timer = null;
		}

		const roll = this.dice.roll({ playerId: turn.playerId, round: turn.round });
		const move = this.board.movePlayer(turn.playerId, roll.value);
		const finalTileId =
			(move.status === "moved" ? move.toTileId : undefined) ??
			this.board.getPosition(turn.playerId) ??
			"";

		// Clear BEFORE emitting: when PlayerTurnFinished reaches subscribers the
		// turn is already over, so the Runtime's interactive sequencer can open
		// the next player's turn synchronously from its handler (SPEC-005: one
		// active turn — the fact must never observe a half-closed turn).
		this.turn = null;
		this.emit("PlayerTurnFinished", turn.playerId, turn.round, {
			finalTileId,
			diceValue: roll.value,
			autoResolved: auto,
		});
	}

	private ignore(playerId: number, reason: "no_active_turn" | "not_active_player" | "already_rolled"): TurnCommandResult {
		this.logger.warn(`turn command ignored: ${reason}`, { playerId });
		return { status: "ignored", reason };
	}

	private projectTurn(turn: MutableTurn): ActiveTurnState {
		return {
			playerId: turn.playerId,
			round: turn.round,
			phase: turn.rolled ? "finished" : "waiting_roll",
			rolled: turn.rolled,
			deadlineAt: turn.deadlineAt,
		};
	}

	private emit<TName extends TournamentEventName>(
		name: TName,
		playerId: number | null,
		round: number,
		payload: TournamentEventPayloadMap[TName],
	): void {
		const event = createTournamentEvent({
			name,
			tournamentId: this.tournamentId,
			round,
			playerId,
			payload,
			timestamp: this.clock.now(),
		});
		this.bus.emit(event as AnyTournamentEvent);
	}
}
