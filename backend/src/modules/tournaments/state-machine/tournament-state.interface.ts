/**
 * tournament-state.interface.ts — the uniform state interface (SPEC-003
 * "Interfaz de un Estado") and the serializable machine snapshot
 * (SPEC-003 "Persistencia").
 *
 * Every phase state implements EXACTLY this interface — no additional
 * methods (SPEC-003). States never call each other; they only report
 * whether/where they want to go and the Runtime asks the machine to move.
 */

import { TournamentPhase } from "./tournament-phase";

export interface TournamentState {
	/**
	 * Called when the state becomes active. May initialize data, emit
	 * events, arm timers. Never runs long logic (SPEC-003 "Enter").
	 */
	onEnter(): void;

	/**
	 * Called when the state stops being active. Must release temporary
	 * resources, cancel timers, remove listeners — never leave dangling
	 * references (SPEC-003 "Exit").
	 */
	onExit(): void;

	/**
	 * Called by the Runtime's tick while the state is active. May wait for
	 * events/players; must never block the main thread (SPEC-003 "Update").
	 */
	update(): void;

	/**
	 * Whether THIS state accepts leaving towards `to` right now. The machine
	 * combines it (AND) with the canonical edge map: both must agree.
	 */
	canTransition(to: TournamentPhase): boolean;

	/**
	 * The phase this state is requesting to move to, or null when no
	 * transition is requested yet. The state only REQUESTS — the Runtime
	 * decides and calls the machine (SPEC-003 "Restricciones").
	 */
	nextState(): TournamentPhase | null;
}

/**
 * Temp variables carried by the snapshot. Deliberately a SHALLOW record of
 * JSON primitives: the snapshot is persisted to a Postgres jsonb column
 * after every transition (SPEC-023), so it must be jsonb-safe and
 * round-trippable without class instances, Dates, Maps or nesting.
 */
export type TournamentTempVariables = Record<
	string,
	string | number | boolean | null
>;

/**
 * Serializable machine snapshot (SPEC-003 "Persistencia"): current state,
 * remaining time, active player, round and temp variables. Supports
 * reconnections, clean cancellation after a restart (v1) and replay
 * (future).
 */
export interface TournamentStateMachineSnapshot {
	/** Active phase at serialization time. */
	phase: TournamentPhase;
	/** Remaining time of the phase's timer in ms, or null when timerless. */
	remainingTimeMs: number | null;
	/** Active player's user id, or null when no player is acting. */
	activePlayerId: number | null;
	/** Current round (0 before the first round starts). */
	round: number;
	/** Shallow jsonb-safe temp variables (see TournamentTempVariables). */
	tempVariables: TournamentTempVariables;
}
