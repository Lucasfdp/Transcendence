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
	PurchaseRejectionReason,
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
	MinigameCatalogPort,
	MinigameLauncherPort,
	MinigameLifecyclePort,
	MinigameReconcilerPort,
} from "../minigame/minigame.types";
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
	/** The champion once VICTORY resolves (SPEC-021); null until/unless then. */
	readonly winnerUserId: number | null;
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
	 * timeout/disconnect auto-resolution — then the round continues MINIGAME →
	 * GAMBLING → CHECK_KEY_ITEMS → next round / endgame automatically.
	 * When false (default), the Runtime keeps the deterministic Phase-1
	 * simulation API (`advancePhase`/`runToCompletion`) — the two modes are
	 * mutually exclusive by construction.
	 */
	readonly interactiveTurns?: boolean;
	/**
	 * Live platform ports for the round minigame (SPEC-015), forwarded to the
	 * engine composition. Absent ⇒ inert defaults (the round's minigame is
	 * skipped/cancelled cleanly — the Phase-1 behaviour).
	 */
	readonly minigamePorts?: {
		readonly launcher?: MinigameLauncherPort;
		readonly lifecycle?: MinigameLifecyclePort;
		readonly reconciler?: MinigameReconcilerPort;
		readonly catalog?: MinigameCatalogPort;
	};
	/**
	 * CPU participants (CPU v2, from the lobby record): in interactive mode
	 * the Runtime plays their board turns (delayed roll via the injected
	 * clock — deterministic) and their gambling decision (bet when the stake
	 * is affordable, else pass). Humans and bots share every validation path.
	 */
	readonly botPlayerIds?: readonly number[];
	/**
	 * Interactive mode only: how long to hold the FIRST round's turns open for
	 * players to reach the board (the lobby's start → board navigation takes a
	 * poll interval + a page load per client). Turns begin as soon as every
	 * human has connected, or when this grace expires — whichever comes first.
	 * 0 (default) starts turn 1 immediately (the pre-gate behaviour, and what
	 * most unit tests expect).
	 */
	readonly firstTurnsGraceMs?: number;
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

/** Result of a StartGamblingIntent (SPEC-016/SPEC-022 validation). */
export type GamblingIntentResult =
	| { readonly status: "ok" }
	| {
			readonly status: "rejected";
			readonly reason:
				| "not_in_gambling_phase"
				| "no_session"
				| "not_winner"
				| "insufficient_points"
				| "error";
	  };

/**
 * Result of a BuyOfferIntent (SPEC-012/SPEC-022 validation). The rejection
 * reasons mirror the Shop System's own `PurchaseRejectionReason` plus the
 * Runtime-level gates (wrong phase / not the open session's player).
 */
export type ShopIntentResult =
	| { readonly status: "ok" }
	| {
			readonly status: "rejected";
			readonly reason:
				| "not_in_player_turns"
				| "no_open_shop"
				| PurchaseRejectionReason;
	  };

/** Safety bound for `runToCompletion` — see the method's doc comment. */
const DEFAULT_MAX_RUN_STEPS = 1000;

/** Backoff before re-entering a stalled Final Challenge (SPEC-021). */
const FINAL_CHALLENGE_RETRY_MS = 30_000;

/** Human-ish pause before a CPU participant acts (deterministic clock delay). */
const BOT_TURN_DELAY_MS = 1_500;
const BOT_GAMBLING_DELAY_MS = 2_500;
const BOT_SHOP_DELAY_MS = 2_000;

/**
 * Grace before a disconnect auto-resolves the leaver's active turn (or open
 * gambling decision). A LEAVE is fired on EVERY board unmount — including the
 * mount/unmount/mount cycle React StrictMode runs in dev and brief
 * navigations — so resolving instantly skipped players who were actually
 * arriving (their rejoin lands milliseconds after the leave). The turn
 * system's own roll timeout stays the real backstop.
 */
const DISCONNECT_RESOLVE_GRACE_MS = 3_000;

