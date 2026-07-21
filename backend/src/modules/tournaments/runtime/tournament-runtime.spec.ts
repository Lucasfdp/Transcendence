import { Logger } from "@nestjs/common";
import { ManualClock } from "../infra/clock";
import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TOURNAMENT_SETTINGS_V1, TournamentSettings } from "../config/settings.catalog";
import { deriveTurnOrder } from "../turn-order.util";
import {
	OnRuntimeSnapshot,
	TournamentRuntime,
	TournamentRuntimeSnapshot,
} from "./tournament-runtime";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PARTICIPANT_IDS = [10, 20, 30, 40];

/** Small maxRound so a full DEFEAT run stays fast and readable in assertions. */
function makeSettings(overrides: Partial<TournamentSettings> = {}): TournamentSettings {
	return { ...TOURNAMENT_SETTINGS_V1, maxRound: 3, ...overrides };
}

function makeRuntime(
	overrides: Partial<{
		seed: string;
		settings: TournamentSettings;
		onSnapshot: OnRuntimeSnapshot;
	}> = {},
): TournamentRuntime {
	return new TournamentRuntime({
		tournamentId: TOURNAMENT_ID,
		seed: overrides.seed ?? "seed-a",
		participantIds: PARTICIPANT_IDS,
		settings: overrides.settings ?? makeSettings(),
		clock: new ManualClock(1_000),
		onSnapshot: overrides.onSnapshot ?? (() => undefined),
	});
}

describe("TournamentRuntime (SPEC-001, Phase-1 empty-gameplay)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("contains zero gameplay: never touches Math.random or Date.now (only the clock + seed)", () => {
		const randomSpy = jest.spyOn(Math, "random");
		const dateNowSpy = jest.spyOn(Date, "now");

		const runtime = makeRuntime();
		runtime.start();
		runtime.runToCompletion();

		expect(randomSpy).not.toHaveBeenCalled();
		expect(dateNowSpy).not.toHaveBeenCalled();
	});

	it("walks CREATED…FINISHED via DEFEAT for maxRound rounds, TournamentFinished has winnerUserId null", () => {
		const settings = makeSettings({ maxRound: 3 });
		const runtime = makeRuntime({ settings });
		const finished: AnyTournamentEvent[] = [];
		runtime.events.on("TournamentFinished", (event) => finished.push(event));

		const phasesEntered: string[] = [];
		runtime.events.on("StateEntered", (event) => phasesEntered.push(event.payload.state));

		runtime.start();
		runtime.runToCompletion();

		expect(runtime.currentPhase).toBe("FINISHED");
		expect(runtime.isTerminal).toBe(true);
		expect(finished).toHaveLength(1);
		expect(finished[0].payload).toEqual({ winnerUserId: null });

		// SPEC-001 flow order for a 3-round DEFEAT run: the session-mirroring
		// prelude, then 3x (ROUND_START, PLAYER_TURNS, MINIGAME, CHECK_KEY_ITEMS),
		// then DEFEAT → FINISHED. CREATED is intentionally absent: the state
		// machine enters CREATED (and emits its StateEntered) inside its own
		// constructor — before the Runtime, and therefore this listener, exist —
		// so it can never be observed via bus subscription. `currentPhase`
		// starting at CREATED (asserted elsewhere) is the observable proof of it.
		expect(phasesEntered).toEqual([
			"WAITING_PLAYERS",
			"INITIALIZING",
			"ROUND_START",
			"PLAYER_TURNS",
			"MINIGAME",
			"CHECK_KEY_ITEMS",
			"ROUND_START",
			"PLAYER_TURNS",
			"MINIGAME",
			"CHECK_KEY_ITEMS",
			"ROUND_START",
			"PLAYER_TURNS",
			"MINIGAME",
			"CHECK_KEY_ITEMS",
			"DEFEAT",
			"FINISHED",
		]);
	});

	it("advancePhase() progresses exactly one legal step per call", () => {
		const runtime = makeRuntime({ settings: makeSettings({ maxRound: 2 }) });
		runtime.start();
		expect(runtime.currentPhase).toBe("ROUND_START");

		expect(runtime.advancePhase()).toBe("PLAYER_TURNS");
		expect(runtime.advancePhase()).toBe("MINIGAME");
		expect(runtime.advancePhase()).toBe("CHECK_KEY_ITEMS");
		// round 1 < maxRound(2): loops back to ROUND_START for round 2.
		expect(runtime.advancePhase()).toBe("ROUND_START");
	});

	it("runToCompletion throws if the safety bound is exceeded (stall guard)", () => {
		const runtime = makeRuntime({ settings: makeSettings({ maxRound: 100 }) });
		runtime.start();

		expect(() => runtime.runToCompletion(5)).toThrow(/exceeded 5 steps/);
	});

	// ── Determinism (SPEC-028 "Determinismo") ───────────────────────────────

	it("same seed + participants ⇒ identical (event name, round) sequence and turnOrder", () => {
		function record(seed: string): {
			events: [string, number][];
			turnOrder: number[];
		} {
			const events: [string, number][] = [];
			const runtime = makeRuntime({ seed, settings: makeSettings({ maxRound: 3 }) });
			runtime.events.onAny((event) => events.push([event.name, event.round]));
			runtime.start();
			runtime.runToCompletion();
			return { events, turnOrder: deriveTurnOrder(seed, PARTICIPANT_IDS) };
		}

		const first = record("same-seed");
		const second = record("same-seed");

		expect(second.events).toEqual(first.events);
		expect(second.turnOrder).toEqual(first.turnOrder);
	});

	it("different seed ⇒ different turnOrder", () => {
		const orderA = deriveTurnOrder("seed-one", PARTICIPANT_IDS);
		const orderB = deriveTurnOrder("seed-two", PARTICIPANT_IDS);

		expect(orderA).not.toEqual(orderB);

		const runtimeA = makeRuntime({ seed: "seed-one" });
		const runtimeB = makeRuntime({ seed: "seed-two" });
		const activePlayers: number[] = [];
		runtimeA.events.on("RoundStarted", () => {
			activePlayers.push(orderA[0]);
		});
		runtimeB.events.on("RoundStarted", () => {
			activePlayers.push(orderB[0]);
		});
		runtimeA.start();
		runtimeB.start();

		expect(activePlayers[0]).not.toBe(activePlayers[1]);
	});

	// ── Persistence (SPEC-023 "tras cada transición") ───────────────────────

	it("persists a snapshot after EVERY transition, and only after a transition", () => {
		const snapshots: TournamentRuntimeSnapshot[] = [];
		let transitionCompletedCount = 0;
		const runtime = makeRuntime({
			settings: makeSettings({ maxRound: 3 }),
			onSnapshot: (snapshot) => snapshots.push(snapshot),
		});
		runtime.events.on("TransitionCompleted", () => {
			transitionCompletedCount++;
		});

		runtime.start();
		runtime.runToCompletion();

		expect(snapshots).toHaveLength(transitionCompletedCount);
		expect(snapshots.length).toBeGreaterThan(0);
		const last = snapshots[snapshots.length - 1];
		expect(last.machine.phase).toBe("FINISHED");
		expect(last.seed).toBe("seed-a");
		expect(last.participantIds).toEqual(PARTICIPANT_IDS);
		expect(last.turnOrder).toEqual(deriveTurnOrder("seed-a", PARTICIPANT_IDS));
		expect(last.settingsId).toBe(TOURNAMENT_SETTINGS_V1.id);
	});

	it("the round-1 ROUND_START snapshot already carries round=1 and the first active player", () => {
		const snapshots: TournamentRuntimeSnapshot[] = [];
		const runtime = makeRuntime({ onSnapshot: (s) => snapshots.push(s) });

		runtime.start();

		const roundStartSnapshot = snapshots.find((s) => s.machine.phase === "ROUND_START");
		expect(roundStartSnapshot?.machine.round).toBe(1);
		expect(roundStartSnapshot?.machine.activePlayerId).toBe(
			deriveTurnOrder("seed-a", PARTICIPANT_IDS)[0],
		);
	});

	// ── Cancellation ─────────────────────────────────────────────────────────

	it("cancel() mid-run persists CANCELLED, emits TournamentCancelled, and blocks further advancement", () => {
		const snapshots: TournamentRuntimeSnapshot[] = [];
		const cancelledEvents: AnyTournamentEvent[] = [];
		const runtime = makeRuntime({ onSnapshot: (s) => snapshots.push(s) });
		runtime.events.on("TournamentCancelled", (event) => cancelledEvents.push(event));

		runtime.start();
		runtime.advancePhase(); // ROUND_START -> PLAYER_TURNS
		runtime.cancel("administrative cancellation");

		expect(runtime.currentPhase).toBe("CANCELLED");
		expect(runtime.isTerminal).toBe(true);
		expect(cancelledEvents).toHaveLength(1);
		expect(cancelledEvents[0].payload).toEqual({
			reason: "administrative cancellation",
		});

		const last = snapshots[snapshots.length - 1];
		expect(last.machine.phase).toBe("CANCELLED");
		const snapshotCountAtCancel = snapshots.length;

		// No further advancement: the machine is terminal, advancePhase() no-ops.
		const phaseAfter = runtime.advancePhase();
		expect(phaseAfter).toBe("CANCELLED");
		expect(snapshots).toHaveLength(snapshotCountAtCancel);

		// A second cancel() is a no-op too (already terminal) — no duplicate event.
		runtime.cancel("duplicate cancel");
		expect(cancelledEvents).toHaveLength(1);
	});
});

