import { Logger } from "@nestjs/common";

import {
	ActionConfig,
	ActionContext,
	ExecutionResult,
} from "../actions/action.interface";
import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { ManualClock } from "../infra/clock";
import { RandomEventActionRunner } from "./random-event.types";
import { createRandomEventRegistry } from "./random-event-registry";
import {
	TournamentRandomEvents,
	TournamentRandomEventsOptions,
} from "./tournament-random-events";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SEED = "seed-a";

class RecordingRunner implements RandomEventActionRunner {
	readonly calls: { actions: readonly ActionConfig[]; context: ActionContext }[] = [];
	run(actions: readonly ActionConfig[], context: ActionContext): ExecutionResult[] {
		this.calls.push({ actions, context });
		return actions.map(() => ({ status: "success" }) as ExecutionResult);
	}
}

interface Harness {
	system: TournamentRandomEvents;
	bus: TournamentEventBus;
	events: AnyTournamentEvent[];
	runner: RecordingRunner;
}

function makeSystem(overrides: Partial<TournamentRandomEventsOptions> = {}): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((event) => events.push(event));
	const runner = new RecordingRunner();
	const system = new TournamentRandomEvents({
		tournamentId: TOURNAMENT_ID,
		seed: SEED,
		bus,
		clock,
		actionRunner: overrides.actionRunner ?? runner,
		getRound: () => 1,
		...overrides,
	});
	return { system, bus, events, runner };
}

function names(events: AnyTournamentEvent[]): string[] {
	return events.map((e) => e.name);
}

describe("TournamentRandomEvents (SPEC-019)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("triggers the full event pipeline and runs the selected event's actions", () => {
		const { system, events, runner } = makeSystem();
		system.trigger(10);

		expect(names(events)).toEqual([
			"RandomEventRequested",
			"RandomEventSelected",
			"RandomEventStarted",
			"RandomEventFinished",
		]);
		// The runner received the selected event's actions.
		expect(runner.calls).toHaveLength(1);
		const selected = events.find((e) => e.name === "RandomEventSelected");
		expect(selected?.playerId).toBe(10);
		const finished = events.find((e) => e.name === "RandomEventFinished");
		expect((finished?.payload as { actionStatuses: readonly string[] }).actionStatuses.length)
			.toBeGreaterThan(0);
	});

	it("selects reproducibly from the seed (same seed ⇒ same event sequence)", () => {
		const a = makeSystem();
		const b = makeSystem();
		const seqA = Array.from({ length: 12 }, (_, i) => {
			a.system.trigger(10);
			return (a.events.filter((e) => e.name === "RandomEventSelected")[i].payload as { eventId: string }).eventId;
		});
		const seqB = Array.from({ length: 12 }, (_, i) => {
			b.system.trigger(10);
			return (b.events.filter((e) => e.name === "RandomEventSelected")[i].payload as { eventId: string }).eventId;
		});
		expect(seqA).toEqual(seqB);
	});

	it("respects weights: over many draws every event appears, weightier ones more often", () => {
		const { system, events } = makeSystem();
		for (let i = 0; i < 200; i++) {
			system.trigger(10);
		}
		const picks = events
			.filter((e) => e.name === "RandomEventSelected")
			.map((e) => (e.payload as { eventId: string }).eventId);
		const count = (id: string) => picks.filter((p) => p === id).length;
		// windfall (w=3) should be picked more than gust (w=1); all appear.
		expect(count("windfall")).toBeGreaterThan(0);
		expect(count("gust")).toBeGreaterThan(0);
		expect(count("windfall")).toBeGreaterThan(count("gust"));
	});

	it("emits RandomEventCancelled for an empty catalog", () => {
		const { system, events } = makeSystem({ registry: createRandomEventRegistry() });
		system.trigger(10);
		expect(names(events)).toEqual(["RandomEventRequested", "RandomEventCancelled"]);
		expect((events[1].payload as { reason: string }).reason).toBe("no_events");
	});

	it("keeps going when the runner throws (no results, still finishes)", () => {
		const throwingRunner: RandomEventActionRunner = {
			run: () => {
				throw new Error("boom");
			},
		};
		const { system, events } = makeSystem({ actionRunner: throwingRunner });
		expect(() => system.trigger(10)).not.toThrow();
		expect(events.some((e) => e.name === "RandomEventFinished")).toBe(true);
	});

	it("serialize() round-trips and the selection counter advances", () => {
		const { system } = makeSystem();
		expect(system.serialize().selectionCount).toBe(0);
		system.trigger(10);
		system.trigger(20);
		const snapshot = system.serialize();
		expect(snapshot.selectionCount).toBe(2);
		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
	});

	it("never calls Math.random or Date.now", () => {
		const randomSpy = jest.spyOn(Math, "random");
		const dateNowSpy = jest.spyOn(Date, "now");
		const { system } = makeSystem();
		for (let i = 0; i < 10; i++) {
			system.trigger(10);
		}
		system.serialize();
		expect(randomSpy).not.toHaveBeenCalled();
		expect(dateNowSpy).not.toHaveBeenCalled();
	});
});
