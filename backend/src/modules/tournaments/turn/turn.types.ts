/**
 * turn.types.ts — Turn System contracts (SPEC-005).
 *
 * The Turn System runs the individual turn of ONE active player during a round
 * (SPEC-005 "Objetivo"): activate → wait for the roll → move → resolve tile →
 * finish. Exactly one turn is active at a time (SPEC-005 "Restricciones"). It
 * knows nothing of minigames/gambling/boss/economy/leaderboard/key items — it
 * only drives the Board (a command) and the Dice (a command) and emits its own
 * turn events. It NEVER modifies points/items or grants rewards (SPEC-005
 * "Restricciones").
 *
 * The Board/Dice arrive through narrow command PORTS (dependency inversion) so
 * the Turn System never imports the concrete engines; the architect wires the
 * real `TournamentBoard`/`TournamentDice` (which satisfy them structurally) in
 * the engine composition.
 */

// ── Command ports (SPEC-005 "Movimiento"/"Dados") ───────────────────────────

/**
 * The Dice command the Turn System requests (SPEC-005 "Dados": it only asks to
 * roll; the Dice System decides normal/special/consumable). Returns the final
 * value. Satisfied structurally by `TournamentDice.roll`.
 */
export interface TurnDicePort {
	roll(input: { playerId: number; round: number }): { value: number };
}

/**
 * The Board command the Turn System invokes (SPEC-005 "Movimiento": a synchronous
 * command, never an event). Satisfied structurally by `TournamentBoard.movePlayer`.
 */
export interface TurnBoardPort {
	movePlayer(
		playerId: number,
		steps: number,
	): { status: "moved" | "rejected"; toTileId?: string };
	getPosition(playerId: number): string | undefined;
}

// ── Turn state (SPEC-005 "Estado del Turno") ────────────────────────────────

/** Lifecycle phase of the single active turn. */
export type TurnPhase = "idle" | "waiting_roll" | "finished";

/** The public state of the active turn (SPEC-005 "Estado del Turno"). */
export interface ActiveTurnState {
	readonly playerId: number;
	readonly round: number;
	readonly phase: TurnPhase;
	readonly rolled: boolean;
	readonly deadlineAt: number;
}

/** Result of a `startTurn` / `requestRoll` command. */
export type TurnCommandResult =
	| { readonly status: "ok" }
	| { readonly status: "ignored"; readonly reason: TurnIgnoreReason };

/** Why a turn command was ignored (SPEC-005 "Casos límite"). */
export type TurnIgnoreReason =
	| "turn_in_progress"
	| "no_active_turn"
	| "not_active_player"
	| "already_rolled";

/** JSON-safe snapshot of the Turn System (SPEC-005): only the active turn. */
export interface TurnSnapshot {
	readonly tournamentId: string;
	readonly activeTurn: ActiveTurnState | null;
}
