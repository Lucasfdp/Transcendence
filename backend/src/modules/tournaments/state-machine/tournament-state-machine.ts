/**
 * tournament-state-machine.ts — the Tournament State Machine (SPEC-003).
 *
 * Sole responsibility: control which phase is active and guarantee there is
 * EXACTLY ONE active state at every moment — never two, never zero. Zero
 * gameplay, UI, networking or economy logic lives here; branching decisions
 * (e.g. which CHECK_KEY_ITEMS exit to take) belong to the Runtime, which
 * calls `requestTransition` with the chosen target.
 *
 * Every transition is explicit and validated twice: against the canonical
 * declarative edge map (tournament-phase.ts) AND the active state's
 * `canTransition()`. There are no manual jumps: the public API cannot set
 * the phase directly, and a rejected request never changes state and never
 * throws (errors must not kill the tournament).
 *
 * Lifecycle choice (documented per SPEC): the machine enters CREATED ON
 * CONSTRUCTION — there is no separate `start()`. Construction runs the
 * initial state's `onEnter()` and emits StateEntered, so the "exactly one
 * active state" invariant holds from the first instant.
 *
 * Events (SPEC-003 "Eventos emitidos"), all through the wave-1 bus with
 * clock-provided timestamps. The per-transition order is CONTRACTUAL:
 *   TransitionStarted → StateExited → StateEntered → TransitionCompleted
 * (with old.onExit() before StateExited and new.onEnter() before
 * StateEntered). Rejections emit only TransitionFailed.
 */

import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import { TournamentStateFactory, createPhaseState } from "./phase-states";
import {
	TournamentPhase,
	isLegalTransition,
	isTerminalPhase,
} from "./tournament-phase";
import {
	TournamentState,
	TournamentStateMachineSnapshot,
	TournamentTempVariables,
} from "./tournament-state.interface";

/** The five events the machine owns (SPEC-003 "Eventos emitidos"). */
type StateMachineEventName =
	| "StateEntered"
	| "StateExited"
	| "TransitionStarted"
	| "TransitionCompleted"
	| "TransitionFailed";

export class TournamentStateMachine {
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly tournamentId: string;
	private readonly stateFactory: TournamentStateFactory;

	/** The exactly-one active state (never null after construction). */
	private state: TournamentState;
	private phase: TournamentPhase;
	/** Guards against re-entrant transitions from onExit/onEnter/listeners. */
	private transitioning = false;

	// Persistence bookkeeping (SPEC-003 "Persistencia"). The machine only
	// CARRIES these for the snapshot; the Runtime owns their meaning and
	// updates them through the setters below.
	private round = 0;
	private activePlayerId: number | null = null;
	private tempVariables: TournamentTempVariables = {};
	/**
	 * Remaining time of the active phase's timer. Phase-1 shells own no
	 * timers, so this stays null unless restored from a snapshot; later
	 * phases will maintain it. It passes through serialize/restore intact.
	 */
	private remainingTimeMs: number | null = null;

	/**
	 * Builds a machine and ENTERS CREATED immediately (see file header).
	 *
	 * `snapshot` is internal — it is how `restoreFrom` skips the CREATED
	 * entry; do not pass it directly, use `TournamentStateMachine.restoreFrom`.
	 */
	constructor(
		bus: TournamentEventBus,
		clock: TournamentClock,
		logger: TournamentLogger,
		tournamentId: string,
		stateFactory: TournamentStateFactory = createPhaseState,
		snapshot?: TournamentStateMachineSnapshot,
	) {
		this.bus = bus;
		this.clock = clock;
		this.logger = logger;
		this.tournamentId = tournamentId;
		this.stateFactory = stateFactory;

		if (snapshot) {
			// Restore path: recreate the state for the persisted phase. No
			// StateEntered is emitted — the entry already happened (and was
			// emitted) before the snapshot was taken; this is a resumption,
			// not a new entry. Phase-1 states carry no internal data, so
			// recreating the shell fully restores the machine.
			this.phase = snapshot.phase;
			this.round = snapshot.round;
			this.activePlayerId = snapshot.activePlayerId;
			this.remainingTimeMs = snapshot.remainingTimeMs;
			this.tempVariables = { ...snapshot.tempVariables };
			this.state = this.stateFactory(this.phase);
			this.state.onEnter();
			return;
		}

		this.phase = "CREATED";
		this.state = this.stateFactory(this.phase);
		this.state.onEnter();
		this.emit("StateEntered", { state: this.phase });
	}

	/**
	 * Rebuilds a machine from a persisted snapshot (SPEC-003
	 * "Persistencia"): phase, round, active player, remaining time and temp
	 * variables pass through unchanged. See the constructor note on why no
	 * StateEntered is emitted.
	 */
	static restoreFrom(
		snapshot: TournamentStateMachineSnapshot,
		bus: TournamentEventBus,
		clock: TournamentClock,
		logger: TournamentLogger,
		tournamentId: string,
		stateFactory: TournamentStateFactory = createPhaseState,
	): TournamentStateMachine {
		return new TournamentStateMachine(
			bus,
			clock,
			logger,
			tournamentId,
			stateFactory,
			snapshot,
		);
	}

