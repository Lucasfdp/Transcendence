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