describe("TournamentRuntime — interactive PLAYER_TURNS (Vertical Slice, SPEC-022/005)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		// Interactive turns exercise the Action Engine, whose debug logs would
		// otherwise timestamp via the real Logger (Date.now) and pollute the
		// determinism assertion below.
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "verbose").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	function makeInteractive(
		settings: TournamentSettings = makeSettings(),
		extra: { firstTurnsGraceMs?: number } = {},
	) {
		const clock = new ManualClock(1_000);
		const runtime = new TournamentRuntime({
			tournamentId: TOURNAMENT_ID,
			seed: "seed-a",
			participantIds: PARTICIPANT_IDS,
			settings,
			clock,
			onSnapshot: () => undefined,
			interactiveTurns: true,
			...extra,
		});
		const events: AnyTournamentEvent[] = [];
		runtime.events.onAny((e) => events.push(e));
		return { runtime, clock, events };
	}

	/** Round boundaries route through the async MINIGAME skip — settle it. */
	const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

	it("start() enters PLAYER_TURNS and opens the first turn for turnOrder[0]", () => {
		const { runtime } = makeInteractive();
		runtime.start();

		const expectedOrder = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);
		expect(runtime.currentPhase).toBe("PLAYER_TURNS");
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(expectedOrder[0]);
	});

	it("a RollDiceIntent from the active player rolls, moves and hands the turn on after the handoff pause", () => {
		const { runtime, clock, events } = makeInteractive();
		runtime.start();
		const order = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);

		expect(runtime.handleRollDice(order[0])).toEqual({ status: "ok" });

		// The turn resolved server-side (roll + move) but the baton only passes
		// after the handoff pause — the boards are walking the token.
		expect(events.some((e) => e.name === "DiceRolled")).toBe(true);
		expect(events.some((e) => e.name === "PlayerMoved")).toBe(true);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBeNull();
		clock.advance(3_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[1]);
		expect(runtime.gameEngines.board.getPosition(order[0])).toBeDefined();
	});

	it("rejects out-of-turn and out-of-phase intents without touching state", () => {
		const { runtime } = makeInteractive();
		const order = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);

		// Before start(): not in PLAYER_TURNS.
		expect(runtime.handleRollDice(order[0])).toEqual({
			status: "rejected",
			reason: "not_in_player_turns",
		});

		runtime.start();
		// A non-active player is rejected; the active turn is untouched.
		expect(runtime.handleRollDice(order[2])).toEqual({
			status: "rejected",
			reason: "not_active_player",
		});
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[0]);
	});

	it("four resolved turns close the round: MINIGAME(skip) → CHECK_KEY_ITEMS → round 2", async () => {
		const { runtime, clock, events } = makeInteractive();
		runtime.start();
		const order = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);

		for (const playerId of order) {
			expect(runtime.handleRollDice(playerId)).toEqual({ status: "ok" });
			clock.advance(3_000); // handoff pause (token walk presentation)
			await settle();
		}
		await settle();

		// Round 1 finished and round 2 re-entered PLAYER_TURNS with turnOrder[0].
		expect(events.some((e) => e.name === "RoundFinished" && e.round === 1)).toBe(true);
		expect(events.some((e) => e.name === "RoundStarted" && e.round === 2)).toBe(true);
		expect(runtime.currentPhase).toBe("PLAYER_TURNS");
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[0]);
	});

	it("idle players are auto-rolled by the turn timeout; an unattended run reaches DEFEAT", async () => {
		const settings = makeSettings({ maxRound: 2 });
		const { runtime, clock, events } = makeInteractive(settings);
		runtime.start();

		// Nobody ever sends an intent: every turn resolves via the roll timeout.
		// 2 rounds × 4 turns; each advance fires the pending auto-roll plus the
		// turn-handoff pause (round boundaries settle through the async
		// MINIGAME skip).
		const turnMs = settings.timeouts.turnSeconds * 1000;
		for (let i = 0; i < 8; i++) {
			clock.advance(turnMs + 3_000);
			await settle();
		}

		expect(runtime.isTerminal).toBe(true);
		expect(runtime.currentPhase).toBe("FINISHED");
		const finished = events.find((e) => e.name === "TournamentFinished");
		expect(finished?.payload).toEqual({ winnerUserId: null });
		// Every one of the 8 turns produced an auto-resolved PlayerTurnFinished.
		expect(events.filter((e) => e.name === "PlayerTurnFinished")).toHaveLength(8);
	});

	it("a disconnect of the active player auto-resolves their turn after the grace and play continues", () => {
		const { runtime, clock } = makeInteractive();
		runtime.start();
		const order = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);

		runtime.handlePlayerDisconnect(order[0]);
		// Not yet — the grace protects quick rejoins (StrictMode / navigation).
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[0]);
		// Grace (3 s) resolves the turn; the handoff pause then opens the next.
		clock.advance(6_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[1]);

		// A disconnect of a NON-active player is a no-op.
		runtime.handlePlayerDisconnect(order[3]);
		clock.advance(6_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[1]);
	});

	it("a disconnect followed by a rejoin within the grace does NOT skip the turn", () => {
		const { runtime, clock } = makeInteractive();
		runtime.start();
		const order = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);

		// The board's mount cycle (join → leave → join, React StrictMode) or a
		// quick navigation: the player is back before the grace expires.
		runtime.handlePlayerConnected(order[0]);
		runtime.handlePlayerDisconnect(order[0]);
		runtime.handlePlayerConnected(order[0]);
		clock.advance(3_000);

		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[0]);
	});

	it("a player who stays disconnected past the bot timeout is converted to a CPU and plays their next turn at bot pace", async () => {
		const settings = makeSettings();
		const { runtime, clock, events } = makeInteractive(settings);
		runtime.start();
		const order = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);
		const turnMs = settings.timeouts.turnSeconds * 1000;
		const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

		runtime.handlePlayerDisconnect(order[0]);
		// Grace auto-resolves the CURRENT turn; the handoff opens order[1] next.
		clock.advance(6_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[1]);
		expect(runtime.botPlayers.has(order[0])).toBe(false);

		// Past the longer bot-conversion timeout, still no reconnect.
		clock.advance(45_000);
		expect(runtime.botPlayers.has(order[0])).toBe(true);
		expect(runtime.humanPlayerCount).toBe(PARTICIPANT_IDS.length - 1);

		// The other 3 (still human, no intent sent) each burn the full turn
		// timeout to close out round 1; the round boundary routes through the
		// async MINIGAME skip before round 2 reopens order[0]'s turn — which,
		// now a CPU, resolves at bot pace (well inside these same advances)
		// and hands off to order[1] rather than sitting on the full timeout.
		for (let i = 0; i < 3; i++) {
			clock.advance(turnMs + 3_000);
			await settle();
		}
		expect(runtime.currentRound).toBe(2);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[1]);

		// The proof it was actually PLAYED, not just auto-resolved: the CPU's
		// round-2 turn came through a real roll intent (autoResolved: false),
		// same as any lobby CPU — unlike the disconnect timeout/shop-cancel
		// path, which always marks autoResolved: true.
		const botTurn = events.find(
			(e) =>
				e.name === "PlayerTurnFinished" &&
				e.playerId === order[0] &&
				e.round === 2,
		);
		expect(botTurn?.payload).toMatchObject({ autoResolved: false });
	});

	it("reconnecting before the bot timeout keeps the player human; reconnecting AFTER hands control back", () => {
		const { runtime, clock } = makeInteractive();
		runtime.start();
		const order = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);

		runtime.handlePlayerDisconnect(order[0]);
		clock.advance(20_000); // well past the 3s grace, short of the 45s bot timeout
		runtime.handlePlayerConnected(order[0]);
		clock.advance(45_000);
		expect(runtime.botPlayers.has(order[0])).toBe(false);

		// A second disconnect that DOES cross the bot timeout converts them...
		runtime.handlePlayerDisconnect(order[0]);
		clock.advance(45_000);
		expect(runtime.botPlayers.has(order[0])).toBe(true);

		// ...and reconnecting afterwards hands control straight back (SPEC-023:
		// unlike a quit, a plain disconnect always stays reconnectable).
		runtime.handlePlayerConnected(order[0]);
		expect(runtime.botPlayers.has(order[0])).toBe(false);
	});

	it("a disconnect caused by the round's minigame never arms the bot-conversion timer — a slow-returning winner must still be PROMPTED for gambling, never silently auto-decided", () => {
		const { runtime, clock } = makeInteractive();
		runtime.start();
		const order = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);

		// Close round 1 through real roll intents.
		for (const playerId of order) {
			expect(runtime.handleRollDice(playerId)).toEqual({ status: "ok" });
			clock.advance(3_000); // handoff pause
		}
		// The last handoff's `clock.advance` above already ran
		// `finishInteractiveRound()` synchronously — the round's minigame is
		// "live" (MINIGAME phase) even though nothing has been `await`ed yet,
		// exactly like every board client navigating to the arena in production.
		expect(runtime.currentPhase).toBe("MINIGAME");

		// Every board disconnects at this instant (arena navigation) — NOT
		// abandonment. Simulate it for one player right as the minigame starts.
		runtime.handlePlayerDisconnect(order[0]);

		// Real minigames can easily run well past DISCONNECT_BOT_TIMEOUT_MS
		// (a played match, then the arena's own CONTINUE screen) before the
		// player's board reconnects. Even so, they must never end up flagged
		// as a CPU — that would auto-decide GAMBLING for them without ever
		// showing the prompt.
		clock.advance(90_000);
		expect(runtime.botPlayers.has(order[0])).toBe(false);
	});

	it("round 1 holds in ROUND_START until every human connects, then turn 1 goes to the derived first player", () => {
		const { runtime } = makeInteractive(makeSettings(), {
			firstTurnsGraceMs: 10_000,
		});
		runtime.start();
		const order = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);

		// Nobody is on the board yet: the turns are held open.
		expect(runtime.currentPhase).toBe("ROUND_START");
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBeNull();

		// Players arrive one by one; the last arrival opens turn 1 for order[0].
		for (const id of order.slice(0, -1)) {
			runtime.handlePlayerConnected(id);
			expect(runtime.currentPhase).toBe("ROUND_START");
		}
		runtime.handlePlayerConnected(order[order.length - 1]);

		expect(runtime.currentPhase).toBe("PLAYER_TURNS");
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[0]);
	});

	it("round 1's hold expires after the grace even if a player never arrives", () => {
		const { runtime, clock } = makeInteractive(makeSettings(), {
			firstTurnsGraceMs: 10_000,
		});
		runtime.start();
		const order = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);

		runtime.handlePlayerConnected(order[1]);
		expect(runtime.currentPhase).toBe("ROUND_START");

		clock.advance(10_000);

		expect(runtime.currentPhase).toBe("PLAYER_TURNS");
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[0]);
	});

	it("advancePhase() is a guarded no-op in interactive mode (no double-driving)", () => {
		const { runtime } = makeInteractive();
		runtime.start();
		expect(runtime.advancePhase()).toBe("PLAYER_TURNS");
		expect(runtime.currentPhase).toBe("PLAYER_TURNS");
	});

	it("interactive mode stays deterministic: no Math.random / Date.now", async () => {
		const randomSpy = jest.spyOn(Math, "random");
		const dateNowSpy = jest.spyOn(Date, "now");
		const settings = makeSettings({ maxRound: 1 });
		const { runtime, clock } = makeInteractive(settings);
		runtime.start();
		for (let i = 0; i < 4; i++) {
			clock.advance(settings.timeouts.turnSeconds * 1000 + 3_000);
			await settle();
		}
		expect(runtime.isTerminal).toBe(true);
		expect(randomSpy).not.toHaveBeenCalled();
		expect(dateNowSpy).not.toHaveBeenCalled();
	});
});

