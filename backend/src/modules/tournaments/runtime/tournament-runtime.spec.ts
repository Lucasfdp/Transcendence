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

	it("a completed round runs a REAL minigame and opens GAMBLING for its winner", async () => {
		const { runtime, clock, events } = makeFullRuntime({
			pickWinner: (ids) => ids[0],
		});
		runtime.start();
		await playRound(runtime, clock);

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

	it("a resolved bet holds the round for the reveal, with the outcome on the wire", async () => {
		const { runtime, clock } = makeFullRuntime({ pickWinner: (ids) => ids[0] });
		runtime.start();
		await playRound(runtime, clock);
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