	get currentPhase(): TournamentPhase {
		return this.phase;
	}

	get isTerminal(): boolean {
		return isTerminalPhase(this.phase);
	}

	/**
	 * Requests an explicit transition to `to`. Validates the canonical edge
	 * map AND the active state's `canTransition()`. On success runs the
	 * contractual sequence (see file header) and returns true. On rejection
	 * emits TransitionFailed, logs a warning, keeps the current state and
	 * returns false — it NEVER throws.
	 *
	 * CANCELLED is not reachable through this method: `cancel()` is the
	 * only path (SPEC-023 Match Lifecycle is its only requester).
	 */
	requestTransition(to: TournamentPhase): boolean {
		if (to === "CANCELLED") {
			return this.reject(
				to,
				"CANCELLED is only reachable through cancel() (SPEC-023 Match Lifecycle request)",
			);
		}
		return this.tryTransition(to);
	}

	/**
	 * The ONLY path to CANCELLED (SPEC-003 "Cancelled"): an explicit
	 * transition requested by the Match Lifecycle (SPEC-023), legal from
	 * every non-terminal phase. Emits the same contractual event sequence
	 * as any other transition. Returns false (with TransitionFailed) when
	 * the machine is already terminal.
	 */
	cancel(reason: string): boolean {
		this.logger.log(`Tournament cancellation requested: ${reason}`, {
			metadata: { from: this.phase },
		});
		return this.tryTransition("CANCELLED");
	}

	/** Runtime tick entry: delegates to the active state (no own loop). */
	update(): void {
		this.state.update();
	}

	// ── Persistence ────────────────────────────────────────────────────────

	/** Snapshot of the machine (SPEC-003 "Persistencia"), jsonb-safe. */
	serialize(): TournamentStateMachineSnapshot {
		return {
			phase: this.phase,
			remainingTimeMs: this.remainingTimeMs,
			activePlayerId: this.activePlayerId,
			round: this.round,
			tempVariables: { ...this.tempVariables },
		};
	}

	// ── Runtime-owned bookkeeping (carried for the snapshot) ───────────────

	setRound(round: number): void {
		this.round = round;
	}

	setActivePlayer(playerId: number | null): void {
		this.activePlayerId = playerId;
	}

	setTempVariable(
		key: string,
		value: string | number | boolean | null,
	): void {
		this.tempVariables[key] = value;
	}

	// ── Internals ──────────────────────────────────────────────────────────

	/**
	 * Shared validation + contractual transition sequence. The active state
	 * is swapped atomically between StateExited and StateEntered, so there
	 * is exactly one active state before, during and after the call.
	 */
	private tryTransition(to: TournamentPhase): boolean {
		if (this.transitioning) {
			return this.reject(to, "a transition is already in progress");
		}
		if (isTerminalPhase(this.phase)) {
			return this.reject(
				to,
				`"${this.phase}" is terminal: no outgoing transitions exist`,
			);
		}
		if (!isLegalTransition(this.phase, to)) {
			return this.reject(
				to,
				`"${this.phase}" → "${to}" is not an edge of the canonical graph (SPEC-001/SPEC-003)`,
			);
		}
		if (!this.state.canTransition(to)) {
			return this.reject(
				to,
				`the active "${this.phase}" state rejected the transition to "${to}"`,
			);
		}

		const from = this.phase;
		this.transitioning = true;
		try {
			this.emit("TransitionStarted", { from, to });
			this.state.onExit();
			this.emit("StateExited", { state: from });
			this.phase = to;
			this.state = this.stateFactory(to);
			this.state.onEnter();
			this.emit("StateEntered", { state: to });
			this.emit("TransitionCompleted", { from, to });
		} finally {
			this.transitioning = false;
		}
		return true;
	}

	/** Rejection path: TransitionFailed + warning, state untouched. */
	private reject(to: TournamentPhase, reason: string): false {
		this.logger.warn(
			`Transition rejected: ${this.phase} → ${to} (${reason})`,
			{ metadata: { from: this.phase, to } },
		);
		this.emit("TransitionFailed", { from: this.phase, to, reason });
		return false;
	}

	private emit<TName extends StateMachineEventName>(
		name: TName,
		payload: TournamentEventPayloadMap[TName],
	): void {
		const event = createTournamentEvent({
			name,
			tournamentId: this.tournamentId,
			round: this.round,
			payload,
			timestamp: this.clock.now(),
		});
		// Safe: TName is one of the registered event names and the payload
		// is typed by TournamentEventPayloadMap[TName]; TS just cannot
		// distribute a generic TournamentEvent<TName> over the union.
		this.bus.emit(event as AnyTournamentEvent);
	}
}