describe("TournamentRuntime — shop window (SPEC-012 interaction, SPEC-005)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "verbose").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	function makeShopHarness() {
		const clock = new ManualClock(1_000);
		const runtime = new TournamentRuntime({
			tournamentId: TOURNAMENT_ID,
			seed: "seed-a",
			participantIds: PARTICIPANT_IDS,
			settings: makeSettings(),
			clock,
			onSnapshot: () => undefined,
			interactiveTurns: true,
		});
		const events: AnyTournamentEvent[] = [];
		runtime.events.onAny((e) => events.push(e));
		const order = deriveTurnOrder("seed-a", [...PARTICIPANT_IDS]);
		return { runtime, clock, events, order };
	}

	/**
	 * Opens a shop session for the active player and resolves their turn —
	 * exactly what landing on the shop tile produces (the tile's `openShop`
	 * Action opens the session DURING board resolution, before
	 * PlayerTurnFinished), without depending on a seeded roll hitting tile-18.
	 */
	function rollIntoShop(harness: ReturnType<typeof makeShopHarness>): void {
		const { runtime, order } = harness;
		runtime.start();
		runtime.gameEngines.shop.open(order[0]);
		expect(runtime.handleRollDice(order[0])).toEqual({ status: "ok" });
	}

	it("holds the baton while the shop session is open and resumes on EndTurnIntent", () => {
		const harness = makeShopHarness();
		const { runtime, clock, order } = harness;
		rollIntoShop(harness);

		// The handoff pause alone must NOT pass the baton — the shop is open.
		clock.advance(3_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBeNull();
		expect(runtime.gameEngines.shop.openSessionPlayerId).toBe(order[0]);

		expect(runtime.handleEndTurn(order[0])).toEqual({ status: "ok" });
		expect(runtime.gameEngines.shop.openSessionPlayerId).toBeNull();
		clock.advance(3_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[1]);
	});

	it("a BuyOfferIntent purchases, credits the reward, closes the shop and hands on", () => {
		const harness = makeShopHarness();
		const { runtime, clock, events, order } = harness;
		rollIntoShop(harness);

		const before = runtime.gameEngines.economy.getBalance(order[0]) ?? 0;
		expect(runtime.handleBuyOffer(order[0], "pointsPack")).toEqual({
			status: "ok",
		});
		// Points Pack: pay 40, reward 100 → net +60 (through the real resolver).
		expect(runtime.gameEngines.economy.getBalance(order[0])).toBe(before + 60);
		expect(
			events.find((e) => e.name === "ShopClosed")?.payload,
		).toEqual({ outcome: "purchased" });

		clock.advance(3_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[1]);
	});

	it("a rejected purchase keeps the session (and the hold) open", () => {
		const harness = makeShopHarness();
		const { runtime, clock, order } = harness;
		rollIntoShop(harness);

		// The badge requires round 2 — round 1 rejects requirements_unmet.
		expect(runtime.handleBuyOffer(order[0], "badgeOffer")).toEqual({
			status: "rejected",
			reason: "requirements_unmet",
		});
		expect(runtime.gameEngines.shop.openSessionPlayerId).toBe(order[0]);
		clock.advance(3_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBeNull();

		expect(runtime.handleEndTurn(order[0])).toEqual({ status: "ok" });
		clock.advance(3_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[1]);
	});

	it("the session timeout is the backstop: the round resumes on its own", () => {
		const harness = makeShopHarness();
		const { runtime, clock, events, order } = harness;
		rollIntoShop(harness);

		clock.advance(30_000); // settings.timeouts.shopInteractionSeconds
		expect(
			events.find((e) => e.name === "ShopClosed")?.payload,
		).toEqual({ outcome: "timeout" });
		clock.advance(3_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[1]);
	});

	it("rejects shop intents without an open session or outside PLAYER_TURNS", () => {
		const { runtime, order } = makeShopHarness();

		// Before start(): wrong phase.
		expect(runtime.handleBuyOffer(order[0], "pointsPack")).toEqual({
			status: "rejected",
			reason: "not_in_player_turns",
		});
		expect(runtime.handleEndTurn(order[0])).toEqual({
			status: "rejected",
			reason: "not_in_player_turns",
		});

		runtime.start();
		// In phase but no session open (and never someone else's session).
		expect(runtime.handleBuyOffer(order[0], "pointsPack")).toEqual({
			status: "rejected",
			reason: "no_open_shop",
		});
		runtime.gameEngines.shop.open(order[0]);
		expect(runtime.handleEndTurn(order[1])).toEqual({
			status: "rejected",
			reason: "no_open_shop",
		});
	});

	it("a disconnected shopper's session is cancelled after the grace and the round resumes", () => {
		const harness = makeShopHarness();
		const { runtime, clock, events, order } = harness;
		rollIntoShop(harness);

		runtime.handlePlayerDisconnect(order[0]);
		clock.advance(3_000); // disconnect grace → cancel
		expect(
			events.find((e) => e.name === "ShopClosed")?.payload,
		).toEqual({ outcome: "cancelled" });
		clock.advance(3_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[1]);
	});

	it("a quitter converted mid-shop is decided by the CPU (buys when affordable) and play continues", () => {
		const harness = makeShopHarness();
		const { runtime, clock, events, order } = harness;
		rollIntoShop(harness);

		runtime.convertPlayerToBot(order[0]);
		clock.advance(2_000); // BOT_SHOP_DELAY_MS
		// initialPoints 100 ≥ 40: the CPU buys the Points Pack.
		expect(
			events.find((e) => e.name === "ItemPurchased")?.payload,
		).toMatchObject({ offerId: "pointsPack" });
		expect(runtime.gameEngines.shop.openSessionPlayerId).toBeNull();
		clock.advance(3_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(order[1]);
	});
});

describe("TournamentRuntime — full loop (P1: minigame→gambling→endgame, SPEC-015/016/020/021)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "verbose").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

	/**
	 * A scripted minigame platform: every launch immediately finishes with the
	 * given winner (first seated player by default). Exercises the REAL
	 * SPEC-015 coordinator inside the engines — only the platform is fake.
	 */
	function makePorts(pickWinner: (playerIds: readonly number[]) => number | null) {
		let matchSeq = 0;
		const listeners = new Set<(s: import("../minigame/minigame.types").MinigameLifecycleSignal) => void>();
		return {
			launcher: {
				launch: async (request: import("../minigame/minigame.types").MinigameLaunchRequest) => {
					const matchId = `match-${++matchSeq}`;
					const winnerId = pickWinner(request.playerIds);
					// Deliver the result on the next tick, after the coordinator
					// subscribed its wait.
					setImmediate(() => {
						for (const l of [...listeners]) {
							l({
								type: "finished",
								matchId,
								result: {
									matchId,
									winnerId,
									outcomes: new Map(
										request.playerIds.map((id) => [
											id,
											id === winnerId ? "win" : winnerId === null ? "draw" : "loss",
										]),
									),
								},
							});
						}
					});
					return { status: "launched" as const, matchId };
				},
			},
			lifecycle: {
				subscribe: (l: (s: import("../minigame/minigame.types").MinigameLifecycleSignal) => void) => {
					listeners.add(l);
					return () => listeners.delete(l);
				},
			},
			catalog: { candidates: () => ["kame-knock"] },
		};
	}

	function makeFullRuntime(options: {
		pickWinner: (playerIds: readonly number[]) => number | null;
		maxRound?: number;
	}) {
		const clock = new ManualClock(1_000);
		const snapshots: TournamentRuntimeSnapshot[] = [];
		const runtime = new TournamentRuntime({
			tournamentId: TOURNAMENT_ID,
			seed: "seed-a",
			participantIds: PARTICIPANT_IDS,
			settings: makeSettings({ maxRound: options.maxRound ?? 15 }),
			clock,
			onSnapshot: (s) => snapshots.push(s),
			interactiveTurns: true,
			minigamePorts: makePorts(options.pickWinner),
		});
		const events: AnyTournamentEvent[] = [];
		runtime.events.onAny((e) => events.push(e));
		return { runtime, clock, events, snapshots };
	}

	/**
	 * Roll all four turns of the current round and settle the round close.
	 * Each roll needs the turn-handoff pause (the boards walk the token), and
	 * the round close crosses the MINIGAME TIME! gate — every seat here is
	 * auto-ready (no live boards), so it only holds its minimum beat.
	 *
	 * If the minigame produces a winner, GAMBLING_PHASE now waits for their
	 * board to reconnect (`awaitPlayerPresence`) before opening. This helper
	 * stops right there — nobody in this harness has a live board, so callers
	 * must resolve that wait themselves: either `advanceGamblingArrival`
	 * below (rides the 20 s backstop, same as a winner who never comes back)
	 * or `runtime.handlePlayerConnected(winnerId)` (the real fix's other
	 * path — a dedicated test drives that one directly, with no backstop).
	 */
	async function playRound(
		runtime: TournamentRuntime,
		clock: ManualClock,
	): Promise<void> {
		const order = [...runtime.playOrder];
		for (const playerId of order) {
			runtime.handleRollDice(playerId);
			clock.advance(3_000); // turn handoff
			await settle();
		}
		clock.advance(2_000); // launch-gate minimum hold
		await settle();
		await settle();
	}

	/** Rides the GAMBLING_PHASE arrival backstop (GAMBLING_ARRIVAL_TIMEOUT_MS). */
	async function advanceGamblingArrival(clock: ManualClock): Promise<void> {
		clock.advance(20_000);
		await settle();
	}

	it("a completed round runs a REAL minigame and opens GAMBLING for its winner", async () => {
		const { runtime, clock, events } = makeFullRuntime({
			pickWinner: (ids) => ids[0],
		});
		runtime.start();
		await playRound(runtime, clock);
		await advanceGamblingArrival(clock);

		expect(events.some((e) => e.name === "MinigameFinished")).toBe(true);
		expect(runtime.currentPhase).toBe("GAMBLING_PHASE");
		const opened = events.find((e) => e.name === "GamblingOpened");
		expect(opened?.playerId).toBe(runtime.playOrder[0]);
		expect(opened?.payload).toMatchObject({
			cost: TOURNAMENT_SETTINGS_V1.gambling.cost,
			winChance: TOURNAMENT_SETTINGS_V1.gambling.baseWinChance,
		});
		// The minigame winner got the outcome points through the real Economy.
		const winner = runtime.playOrder[0];
		expect(
			runtime.gameEngines.economy.getBalance(winner),
		).toBeGreaterThan(TOURNAMENT_SETTINGS_V1.initialPoints);
	});

	it("opens GAMBLING as soon as the winner reconnects, without waiting for the arrival backstop", async () => {
		// Regression: GAMBLING_PHASE used to open the INSTANT the arena match
		// reported "finished" server-side — long before a real winner had
		// necessarily clicked CONTINUE (up to a 15s auto-return) and navigated
		// back to the board. That could burn a chunk of (or all of) the 30s
		// decision window on a screen the winner hadn't even reached yet,
		// silently resolving their bet as a timed-out "abandon" with the
		// prompt never shown — reported as "the gambling is done
		// automatically" for a real player (never intended for anyone but a
		// CPU winner, which still decides immediately via decideBotGambling).
		const { runtime, clock, events } = makeFullRuntime({
			pickWinner: (ids) => ids[0],
		});
		runtime.start();
		await playRound(runtime, clock);

		// Still MINIGAME: the winner's board has not reconnected yet, so
		// GAMBLING_PHASE must not have opened — no auto-resolve, no matter how
		// long the client takes, short of the 20s backstop.
		expect(runtime.currentPhase).toBe("MINIGAME");
		expect(events.some((e) => e.name === "GamblingOpened")).toBe(false);

		clock.advance(5_000); // well under the 20s backstop
		await settle();
		expect(runtime.currentPhase).toBe("MINIGAME");

		// The winner's board reconnects (TournamentBoardView remounting after
		// the arena match) — GAMBLING_PHASE opens immediately, no further
		// clock advance needed.
		const winner = runtime.playOrder[0];
		runtime.handlePlayerConnected(winner);
		await settle();

		expect(runtime.currentPhase).toBe("GAMBLING_PHASE");
		const opened = events.find((e) => e.name === "GamblingOpened");
		expect(opened?.playerId).toBe(winner);
	});

	it("opens GAMBLING immediately for a CPU winner (never waits — no board to reconnect)", async () => {
		const { runtime, clock, events } = makeFullRuntime({
			pickWinner: (ids) => ids[0],
		});
		runtime.start();
		runtime.convertPlayerToBot(runtime.playOrder[0]);
		await playRound(runtime, clock);

		// No arrival wait at all for a bot winner — GAMBLING_PHASE (and the
		// bot's own decision, decideBotGambling) proceeds right away.
		expect(runtime.currentPhase).not.toBe("MINIGAME");
		expect(events.some((e) => e.name === "GamblingOpened")).toBe(true);
	});

	it("a resolved bet holds the round for the reveal, with the outcome on the wire", async () => {
		const { runtime, clock } = makeFullRuntime({ pickWinner: (ids) => ids[0] });
		runtime.start();
		await playRound(runtime, clock);
		await advanceGamblingArrival(clock);
		expect(runtime.currentPhase).toBe("GAMBLING_PHASE");
		const winner = runtime.playOrder[0];

		expect(runtime.handleStartGambling(winner)).toEqual({ status: "ok" });
		await settle();

		// Resolved (won OR lost — the casino fairness is crypto-random): the
		// outcome is recorded for the boards and the round HOLDS in
		// GAMBLING_PHASE so everyone sees the banner.
		expect(runtime.lastGamble).toMatchObject({
			playerId: winner,
			round: 1,
			won: expect.any(Boolean),
		});
		expect(runtime.currentPhase).toBe("GAMBLING_PHASE");

		clock.advance(4_000);
		await settle();
		expect(["PLAYER_TURNS", "BOSS_EVENT", "FINAL_CHALLENGE"]).toContain(
			runtime.currentPhase,
		);
	});

	it("declining the bet (LeaveGamblingIntent) resumes the round loop", async () => {
		const { runtime, clock } = makeFullRuntime({ pickWinner: (ids) => ids[0] });
		runtime.start();
		await playRound(runtime, clock);
		await advanceGamblingArrival(clock);
		expect(runtime.currentPhase).toBe("GAMBLING_PHASE");

		runtime.handleLeaveGambling(runtime.playOrder[0]);
		await settle();

		// Round 2 is live again.
		expect(runtime.currentPhase).toBe("PLAYER_TURNS");
		expect(runtime.currentRound).toBe(2);
	});

	it("the 30s gambling timeout abandons the decision and the round continues", async () => {
		const { runtime, clock } = makeFullRuntime({ pickWinner: (ids) => ids[0] });
		runtime.start();
		await playRound(runtime, clock);
		await advanceGamblingArrival(clock);
		expect(runtime.currentPhase).toBe("GAMBLING_PHASE");

		clock.advance(TOURNAMENT_SETTINGS_V1.timeouts.gamblingDecisionSeconds * 1000);
		await settle();

		expect(runtime.currentPhase).toBe("PLAYER_TURNS");
		expect(runtime.currentRound).toBe(2);
	});

	it("plays the WHOLE game: four gambling wins → Boss → sudden death → VICTORY with a champion", async () => {
		// Same winner every minigame; gambling always wins (roll 0 via a
		// deterministic fairness is not injectable here, so we bet with enough
		// points and force wins by betting until unlocked — instead, unlock via
		// direct engine access is forbidden; so: use winChance 1 by riding pity?
		// Cleanest: the winner bets every round with winChance from settings —
		// to make it deterministic we grant a fairness stub through the engines
		// options... not exposed at runtime level. So this test drives the FLOW
		// by having the winner bet and, when the bet loses, letting rounds loop
		// — bounded by maxRound 60 with pity reaching 1.0 by round 13
		// (0.4 + 0.05×12). Determinism: the casino fairness uses crypto seeds,
		// so we assert the INVARIANT (the game always terminates in VICTORY or
		// DEFEAT with consistent state), not a fixed round count.
		const { runtime, clock, events, snapshots } = makeFullRuntime({
			pickWinner: (ids) => ids[0],
			maxRound: 60,
		});
		runtime.start();

		const winner = runtime.playOrder[0];
		for (let round = 0; round < 60 && !runtime.isTerminal; round++) {
			if (runtime.currentPhase === "PLAYER_TURNS") {
				await playRound(runtime, clock);
				await advanceGamblingArrival(clock);
			}
			if (runtime.currentPhase === "GAMBLING_PHASE") {
				runtime.handleStartGambling(winner);
				await settle();
				await settle();
			}
			// Endgame phases resolve themselves (boss sync + sudden death via the
			// same scripted minigame platform) — advance past the MINIGAME TIME!
			// gate's minimum hold AND the resolved-bet reveal hold.
			clock.advance(5_000);
			await settle();
			await settle();
			// Points for the next bet: idle advance is not needed — the winner
			// earns minigame points every round; top up via the timeout path if
			// a bet was rejected for funds.
			if (
				runtime.currentPhase === "GAMBLING_PHASE"
			) {
				runtime.handleLeaveGambling(winner);
				await settle();
			}
		}

		expect(runtime.isTerminal).toBe(true);
		const finished = events.find((e) => e.name === "TournamentFinished");
		expect(finished).toBeDefined();

		if (runtime.winner !== null) {
			// VICTORY path: the whole endgame chain fired in order.
			const names = events.map((e) => e.name);
			for (const expected of [
				"AllKeyItemsUnlocked",
				"BossSpawned",
				"BossIntroCompleted",
				"FinalChallengeStarted",
				"VictoryConditionReached",
				"ShellGranted",
				"FinalChallengeFinished",
				"RewardsGranted",
				"TournamentFinished",
			]) {
				expect(names).toContain(expected);
			}
			// The champion is the SUDDEN-DEATH winner (the scripted platform
			// crowns the first seated player — the sudden death seats the
			// roster, so that is participant 10, not necessarily the round
			// winner) and is persisted in the final snapshot; the leaderboard
			// froze with the Shell holder first.
			expect(runtime.winner).toBe(runtime.gameEngines.shell.getHolderId());
			expect(runtime.winner).toBe(PARTICIPANT_IDS[0]);
			expect(finished?.payload).toEqual({ winnerUserId: runtime.winner });
			const last = snapshots[snapshots.length - 1];
			expect(last.machine.phase).toBe("FINISHED");
			expect(last.winnerUserId).toBe(runtime.winner);
			expect(runtime.gameEngines.leaderboard.serialize().frozen).toBe(true);
		} else {
			// DEFEAT path (only possible if every bet lost for 60 rounds —
			// astronomically unlikely once pity caps winChance at 1.0 by round 13,
			// since a capped bet ALWAYS wins). Reaching here means the pity math
			// broke: fail loudly.
			throw new Error("expected a VICTORY within the pity-capped bound");
		}
	}, 20_000);
});

