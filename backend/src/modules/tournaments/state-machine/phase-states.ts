/**
 * phase-states.ts — Phase-1 shell states and the replaceable state factory.
 *
 * Phase 1 ships NO gameplay: every phase is the same minimal shell,
 * parameterized by the declarative graph (one class, not 15 near-identical
 * ones). Later phases replace individual shells by overriding the factory —
 * `createPhaseState` is the single seam: give the machine a factory that
 * returns a real implementation for some phases and falls back to the shell
 * for the rest. The machine itself never changes (SPEC-003 acceptance:
 * states can be added without modifying existing code).
 *
 * Shells hold no internal data, no timers, no listeners — which is what
 * makes `TournamentStateMachine.restoreFrom` trivially correct in Phase 1.
 */

import { TournamentPhase, isLegalTransition } from "./tournament-phase";
import { TournamentState } from "./tournament-state.interface";

/**
 * Minimal shell implementing the uniform interface (SPEC-003). Its only
 * knowledge is its own phase; transition legality is delegated to the
 * canonical edge map. It never requests a transition on its own
 * (`nextState()` is null): in Phase 1 the Runtime drives every move.
 */
export class BaseTournamentPhaseState implements TournamentState {
	constructor(public readonly phase: TournamentPhase) {}

	onEnter(): void {
		// Phase-1 shell: nothing to initialize.
	}

	onExit(): void {
		// Phase-1 shell: nothing to release.
	}

	update(): void {
		// Phase-1 shell: nothing to advance.
	}

	canTransition(to: TournamentPhase): boolean {
		return isLegalTransition(this.phase, to);
	}

	nextState(): TournamentPhase | null {
		return null;
	}
}

/**
 * Factory the machine uses to instantiate the state for a phase. Later
 * phases inject their own factory (real states for implemented phases,
 * `createPhaseState` fallback for the rest).
 */
export type TournamentStateFactory = (
	phase: TournamentPhase,
) => TournamentState;

/** Default Phase-1 factory: every phase is a shell. */
export function createPhaseState(phase: TournamentPhase): TournamentState {
	return new BaseTournamentPhaseState(phase);
}
