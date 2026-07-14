/**
 * tournament-runtime.ts — Tournament Runtime orchestrator (SPEC-001,
 * Phase-1 empty-gameplay version).
 *
 * One instance per tournament. Owns its TournamentEventBus, its
 * TournamentStateMachine, its TournamentClock and its TournamentLogger.
 * Contains ZERO gameplay: no minigames, no gambling, no economy, no
 * inventory (SPEC-001 "Responsabilidades explícitamente prohibidas"). Every
 * decision below is either mechanical (deriving the turn order from the
 * seed) or an explicitly documented Phase-1 stub (minigame omitted, no Key
 * Items can unlock yet, so every run ends in collective DEFEAT once
 * `settings.maxRound` is reached).
 *
 * Branching belongs here, not in the machine: the machine only validates
 * `requestTransition` calls against the canonical edge map
 * (TOURNAMENT_PHASE_EDGES) and the active shell's `canTransition`.
 *
 * Persistence (SPEC-023 "El snapshot del Runtime se actualiza tras cada
 * transición de la State Machine"): the Runtime NEVER touches TypeORM. It
 * calls the injected `onSnapshot` port after every transition by
 * subscribing to the machine's own `TransitionCompleted` event on the bus —
 * this single hook covers both the normal flow AND `cancel()`, because
 * CANCELLED flows through the exact same contractual event sequence
 * (tournament-state-machine.ts "Eventos emitidos").
 *
 * Determinism (SPEC-028 "Determinismo"): no `Math.random`, no `Date.now`.
 * Time only ever comes from the injected TournamentClock; the only source
 * of randomness is the tournament seed via `deriveTurnOrder` (turn-order.
 * util.ts) — the SAME function the lobby already used to seat players
 * (D13, SPEC-040: the turn order is fixed for the whole tournament).
 */

import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import { TournamentSettings } from "../config/settings.catalog";
import { TournamentPhase } from "../state-machine/tournament-phase";
import { TournamentStateMachine } from "../state-machine/tournament-state-machine";
import { TournamentStateMachineSnapshot } from "../state-machine/tournament-state.interface";
import { deriveTurnOrder } from "../turn-order.util";
import {
	TournamentEngines,
	TournamentEnginesSnapshot,
	createTournamentEngines,
} from "./tournament-engines";

/** The seven events the Runtime owns (SPEC-001 "Eventos emitidos"). */
type RuntimeEventName =
	| "TournamentCreated"
	| "TournamentStarted"
	| "RoundStarted"
	| "RoundFinished"
	| "RewardsGranted"
	| "TournamentFinished"
	| "TournamentCancelled";

/**
 * Serializable Runtime snapshot handed to the persistence port after every
 * transition. `machine` is the state machine's own snapshot (SPEC-003
 * "Persistencia"); `seed`, `participantIds`, `turnOrder` and `settingsId`
 * are Runtime-owned data the machine knows nothing about — the machine only
 * carries `round` and `activePlayerId` bookkeeping on the Runtime's behalf
 * (SPEC-001 "Datos mantenidos": TurnOrder is Runtime data).
 */
export interface TournamentRuntimeSnapshot {
	readonly machine: TournamentStateMachineSnapshot;
	readonly seed: string;
	readonly participantIds: readonly number[];
	readonly turnOrder: readonly number[];
	readonly settingsId: string;
	/** Per-tournament engine state (SPEC-001 "Datos mantenidos"): economy,
	 * rules, leaderboard, inventory, rewards — wired at construction (F2). */
	readonly engines: TournamentEnginesSnapshot;
}

/**
 * Persistence port: the Runtime orchestrates only, it never touches
 * TypeORM (SPEC-001 "Responsabilidades explícitamente prohibidas" — by
 * extension, persistence belongs to the caller). The caller
 * (TournamentRuntimeService) is responsible for writing the snapshot to
 * `tournaments.state.runtime` and mapping the phase to `tournaments.status`
 * (SPEC-023 correspondence table).
 */
export type OnRuntimeSnapshot = (snapshot: TournamentRuntimeSnapshot) => void;

export interface TournamentRuntimeOptions {
	readonly tournamentId: string;
	/** Seed persisted at lobby creation (tournaments.state.lobby.seed). */
	readonly seed: string;
	/** Participant user ids, in any order (deriveTurnOrder normalizes). */
	readonly participantIds: readonly number[];
	/** Already-validated settings, resolved by configId (SPEC-024/025). */
	readonly settings: TournamentSettings;
	readonly clock: TournamentClock;
	readonly onSnapshot: OnRuntimeSnapshot;
	/** Defaults to a fresh per-tournament bus (SPEC-004: one bus per tournament). */
	readonly bus?: TournamentEventBus;
	readonly logger?: TournamentLogger;
}