describe("TournamentRuntime — CPU participants (CPU v2)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "verbose").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

	it("a CPU participant rolls its own turn after the clock delay (before the timeout)", async () => {
		const clock = new ManualClock(1_000);
		const runtime = new TournamentRuntime({
			tournamentId: TOURNAMENT_ID,
			seed: "seed-a",
			participantIds: PARTICIPANT_IDS,
			settings: makeSettings(),
			clock,
			onSnapshot: () => undefined,
			interactiveTurns: true,
			botPlayerIds: PARTICIPANT_IDS, // an all-CPU table
		});
		const events: AnyTournamentEvent[] = [];
		runtime.events.onAny((e) => events.push(e));
		runtime.start();

		const first = runtime.gameEngines.turnSystem.activePlayerId;
		expect(first).not.toBeNull();

		// 1.5s (the bot delay) — far below the 30s roll timeout — resolves the
		// turn and hands the baton to the next CPU.
		clock.advance(1_500);
		await settle();

		const finished = events.filter((e) => e.name === "PlayerTurnFinished");
		expect(finished).toHaveLength(1);
		expect(finished[0].payload).toMatchObject({ autoResolved: false }); // a real roll, not the timeout
		expect(runtime.gameEngines.turnSystem.activePlayerId).not.toBe(first);
	});

	it("an all-CPU tournament plays itself: rounds progress with no human input", async () => {
		const clock = new ManualClock(1_000);
		const runtime = new TournamentRuntime({
			tournamentId: TOURNAMENT_ID,
			seed: "seed-a",
			participantIds: PARTICIPANT_IDS,
			settings: makeSettings({ maxRound: 2 }),
			clock,
			onSnapshot: () => undefined,
			interactiveTurns: true,
			botPlayerIds: PARTICIPANT_IDS,
		});
		runtime.start();

		// 2 rounds × 4 CPU turns: 1.5s bot delay + 2.6s turn handoff each
		// (+ async round closes; the inert minigame skips before its gate).
		for (let i = 0; i < 8; i++) {
			clock.advance(4_500);
			await settle();
		}
		clock.advance(3_000); // the final turn's handoff closes round 2
		await settle();

		expect(runtime.isTerminal).toBe(true); // DEFEAT at maxRound (no key items)
		expect(runtime.currentPhase).toBe("FINISHED");
	});

	it("converts a departed human into a CPU that plays their turns (table started all-human)", async () => {
		const clock = new ManualClock(1_000);
		const runtime = new TournamentRuntime({
			tournamentId: TOURNAMENT_ID,
			seed: "seed-a",
			participantIds: PARTICIPANT_IDS,
			settings: makeSettings(),
			clock,
			onSnapshot: () => undefined,
			interactiveTurns: true,
			// NB: NO botPlayerIds — the whole table is human at the start.
		});
		const events: AnyTournamentEvent[] = [];
		runtime.events.onAny((e) => events.push(e));
		runtime.start();

		const departed = runtime.gameEngines.turnSystem.activePlayerId as number;
		expect(departed).not.toBeNull();
		expect(runtime.botPlayers.has(departed)).toBe(false);

		// The active player quits for good → replaced by a CPU that takes over
		// their in-progress turn with a REAL roll (bot delay, below the timeout),
		// not the anti-stall timeout, and hands the baton on.
		expect(runtime.humanPlayerCount).toBe(PARTICIPANT_IDS.length);
		runtime.convertPlayerToBot(departed);
		expect(runtime.botPlayers.has(departed)).toBe(true);
		expect(runtime.humanPlayerCount).toBe(PARTICIPANT_IDS.length - 1);

		clock.advance(1_500);
		await settle();

		const finished = events.filter((e) => e.name === "PlayerTurnFinished");
		expect(finished).toHaveLength(1);
		expect(finished[0].payload).toMatchObject({ autoResolved: false });
		expect(runtime.gameEngines.turnSystem.activePlayerId).not.toBe(departed);
	});
});