/**
 * Pause between a resolved roll and the NEXT turn (or the round's minigame):
 * the boards are presenting that roll — suspense + value reveal + the token's
 * tile-by-tile walk (~2.3 s) — so the baton only passes once the piece has
 * visibly landed. Purely presentation pacing; the roll itself is long final.
 */
const TURN_HANDOFF_MS = 2_600;

/** MINIGAME TIME! gate: minimum hold + confirmation deadline (SPEC-015 v2). */
const MINIGAME_GATE_MIN_MS = 1_500;
const MINIGAME_GATE_TIMEOUT_MS = 20_000;

/**
 * Hold after a RESOLVED bet (won/lost) before the round continues, so every
 * board can present the Key-Item gamble's outcome (SPEC-016). Passing /
 * timing out needs no reveal — those resume immediately.
 */
const GAMBLE_RESULT_HOLD_MS = 4_000;

/**
 * Tie-break audience gate: spin anyway when this passes (covers the arena's
 * 15 s CONTINUE auto-return + navigation; a player who never comes back can
 * never hold the roulette hostage).
 */
const TIE_BREAK_ARRIVAL_TIMEOUT_MS = 20_000;

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
	/**
	 * True while the baton is held for an open shop session (SPEC-012
	 * "Protocolo": the turn waits for ShopClosed). Set when a turn finishes
	 * with the shopper still browsing; the ShopClosed subscription resumes
	 * the normal handoff.
	 */
	private shopHoldPending = false;
	/** The champion once VICTORY resolves (SPEC-021); null until then. */
	private winnerUserId: number | null = null;
	/**
	 * CPU participants whose board/gambling decisions this Runtime plays.
	 * Mutable: a human who quits the match for good is converted into a CPU
	 * (`convertPlayerToBot`) so the tournament plays on in their place.
	 */
	private readonly botPlayerIds: Set<number>;
	/** Players currently connected to the board (gateway join/leave signals). */
	private readonly connectedPlayers = new Set<number>();
	/** True while round 1's turns are held open for players to arrive. */
	private firstTurnsPending = false;
	private readonly firstTurnsGraceMs: number;
	/**
	 * The most recent resolved dice roll (presentation data for the snapshot:
	 * the board client reveals the value and walks the token, SPEC-022 — the
	 * authoritative position is already in the players' tileIds).
	 */
	private lastRollState: {
		readonly playerId: number;
		readonly round: number;
		readonly value: number;
		readonly autoResolved: boolean;
	} | null = null;
	/**
	 * The most recent RESOLVED Key-Item bet (presentation data, like
	 * `lastRollState`): the boards banner "won a Key Item!" / "lost the bet"
	 * while the round holds for the reveal.
	 */
	private lastGambleState: {
		readonly playerId: number;
		readonly round: number;
		readonly won: boolean;
		readonly cost: number;
	} | null = null;

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
			minigameLauncher: options.minigamePorts?.launcher,
			minigameLifecycle: options.minigamePorts?.lifecycle,
			minigameReconciler: options.minigamePorts?.reconciler,
			minigameCatalog: options.minigamePorts?.catalog,
			// MINIGAME TIME! gate (interactive only): every human confirms the
			// launch; CPU seats and players with no live board never block.
			minigameLaunchGate: options.interactiveTurns
				? {
						minMs: MINIGAME_GATE_MIN_MS,
						timeoutMs: MINIGAME_GATE_TIMEOUT_MS,
						isAutoReady: (playerId) =>
							this.botPlayerIds.has(playerId) ||
							!this.connectedPlayers.has(playerId),
					}
				: undefined,
			// Tie-break audience gate (interactive only): the roulette waits
			// for the boards returning from the arena so everyone watches the
			// SAME spin — presence is a live connection (CPUs always present).
			minigameTieBreakGate: options.interactiveTurns
				? {
						arrivalTimeoutMs: TIE_BREAK_ARRIVAL_TIMEOUT_MS,
						isPresent: (playerId) =>
							this.botPlayerIds.has(playerId) ||
							this.connectedPlayers.has(playerId),
					}
				: undefined,
		});

		// Persistence hook (see file header): one subscription covers every
		// transition, including cancel() → CANCELLED.
		this.bus.on("TransitionCompleted", () => {
			this.onSnapshot(this.buildSnapshot());
		});

		// Record every resolved roll for the snapshot (presentation: the board
		// client reveals the value and walks the token before settling on the
		// authoritative position — SPEC-022 keeps gameplay server-side).
		this.bus.on("PlayerTurnFinished", (event) => {
			if (event.playerId !== null) {
				this.lastRollState = {
					playerId: event.playerId,
					round: event.round,
					value: event.payload.diceValue,
					autoResolved: event.payload.autoResolved,
				};
			}
		});
		// Record every RESOLVED Key-Item bet for the snapshot — the boards
		// banner the outcome while the round holds for the reveal (SPEC-016).
		this.bus.on("GamblingWon", (event) => {
			if (event.playerId !== null) {
				this.lastGambleState = {
					playerId: event.playerId,
					round: event.round,
					won: true,
					cost: event.payload.cost,
				};
			}
		});
		this.bus.on("GamblingLost", (event) => {
			if (event.playerId !== null) {
				this.lastGambleState = {
					playerId: event.playerId,
					round: event.round,
					won: false,
					cost: event.payload.cost,
				};
			}
		});

		// Interactive turn sequencing (Vertical Slice): the Runtime is the sole
		// sequencer (SPEC-005 "Solo el Runtime cambia de jugador") — every finished
		// turn (intent, timeout or disconnect) hands the baton to the next player
		// or closes the round. Subscribed once; inert unless interactive.
		this.interactive = options.interactiveTurns ?? false;
		this.botPlayerIds = new Set(options.botPlayerIds ?? []);
		this.firstTurnsGraceMs = options.firstTurnsGraceMs ?? 0;
		if (this.interactive) {
			this.bus.on("PlayerTurnFinished", () => {
				this.onInteractiveTurnFinished();
			});
			// ShopClosed fires on EVERY session close (purchase, cancel, timeout,
			// empty catalog — SPEC-012 "Protocolo"), so one subscription resumes
			// a turn held for the shop window: the shopper landed on the shop
			// tile, the turn finished, and the baton waited for this fact.
			this.bus.on("ShopClosed", () => {
				if (!this.shopHoldPending || this.machine.currentPhase !== "PLAYER_TURNS") {
					return;
				}
				this.shopHoldPending = false;
				this.scheduleTurnHandoff();
			});
			// GamblingFinished fires on EVERY close (bet won/lost, abandon,
			// timeout — SPEC-016), so one subscription resumes the round. A
			// RESOLVED bet holds first so every board presents the outcome;
			// passing/timing out resumes immediately (nothing to reveal).
			this.bus.on("GamblingFinished", (event) => {
				if (this.machine.currentPhase !== "GAMBLING_PHASE") {
					return;
				}
				const outcome = event.payload.outcome;
				if (outcome !== "won" && outcome !== "lost") {
					this.enterCheckKeyItems();
					return;
				}
				this.clock.schedule(GAMBLE_RESULT_HOLD_MS, () => {
					if (
						!this.machine.isTerminal &&
						this.machine.currentPhase === "GAMBLING_PHASE"
					) {
						this.enterCheckKeyItems();
					}
				});
			});
		}
		// CPU participants (CPU v2): decide through the SAME intent entry
		// points as humans, after a clock delay (deterministic under a
		// ManualClock; human-ish pacing under the SystemClock). Always wired in
		// interactive mode (the handlers check membership at event time), so a
		// human converted into a CPU mid-game (`convertPlayerToBot`) is driven
		// from their very next turn even when the table started with 0 bots.
		if (this.interactive) {
			this.bus.on("PlayerTurnStarted", (event) => {
				const playerId = event.playerId;
				if (playerId === null || !this.botPlayerIds.has(playerId)) {
					return;
				}
				this.clock.schedule(BOT_TURN_DELAY_MS, () => {
					this.handleRollDice(playerId);
				});
			});
			this.bus.on("GamblingOpened", (event) => {
				const winnerId = event.playerId;
				if (winnerId === null || !this.botPlayerIds.has(winnerId)) {
					return;
				}
				this.clock.schedule(BOT_GAMBLING_DELAY_MS, () => {
					this.decideBotGambling(winnerId);
				});
			});
			this.bus.on("ShopOpened", (event) => {
				const playerId = event.playerId;
				if (playerId === null || !this.botPlayerIds.has(playerId)) {
					return;
				}
				this.clock.schedule(BOT_SHOP_DELAY_MS, () => {
					this.decideBotShop(playerId);
				});
			});
		}
	}

	/**
	 * CPU shop policy: buy the first offer that is available and affordable,
	 * else browse away — through the SAME intent entry points as humans. The
	 * session timeout is the backstop if the buy is rejected anyway.
	 */
	private decideBotShop(playerId: number): void {
		if (this.engines.shop.openSessionPlayerId !== playerId) {
			return; // session already closed (timeout raced the delay)
		}
		const balance = this.engines.economy.getBalance(playerId) ?? 0;
		const pick = this.engines.shop
			.getCatalogView(playerId, this.round)
			.find((offer) => offer.available && offer.price <= balance);
		if (pick === undefined) {
			this.handleEndTurn(playerId);
			return;
		}
		const result = this.handleBuyOffer(playerId, pick.id);
		if (result.status !== "ok") {
			this.handleEndTurn(playerId);
		}
	}

	/** CPU gambling policy: bet whenever the stake is affordable, else pass. */
	private decideBotGambling(winnerId: number): void {
		if (this.machine.currentPhase !== "GAMBLING_PHASE") {
			return; // session already closed (timeout raced the delay)
		}
		const balance = this.engines.economy.getBalance(winnerId) ?? 0;
		if (balance >= this.settings.gambling.cost) {
			this.handleStartGambling(winnerId);
		} else {
			this.handleLeaveGambling(winnerId);
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

	/** The champion once VICTORY resolves (SPEC-021); null until/unless then. */
	get winner(): number | null {
		return this.winnerUserId;
	}

	/** CPU participants (CPU v2 + converted quitters) — for the wire snapshot. */
	get botPlayers(): ReadonlySet<number> {
		return this.botPlayerIds;
	}

	/** The most recent resolved dice roll — for the wire snapshot (SPEC-022). */
	get lastRoll(): {
		readonly playerId: number;
		readonly round: number;
		readonly value: number;
		readonly autoResolved: boolean;
	} | null {
		return this.lastRollState;
	}

	/** The most recent resolved Key-Item bet — for the wire snapshot (SPEC-016). */
	get lastGamble(): {
		readonly playerId: number;
		readonly round: number;
		readonly won: boolean;
		readonly cost: number;
	} | null {
		return this.lastGambleState;
	}

	/**
	 * How many seats are still played by a real human (not a CPU, including
	 * humans converted to CPUs by `convertPlayerToBot`). Zero means the match
	 * has no real players left — the caller tears the tournament down rather
	 * than let an all-CPU game and its minigames run on in limbo.
	 */
	get humanPlayerCount(): number {
		return this.turnOrder.filter((id) => !this.botPlayerIds.has(id)).length;
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

		// Interactive mode opens the first real turn; simulation mode stops
		// here and is driven by advancePhase(). With a first-turns grace, the
		// round holds in ROUND_START until every human reached the board (the
		// lobby's start → board navigation takes a poll + a page load per
		// client) or the grace expires — otherwise turn 1 would be burning (or
		// auto-resolving) against players who never saw it start.
		if (this.interactive) {
			if (this.firstTurnsGraceMs > 0 && !this.allHumansConnected()) {
				this.firstTurnsPending = true;
				this.clock.schedule(this.firstTurnsGraceMs, () => {
					this.beginFirstTurnsIfPending();
				});
			} else {
				this.beginPlayerTurns();
			}
		}
	}

	/** Every human seat has a connected board client (bots count as present). */
	private allHumansConnected(): boolean {
		return this.turnOrder.every(
			(id) => this.botPlayerIds.has(id) || this.connectedPlayers.has(id),
		);
	}

	/** Opens round 1's turns once (player-arrival gate or grace expiry). */
	private beginFirstTurnsIfPending(): void {
		if (!this.firstTurnsPending || this.machine.isTerminal) {
			return;
		}
		this.firstTurnsPending = false;
		this.beginPlayerTurns();
	}

	/**
	 * A participant's board client joined the tournament room (gateway JOIN).
	 * Cancels any pending disconnect auto-resolve for them (the grace check
	 * reads `connectedPlayers` at fire time) and, while round 1 is held open,
	 * starts the turns as soon as the last human arrives.
	 */
	handlePlayerConnected(playerId: number): void {
		this.connectedPlayers.add(playerId);
		if (this.firstTurnsPending && this.allHumansConnected()) {
			this.beginFirstTurnsIfPending();
		}
		// A waiting tie-break roulette may now have its full audience.
		this.engines.minigame.notifyPresenceChanged();
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
	 * StartGamblingIntent (SPEC-016 "Flujo"): the round's minigame winner asks
	 * to bet. Valid only during GAMBLING_PHASE; the engine re-validates the
	 * caller (only the session winner may bet) and resolves provably fair.
	 */
	handleStartGambling(playerId: number): GamblingIntentResult {
		if (!this.interactive || this.machine.currentPhase !== "GAMBLING_PHASE") {
			return { status: "rejected", reason: "not_in_gambling_phase" };
		}
		const result = this.engines.gambling.bet(playerId);
		if (result.status === "won" || result.status === "lost") {
			return { status: "ok" };
		}
		return { status: "rejected", reason: result.reason };
	}

	/**
	 * LeaveGamblingIntent (SPEC-016): the winner declines. The engine ignores
	 * non-winners; closing emits GamblingFinished which resumes the round.
	 */
	handleLeaveGambling(playerId: number): void {
		if (this.interactive && this.machine.currentPhase === "GAMBLING_PHASE") {
			this.engines.gambling.abandon(playerId);
		}
	}

	/**
	 * ConfirmMinigameIntent ("Let's go!", SPEC-015 v2): the player confirms
	 * the MINIGAME TIME! gate. The coordinator validates (gate open, seated,
	 * not already ready) and launches once everyone required confirmed.
	 */
	handleConfirmMinigame(
		playerId: number,
	): { status: "ok" } | { status: "rejected"; reason: string } {
		if (!this.interactive) {
			return { status: "rejected", reason: "no_launch_gate" };
		}
		return this.engines.minigame.confirmLaunch(playerId);
	}

	/**
	 * BuyOfferIntent (SPEC-012 "Compra"): the open shop session's player asks
	 * to buy. Valid only in interactive mode during PLAYER_TURNS while THEIR
	 * session is open; the Shop re-validates the offer (exists / requirements /
	 * stock / funds) and keeps the session open on a rejection so the player
	 * may try another offer. A successful purchase closes the session, which
	 * resumes the held turn handoff via ShopClosed.
	 */
	handleBuyOffer(playerId: number, offerId: string): ShopIntentResult {
		if (!this.interactive || this.machine.currentPhase !== "PLAYER_TURNS") {
			return { status: "rejected", reason: "not_in_player_turns" };
		}
		if (this.engines.shop.openSessionPlayerId !== playerId) {
			return { status: "rejected", reason: "no_open_shop" };
		}
		const result = this.engines.shop.buy(playerId, offerId);
		return result.status === "purchased"
			? { status: "ok" }
			: { status: "rejected", reason: result.reason };
	}

	/**
	 * EndTurnIntent (SPEC-005 interaction window): the shopper is done — close
	 * the shop session without buying (SPEC-012 "Cancel"). ShopClosed then
	 * resumes the held handoff. Rejected when the caller has no open session.
	 */
	handleEndTurn(playerId: number): ShopIntentResult {
		if (!this.interactive || this.machine.currentPhase !== "PLAYER_TURNS") {
			return { status: "rejected", reason: "not_in_player_turns" };
		}
		if (this.engines.shop.openSessionPlayerId !== playerId) {
			return { status: "rejected", reason: "no_open_shop" };
		}
		this.engines.shop.cancel(playerId);
		return { status: "ok" };
	}

	/**
	 * A participant disconnected (SPEC-005 "Desconexión" / SPEC-023): after a
	 * short grace, if they have not reconnected, the Turn System auto-resolves
	 * their active turn and any open gambling decision of theirs closes as
	 * abandoned (SPEC-016 "Desconexión"); otherwise a no-op. The grace exists
	 * because the board fires LEAVE on every unmount — StrictMode's dev
	 * mount cycle and quick navigations rejoin within milliseconds, and
	 * resolving instantly was skipping players who were actually arriving.
	 * Synchronization concerns (rooms, snapshots) stay in the gateway.
	 */
	handlePlayerDisconnect(playerId: number): void {
		this.connectedPlayers.delete(playerId);
		this.clock.schedule(DISCONNECT_RESOLVE_GRACE_MS, () => {
			if (this.connectedPlayers.has(playerId) || this.machine.isTerminal) {
				return; // reconnected in time (or nothing left to resolve)
			}
			this.engines.turnSystem.handleDisconnect(playerId);
			if (this.machine.currentPhase === "GAMBLING_PHASE") {
				this.engines.gambling.abandon(playerId);
			}
			// An open shop session of theirs closes too (SPEC-012: cancel only
			// acts on the caller's own session) so the held baton moves on.
			this.engines.shop.cancel(playerId);
		});
	}

	/**
	 * Replace a departed human with a CPU (the "Leave match" quit flow, SPEC-005
	 * "Desconexión" taken to its permanent end): the player keeps their seat,
	 * points and turn-order position, but from now on the Runtime plays their
	 * board turns and gambling decisions exactly like a lobby CPU (CPU v2) —
	 * through the SAME validated intent entry points, so nothing about the game
	 * changes except who decides. If they own the live decision right now (their
	 * active turn, or the open gambling session), the CPU takes it over
	 * immediately so the round never stalls; the roll timeout is the backstop
	 * either way. Idempotent; ignores non-participants and existing bots.
	 * Minigames need no handling — a socket-less participant is already seated
	 * by the bot stand-in (CPU v1).
	 */
	convertPlayerToBot(playerId: number): void {
		if (!this.interactive || this.botPlayerIds.has(playerId)) {
			return;
		}
		if (!this.turnOrder.includes(playerId)) {
			return;
		}
		this.botPlayerIds.add(playerId);

		// The PlayerTurnStarted / GamblingOpened event that arms the CPU already
		// fired for the CURRENT decision before this conversion, so drive that
		// one decision here; every future turn is handled by the subscriptions.
		if (
			this.machine.currentPhase === "PLAYER_TURNS" &&
			this.engines.turnSystem.activePlayerId === playerId
		) {
			this.clock.schedule(BOT_TURN_DELAY_MS, () => {
				this.handleRollDice(playerId);
			});
		} else if (
			this.machine.currentPhase === "GAMBLING_PHASE" &&
			this.engines.gambling.serialize().session?.winnerId === playerId
		) {
			this.clock.schedule(BOT_GAMBLING_DELAY_MS, () => {
				this.decideBotGambling(playerId);
			});
		} else if (this.engines.shop.openSessionPlayerId === playerId) {
			this.clock.schedule(BOT_SHOP_DELAY_MS, () => {
				this.decideBotShop(playerId);
			});
		}

		// If round 1 was being held open for arrivals and the quitter was the
		// last missing human, the wait is over — start the turns now.
		if (this.firstTurnsPending && this.allHumansConnected()) {
			this.beginFirstTurnsIfPending();
		}
		// A CPU seat is always "present": release any waiting tie-break gate.
		this.engines.minigame.notifyPresenceChanged();
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

	/**
	 * PlayerTurnFinished (intent, timeout or disconnect): next player or close.
	 * The baton passes AFTER a handoff pause — the boards are presenting the
	 * resolved roll (value reveal + token walk), so the next turn (or the
	 * round's minigame) only opens once the piece has visibly landed.
	 *
	 * Landing on the shop tile opens a shop session DURING tile resolution
	 * (SPEC-012), so by the time this fact arrives the session is already open:
	 * the baton then waits for ShopClosed (the interaction window, SPEC-005)
	 * before the handoff pause runs — the session's own timeout is the backstop.
	 */
	private onInteractiveTurnFinished(): void {
		if (this.machine.currentPhase !== "PLAYER_TURNS") {
			return;
		}
		this.turnIndex += 1;
		if (this.engines.shop.openSessionPlayerId !== null) {
			this.shopHoldPending = true;
			return; // the ShopClosed subscription schedules the handoff
		}
		this.scheduleTurnHandoff();
	}

	/** The handoff pause → next turn or round close (see onInteractiveTurnFinished). */
	private scheduleTurnHandoff(): void {
		this.clock.schedule(TURN_HANDOFF_MS, () => {
			if (this.machine.isTerminal || this.machine.currentPhase !== "PLAYER_TURNS") {
				return;
			}
			if (this.turnIndex < this.turnOrder.length) {
				this.startTurnAt(this.turnIndex);
				return;
			}
			this.machine.setActivePlayer(null);
			this.finishInteractiveRound();
		});
	}

	/**
	 * Closes the round after the last turn (SPEC-001 round pipeline): MINIGAME
	 * runs through the SPEC-015 coordinator (real matches when the socket
	 * adapter is wired; a clean skip/cancel otherwise), its winner gets the
	 * GAMBLING_PHASE decision (SPEC-016), then CHECK_KEY_ITEMS loops the
	 * round, opens the endgame, or exits via DEFEAT.
	 */
	private finishInteractiveRound(): void {
		this.machine.requestTransition("MINIGAME");
		void this.runMinigamePhase();
	}

	/**
	 * MINIGAME (SPEC-015): one match per round with every seated player. The
	 * coordinator owns selection/launch/wait/watchdog and awards the outcome
	 * points itself; the Runtime only routes the resulting winner. Skipped or
	 * cancelled minigames continue the round with no winner (SPEC-001).
	 */
	private async runMinigamePhase(): Promise<void> {
		let winnerId: number | null = null;
		try {
			const result = await this.engines.minigame.run([...this.turnOrder], this.round);
			if (result.status === "completed") {
				winnerId = result.winnerId;
			}
		} catch (error) {
			this.logger.error("minigame phase failed; continuing round with no winner", {
				metadata: { error: error instanceof Error ? error.message : String(error) },
			});
		}
		if (this.machine.isTerminal) {
			return; // cancelled while the match ran
		}
		if (winnerId !== null) {
			this.enterGambling(winnerId);
			return;
		}
		this.enterCheckKeyItems();
	}

	/**
	 * GAMBLING_PHASE (SPEC-016): the round's minigame winner may bet points
	 * for a Key Item. The win probability is base + pity per elapsed round
	 * (SPEC-024 `gambling`), computed HERE (the Runtime owns pity, never the
	 * engine). The phase closes through the engine's own bet/abandon/timeout —
	 * all of which emit GamblingFinished, which resumes the round.
	 */
	private enterGambling(winnerId: number): void {
		this.machine.requestTransition("GAMBLING_PHASE");
		const gambling = this.settings.gambling;
		const winChance = Math.min(
			1,
			gambling.baseWinChance +
				gambling.pityIncrementPerRound * Math.max(0, this.round - 1),
		);
		const opened = this.engines.gambling.open(winnerId, winChance, this.round);
		if (opened.status !== "opened") {
			// No locked Key Items remain (or a session raced): nothing to bet on.
			this.enterCheckKeyItems();
		}
	}

	/**
	 * CHECK_KEY_ITEMS (SPEC-001/SPEC-017): all Key Items unlocked → the
	 * endgame (BOSS_EVENT); otherwise loop the round or exit via the D3
	 * anti-stall DEFEAT.
	 */
	private enterCheckKeyItems(): void {
		this.machine.requestTransition("CHECK_KEY_ITEMS");
		if (this.engines.keyItems.isComplete()) {
			this.enterBossEvent();
			return;
		}
		if (this.resolveCheckKeyItems()) {
			this.beginPlayerTurns();
		}
	}

	// ── Endgame (SPEC-020/021, F5 engines driven live) ────────────────────

	/**
	 * BOSS_EVENT (SPEC-020): the Boss spawns (guarded by Key Item completion,
	 * which CHECK_KEY_ITEMS just verified), activates its Rules and hands over
	 * its Final Challenge. The Boss is a synchronous orchestrator, so the
	 * machine proceeds to FINAL_CHALLENGE immediately after the intro.
	 */
	private enterBossEvent(): void {
		this.machine.requestTransition("BOSS_EVENT");
		const spawn = this.engines.boss.spawn(this.round);
		if (spawn.status === "rejected") {
			// Structurally unreachable (the gate was just checked); never stall.
			this.logger.error("boss spawn rejected after key-item completion");
			if (this.resolveCheckKeyItems()) {
				this.beginPlayerTurns();
			}
			return;
		}
		this.machine.requestTransition("FINAL_CHALLENGE");
		void this.runFinalChallenge(false);
	}

	/**
	 * FINAL_CHALLENGE (SPEC-021): sudden death through the SAME minigame
	 * pipeline until a unique winner takes THE PARROT'S SHELL. A stalled
	 * challenge (minigame could not run) stays ACTIVE per SPEC-021 "Error
	 * interno" and is retried through the injected clock.
	 */
	private async runFinalChallenge(resume: boolean): Promise<void> {
		try {
			const result = resume
				? await this.engines.finalChallenge.resume()
				: await this.engines.finalChallenge.start();
			if (this.machine.isTerminal) {
				return;
			}
			if (result.status === "finished") {
				this.completeVictory(result.winnerId);
				return;
			}
			if (result.status === "stalled") {
				this.logger.warn("final challenge stalled; retrying", {
					metadata: { reason: result.reason },
				});
				this.clock.schedule(FINAL_CHALLENGE_RETRY_MS, () => {
					void this.runFinalChallenge(true);
				});
			}
		} catch (error) {
			this.logger.error("final challenge crashed; retrying", {
				metadata: { error: error instanceof Error ? error.message : String(error) },
			});
			this.clock.schedule(FINAL_CHALLENGE_RETRY_MS, () => {
				void this.runFinalChallenge(true);
			});
		}
	}

	/**
	 * VICTORY → REWARDS → FINISHED (SPEC-001/SPEC-021 "Victoria"): the Shell
	 * holder is the champion. The Boss removes its Rules, the machine walks
	 * the terminal pipeline and TournamentFinished carries the winner — the
	 * persistence layer records `winnerUserId` and grants the persistent
	 * rewards (SPEC-037/D10) off this snapshot.
	 */
	private completeVictory(winnerId: number): void {
		this.engines.boss.finish(this.round);
		this.winnerUserId = winnerId;
		this.machine.setActivePlayer(null);
		this.machine.requestTransition("VICTORY");
		this.machine.requestTransition("REWARDS");
		this.emitRuntimeEvent("RewardsGranted", { round: this.round });
		this.emitRuntimeEvent("TournamentFinished", { winnerUserId: winnerId });
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
			winnerUserId: this.winnerUserId,
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
