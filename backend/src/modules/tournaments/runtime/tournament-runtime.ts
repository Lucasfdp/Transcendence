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
	/**
	 * Interactive mode (Vertical Slice, SPEC-022): PLAYER_TURNS drives REAL board
	 * turns through the Turn System — one turn per player in TurnOrder, resolved
	 * by a RollDiceIntent (`handleRollDice`) or the Turn System's own roll
	 * timeout/disconnect auto-resolution — then the round continues MINIGAME
	 * (Phase-1 skip) → CHECK_KEY_ITEMS → next round / DEFEAT automatically.
	 * When false (default), the Runtime keeps the deterministic Phase-1
	 * simulation API (`advancePhase`/`runToCompletion`) — the two modes are
	 * mutually exclusive by construction.
	 */
	readonly interactiveTurns?: boolean;
}

/** Result of a RollDiceIntent forwarded to the Runtime (SPEC-022 validation). */
export type RollDiceIntentResult =
	| { readonly status: "ok" }
	| {
			readonly status: "rejected";
			readonly reason:
				| "not_in_player_turns"
				| "no_active_turn"
				| "not_active_player"
				| "already_rolled"
				| "turn_in_progress";
	  };

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
	/** Interactive mode (Vertical Slice): PLAYER_TURNS drives real turns. */
	private readonly interactive: boolean;
	/** Index into `turnOrder` of the turn being played (interactive mode). */
	private turnIndex = 0;

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
			seed: this.seed,
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

		// Interactive turn sequencing (Vertical Slice): the Runtime is the sole
		// sequencer (SPEC-005 "Solo el Runtime cambia de jugador") — every finished
		// turn (intent, timeout or disconnect) hands the baton to the next player
		// or closes the round. Subscribed once; inert unless interactive.
		this.interactive = options.interactiveTurns ?? false;
		if (this.interactive) {
			this.bus.on("PlayerTurnFinished", () => {
				this.onInteractiveTurnFinished();
			});
		}
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

	/** Live round number (0 before ROUND_START) — snapshot builders (SPEC-022). */
	get currentRound(): number {
		return this.round;
	}

	/** The fixed play order (D13); empty before INITIALIZING computed it. */
	get playOrder(): readonly number[] {
		return this.turnOrder;
	}

	/** Participant user ids (admission order) — populated from construction. */
	get participants(): readonly number[] {
		return this.participantIds;
	}

	/** `settings.maxRound` (SPEC-024) — exposed for the visible snapshot. */
	get maxRound(): number {
		return this.settings.maxRound;
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

		// Interactive mode enters PLAYER_TURNS immediately and opens the first
		// real turn; simulation mode stops here and is driven by advancePhase().
		if (this.interactive) {
			this.beginPlayerTurns();
		}
	}

	// ── Intents (SPEC-022: clients only REQUEST; the server validates) ────

	/**
	 * RollDiceIntent entry point (Vertical Slice, SPEC-022 "Validación"): the
	 * ONLY gameplay action a client may request in this slice. Valid only in
	 * interactive mode, during PLAYER_TURNS, for the active player who has not
	 * rolled — everything else is a rejection that never touches the Runtime.
	 * The Turn System owns the roll→move→resolve pipeline (SPEC-005).
	 */
	handleRollDice(playerId: number): RollDiceIntentResult {
		if (!this.interactive || this.machine.currentPhase !== "PLAYER_TURNS") {
			return { status: "rejected", reason: "not_in_player_turns" };
		}
		const result = this.engines.turnSystem.requestRoll(playerId);
		return result.status === "ok"
			? { status: "ok" }
			: { status: "rejected", reason: result.reason };
	}

	/**
	 * A participant disconnected (SPEC-005 "Desconexión" / SPEC-023): if it is
	 * their turn, the Turn System auto-resolves it immediately; otherwise a
	 * no-op. Synchronization concerns (rooms, snapshots) stay in the gateway.
	 */
	handlePlayerDisconnect(playerId: number): void {
		this.engines.turnSystem.handleDisconnect(playerId);
	}

	/**
	 * Advances exactly one legal phase-step using the Phase-1 stub decisions
	 * (SPEC-001, empty-gameplay branches documented per case below). No-op on
	 * a terminal phase or on a phase this Phase-1 Runtime does not drive
	 * (CREATED/WAITING_PLAYERS/INITIALIZING — only `start()` walks those).
	 */
	advancePhase(): TournamentPhase {
		if (this.interactive) {
			// The interactive driver sequences phases itself; mixing the two
			// modes would double-drive the machine (documented exclusivity).
			this.logger.warn("advancePhase ignored: Runtime is in interactive mode");
			return this.machine.currentPhase;
		}
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
	private resolveCheckKeyItems(): boolean {
		if (this.round < this.settings.maxRound) {
			this.emitRuntimeEvent("RoundFinished", { round: this.round });
			this.enterRoundStart(this.round + 1);
			return true;
		}

		// Anti-stall exit (D3, SPEC-040): max round reached without completing
		// Key Items → collective DEFEAT → FINISHED, winnerUserId null.
		this.machine.requestTransition("DEFEAT");
		this.emitRuntimeEvent("TournamentFinished", { winnerUserId: null });
		this.machine.requestTransition("FINISHED");
		return false;
	}

	// ── Interactive turn loop (Vertical Slice) ────────────────────────────

	/**
	 * Enters PLAYER_TURNS and opens the first turn of the round (SPEC-005: the
	 * Runtime sequences, the Turn System owns the single active turn — its roll
	 * timeout auto-resolves an idle player, so an unattended tournament always
	 * progresses to the D3 anti-stall exit).
	 */
	private beginPlayerTurns(): void {
		this.machine.requestTransition("PLAYER_TURNS");
		this.turnIndex = 0;
		this.startTurnAt(0);
	}

	private startTurnAt(index: number): void {
		const playerId = this.turnOrder[index];
		if (playerId === undefined) {
			this.finishInteractiveRound();
			return;
		}
		this.machine.setActivePlayer(playerId);
		this.engines.turnSystem.startTurn(playerId);
	}

	/** PlayerTurnFinished (intent, timeout or disconnect): next player or close. */
	private onInteractiveTurnFinished(): void {
		if (this.machine.currentPhase !== "PLAYER_TURNS") {
			return;
		}
		this.turnIndex += 1;
		if (this.turnIndex < this.turnOrder.length) {
			this.startTurnAt(this.turnIndex);
			return;
		}
		this.machine.setActivePlayer(null);
		this.finishInteractiveRound();
	}

	/**
	 * Closes the round after the last turn: MINIGAME stays the documented
	 * Phase-1 "omitted" skip (the socket-bound minigame adapter is a later
	 * integration), then CHECK_KEY_ITEMS loops the round or exits via DEFEAT.
	 * A continuing round re-enters PLAYER_TURNS immediately.
	 */
	private finishInteractiveRound(): void {
		this.machine.requestTransition("MINIGAME");
		this.machine.requestTransition("CHECK_KEY_ITEMS");
		if (this.resolveCheckKeyItems()) {
			this.beginPlayerTurns();
		}
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