/** Safety bound for `runToCompletion` — see the method's doc comment. */
const DEFAULT_MAX_RUN_STEPS = 1000;

export class TournamentRuntime {
	private readonly bus: TournamentEventBus;
	private readonly machine: TournamentStateMachine;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly tournamentId: string;
	private readonly seed: string;
	private readonly participantIds: readonly number[];
	private readonly settings: TournamentSettings;
	private readonly onSnapshot: OnRuntimeSnapshot;
	/** The wired per-tournament engine bundle (economy/rules/… — F2). */
	private readonly engines: TournamentEngines;

	/** Fixed for the whole tournament once computed in INITIALIZING (D13). */
	private turnOrder: number[] = [];
	/** Mirrors the machine's `round` bookkeeping field (0 before ROUND_START). */
	private round = 0;

	constructor(options: TournamentRuntimeOptions) {
		this.tournamentId = options.tournamentId;
		this.seed = options.seed;
		this.participantIds = [...options.participantIds];
		this.settings = options.settings;
		this.clock = options.clock;
		this.onSnapshot = options.onSnapshot;
		this.bus = options.bus ?? new TournamentEventBus();
		this.logger =
			options.logger ??
			new TournamentLogger({
				tournamentId: this.tournamentId,
				system: "TournamentRuntime",
			});

		this.machine = new TournamentStateMachine(
			this.bus,
			this.clock,
			this.logger.child("StateMachine"),
			this.tournamentId,
		);

		// Per-tournament engines, sharing this Runtime's bus/clock/logger and
		// reading the live round (SPEC-001 "Datos mantenidos"; F2 composition).
		// They are wired and dormant in Phase 1 — no gameplay drives them yet —
		// but present in every snapshot so their state persists per transition.
		this.engines = createTournamentEngines({
			tournamentId: this.tournamentId,
			participantIds: this.participantIds,
			settings: this.settings,
			bus: this.bus,
			clock: this.clock,
			logger: this.logger,
			getRound: () => this.round,
		});

		// Persistence hook (see file header): one subscription covers every
		// transition, including cancel() → CANCELLED.
		this.bus.on("TransitionCompleted", () => {
			this.onSnapshot(this.buildSnapshot());
		});
	}

	// ── Read-only observation ────────────────────────────────────────────

	get currentPhase(): TournamentPhase {
		return this.machine.currentPhase;
	}

	get isTerminal(): boolean {
		return this.machine.isTerminal;
	}

	/** Read-only observation point for infrastructure/tests (SPEC-004 onAny). */
	get events(): TournamentEventBus {
		return this.bus;
	}

	/** The wired per-tournament engine bundle (economy/rules/leaderboard/
	 * inventory/rewards), for gameplay drivers and integration (F2). */
	get gameEngines(): TournamentEngines {
		return this.engines;
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────

	/**
	 * Walks CREATED → WAITING_PLAYERS → INITIALIZING → ROUND_START(1).
	 *
	 * The first three phases mirror the session (SPEC-023 table: Creating /
	 * WaitingPlayers / Loading) and need no external input in Phase 1 — the
	 * lobby (SPEC-038) already performed admission before calling this, so
	 * the walk to INITIALIZING is immediate. INITIALIZING computes the fixed
	 * TurnOrder from the seed (SPEC-001, D13); Board/Leaderboard/Inventory/
	 * Consumables/Key Progress are Phase-1 no-ops (no gameplay yet). Entering
	 * ROUND_START begins the actual round loop; production stops here —
	 * `advancePhase()` / `runToCompletion()` are what drive the loop further
	 * (tests/simulation in Phase 1, a future real per-phase driver later).
	 */
	start(): void {
		this.emitRuntimeEvent("TournamentCreated", {
			playerIds: [...this.participantIds],
		});

		this.machine.requestTransition("WAITING_PLAYERS");
		this.machine.requestTransition("INITIALIZING");

		this.turnOrder = deriveTurnOrder(this.seed, [...this.participantIds]);

		this.emitRuntimeEvent("TournamentStarted", {
			playerIds: [...this.participantIds],
		});

		this.enterRoundStart(1);
	}

	/**
	 * Advances exactly one legal phase-step using the Phase-1 stub decisions
	 * (SPEC-001, empty-gameplay branches documented per case below). No-op on
	 * a terminal phase or on a phase this Phase-1 Runtime does not drive
	 * (CREATED/WAITING_PLAYERS/INITIALIZING — only `start()` walks those).
	 */
	advancePhase(): TournamentPhase {
		switch (this.machine.currentPhase) {
			case "ROUND_START":
				// Player turn resolution is later-phase scope: no turns exist yet.
				this.machine.requestTransition("PLAYER_TURNS");
				break;

			case "PLAYER_TURNS":
				// No turns to resolve in Phase 1: proceed straight to MINIGAME.
				this.machine.requestTransition("MINIGAME");
				break;

			case "MINIGAME":
				// SPEC-001 "omitted" branch: Phase 1 ships no minigame catalog,
				// so every round's minigame (and consequently Gambling) is
				// omitted — this reuses the documented empty/no-result exit,
				// not a new branch of the canonical graph.
				this.machine.requestTransition("CHECK_KEY_ITEMS");
				break;

			case "CHECK_KEY_ITEMS":
				this.resolveCheckKeyItems();
				break;

			default:
				// Terminal (FINISHED/CANCELLED) or session-mirroring phases that
				// only `start()` drives — nothing to advance.
				break;
		}
		return this.machine.currentPhase;
	}

	/**
	 * Repeatedly calls `advancePhase()` until the machine reaches a terminal
	 * phase, or throws once `maxSteps` is exceeded (stall guard — SPEC-028
	 * "Detección de bloqueos"). Phase 1 is finite by construction (CHECK_KEY_
	 * ITEMS always reaches DEFEAT within `settings.maxRound` rounds), so the
	 * default budget only ever trips on a genuine bug.
	 */
	runToCompletion(maxSteps: number = DEFAULT_MAX_RUN_STEPS): void {
		let steps = 0;
		while (!this.machine.isTerminal) {
			if (steps >= maxSteps) {
				throw new Error(
					`TournamentRuntime.runToCompletion: exceeded ${maxSteps} steps ` +
						`without reaching a terminal phase (tournament ${this.tournamentId})`,
				);
			}
			this.advancePhase();
			steps++;
		}
	}

	/**
	 * The ONLY path to CANCELLED (SPEC-023: Match Lifecycle is the sole
	 * requester). No-op if the machine is already terminal — `machine.cancel`
	 * rejects silently, so no TournamentCancelled is emitted for a rejected
	 * request.
	 */
	cancel(reason: string): void {
		const cancelled = this.machine.cancel(reason);
		if (cancelled) {
			this.emitRuntimeEvent("TournamentCancelled", { reason });
		}
	}

	// ── Internals ────────────────────────────────────────────────────────

	/**
	 * CHECK_KEY_ITEMS (SPEC-001): Phase 1 has no Key Items to unlock (no
	 * Shop, no Gambling yet), so the only two reachable exits are the
	 * round-loop (below `maxRound`) and collective DEFEAT (at `maxRound`) —
	 * BOSS_EVENT stays unreachable until a later phase implements Key Items.
	 * TournamentFinished is emitted while DEFEAT is active (the phase that
	 * actually decides "no winner"), then the machine is formally moved to
	 * FINISHED — mirrors SPEC-001's own "DEFEAT ... winnerUserId queda nulo
	 * ↓ FINISHED" ordering.
	 */
	private resolveCheckKeyItems(): void {
		if (this.round < this.settings.maxRound) {
			this.emitRuntimeEvent("RoundFinished", { round: this.round });
			this.enterRoundStart(this.round + 1);
			return;
		}

		// Anti-stall exit (D3, SPEC-040): max round reached without completing
		// Key Items → collective DEFEAT → FINISHED, winnerUserId null.
		this.machine.requestTransition("DEFEAT");
		this.emitRuntimeEvent("TournamentFinished", { winnerUserId: null });
		this.machine.requestTransition("FINISHED");
	}

	/**
	 * Prepares and enters ROUND_START for `round` (SPEC-001 "Preparar nueva
	 * ronda. Seleccionar primer jugador."): bookkeeping is set BEFORE the
	 * transition so the snapshot persisted on TransitionCompleted already
	 * carries the new round/active player. Used both for round 1 (`start()`)
	 * and every subsequent round (`advancePhase()`'s CHECK_KEY_ITEMS loop).
	 */
	private enterRoundStart(round: number): void {
		this.round = round;
		this.machine.setRound(round);
		this.machine.setActivePlayer(this.turnOrder[0] ?? null);
		this.machine.requestTransition("ROUND_START");
		this.emitRuntimeEvent("RoundStarted", { round });
	}

	private buildSnapshot(): TournamentRuntimeSnapshot {
		return {
			machine: this.machine.serialize(),
			seed: this.seed,
			participantIds: [...this.participantIds],
			turnOrder: [...this.turnOrder],
			settingsId: this.settings.id,
			engines: this.engines.serialize(),
		};
	}

	private emitRuntimeEvent<TName extends RuntimeEventName>(
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
		this.bus.emit(event as AnyTournamentEvent);
	}
}
