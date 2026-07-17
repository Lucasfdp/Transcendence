import { Logger } from "@nestjs/common";
import { TournamentEventBus } from "./tournament-event-bus";
import {
	AnyTournamentEvent,
	TournamentEvent,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "./tournament-event.types";

const TOURNAMENT_ID = "11111111-2222-3333-4444-555555555555";

function makeEvent<TName extends TournamentEventName>(
	name: TName,
	payload: TournamentEventPayloadMap[TName],
	round = 1,
): TournamentEvent<TName> {
	return createTournamentEvent({
		name,
		tournamentId: TOURNAMENT_ID,
		round,
		payload,
	});
}

describe("TournamentEventBus", () => {
	let errors: { eventName: TournamentEventName; error: unknown }[];
	let bus: TournamentEventBus;

	beforeEach(() => {
		errors = [];
		bus = new TournamentEventBus({
			onListenerError: (eventName, error) =>
				errors.push({ eventName, error }),
		});
	});

	it("delivers a typed event to its listener with envelope and payload intact", () => {
		const received: TournamentEvent<"RoundStarted">[] = [];
		bus.on("RoundStarted", (event) => received.push(event));

		const event = makeEvent("RoundStarted", { round: 3 }, 3);
		bus.emit(event);

		expect(received).toHaveLength(1);
		expect(received[0]).toBe(event);
		expect(received[0].name).toBe("RoundStarted");
		expect(received[0].tournamentId).toBe(TOURNAMENT_ID);
		expect(received[0].round).toBe(3);
		expect(received[0].playerId).toBeNull();
		expect(received[0].payload.round).toBe(3);
		expect(typeof received[0].eventId).toBe("string");
		expect(typeof received[0].timestamp).toBe("number");
	});

	it("does not deliver events of other types", () => {
		const listener = jest.fn();
		bus.on("RoundStarted", listener);

		bus.emit(makeEvent("RoundFinished", { round: 1 }));

		expect(listener).not.toHaveBeenCalled();
	});

	it("stops delivering after the returned unsubscribe is called", () => {
		const listener = jest.fn();
		const unsubscribe = bus.on("RoundStarted", listener);

		bus.emit(makeEvent("RoundStarted", { round: 1 }));
		unsubscribe();
		unsubscribe(); // second call is a no-op
		bus.emit(makeEvent("RoundStarted", { round: 2 }));

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("stops delivering after off()", () => {
		const listener = jest.fn();
		bus.on("StateEntered", listener);

		bus.off("StateEntered", listener);
		bus.emit(makeEvent("StateEntered", { state: "LOBBY" }));

		expect(listener).not.toHaveBeenCalled();
	});

	it("dispatches nested emissions in FIFO order, never interleaved", () => {
		const order: string[] = [];
		bus.on("TournamentStarted", () => {
			order.push("TournamentStarted:begin");
			bus.emit(makeEvent("RoundStarted", { round: 1 }));
			bus.emit(makeEvent("StateEntered", { state: "PLAYER_TURNS" }));
			order.push("TournamentStarted:end");
		});
		bus.on("RoundStarted", () => {
			order.push("RoundStarted");
			bus.emit(makeEvent("StateExited", { state: "LOBBY" }));
		});
		bus.on("StateEntered", () => order.push("StateEntered"));
		bus.on("StateExited", () => order.push("StateExited"));

		bus.emit(makeEvent("TournamentStarted", { playerIds: [1, 2] }));

		// Nested emits are queued and drained after the current dispatch:
		// the listener body completes before any follow-up event runs, and
		// StateEntered (queued before StateExited) is dispatched first.
		expect(order).toEqual([
			"TournamentStarted:begin",
			"TournamentStarted:end",
			"RoundStarted",
			"StateEntered",
			"StateExited",
		]);
		expect(errors).toHaveLength(0);
	});

	it("cuts off a self-re-emitting listener at the same-name budget and terminates the drain", () => {
		let deliveries = 0;
		bus.on("RoundStarted", () => {
			deliveries += 1;
			bus.emit(makeEvent("RoundStarted", { round: deliveries }));
		});

		bus.emit(makeEvent("RoundStarted", { round: 1 }));

		// Default budget is 16: emissions 1..16 are delivered, the 17th
		// (over budget) is reported and dropped, ending the runaway chain.
		expect(deliveries).toBe(16);
		expect(errors).toHaveLength(1);
		expect(errors[0].eventName).toBe("RoundStarted");
		expect(String(errors[0].error)).toContain("runaway");
		expect(String(errors[0].error)).toContain("16");
	});

	it("delivers repeated same-name emissions under the budget within one chain", () => {
		const rewardedRounds: number[] = [];
		bus.on("RoundFinished", (event) => {
			// Legitimate repeated fact: one RewardsGranted per player.
			for (let player = 0; player < 4; player += 1) {
				bus.emit(makeEvent("RewardsGranted", { round: event.payload.round }));
			}
		});
		bus.on("RewardsGranted", (event) => rewardedRounds.push(event.payload.round));

		bus.emit(makeEvent("RoundFinished", { round: 2 }));

		expect(rewardedRounds).toEqual([2, 2, 2, 2]);
		expect(errors).toHaveLength(0);
	});

	it("resets the same-name budget between independent drains", () => {
		const tightBus = new TournamentEventBus({
			maxSameNameEmissionsPerDrain: 2,
			onListenerError: (eventName, error) =>
				errors.push({ eventName, error }),
		});
		let reEmit = true;
		let deliveries = 0;
		tightBus.on("RoundStarted", (event) => {
			deliveries += 1;
			if (reEmit) {
				tightBus.emit(makeEvent("RoundStarted", { round: event.payload.round + 1 }));
			}
		});

		tightBus.emit(makeEvent("RoundStarted", { round: 1 }));
		expect(deliveries).toBe(2);
		expect(errors).toHaveLength(1);

		// A later, independent drain starts with fresh counters.
		reEmit = false;
		tightBus.emit(makeEvent("RoundStarted", { round: 10 }));
		expect(deliveries).toBe(3);
		expect(errors).toHaveLength(1);
	});

	it("isolates a throwing listener: later listeners and queued events still run", () => {
		const order: string[] = [];
		bus.on("TournamentFinished", () => {
			throw new Error("listener boom");
		});
		bus.on("TournamentFinished", () => {
			order.push("second");
			bus.emit(makeEvent("StateExited", { state: "VICTORY" }));
		});
		bus.on("StateExited", () => order.push("chained"));

		bus.emit(makeEvent("TournamentFinished", { winnerUserId: 7 }));

		expect(order).toEqual(["second", "chained"]);
		expect(errors).toHaveLength(1);
		expect(errors[0].eventName).toBe("TournamentFinished");
		expect((errors[0].error as Error).message).toBe("listener boom");
	});

	it("never rethrows into the emitter, even with the default error handler", () => {
		const loggerSpy = jest
			.spyOn(Logger.prototype, "error")
			.mockImplementation(() => undefined);
		const defaultBus = new TournamentEventBus();
		defaultBus.on("RoundStarted", () => {
			throw new Error("boom");
		});

		expect(() =>
			defaultBus.emit(makeEvent("RoundStarted", { round: 1 })),
		).not.toThrow();
		expect(loggerSpy).toHaveBeenCalled();
		loggerSpy.mockRestore();
	});

	it("calls the onAny tap after specific listeners, with the same isolation", () => {
		const order: string[] = [];
		const seen: AnyTournamentEvent[] = [];
		bus.on("RoundStarted", () => order.push("specific"));
		bus.onAny(() => {
			order.push("any:throwing");
			throw new Error("tap boom");
		});
		bus.onAny((event) => {
			order.push("any");
			seen.push(event);
		});

		bus.emit(makeEvent("RoundStarted", { round: 1 }));
		bus.emit(makeEvent("StateEntered", { state: "LOBBY" }));

		expect(order).toEqual([
			"specific",
			"any:throwing",
			"any",
			"any:throwing",
			"any",
		]);
		expect(seen.map((event) => event.name)).toEqual([
			"RoundStarted",
			"StateEntered",
		]);
		expect(errors).toHaveLength(2);
	});

	it("stops calling an onAny tap after its unsubscribe", () => {
		const tap = jest.fn();
		const unsubscribe = bus.onAny(tap);

		bus.emit(makeEvent("RoundStarted", { round: 1 }));
		unsubscribe();
		bus.emit(makeEvent("RoundStarted", { round: 2 }));

		expect(tap).toHaveBeenCalledTimes(1);
	});

	it("freezes the envelope, payload and metadata on emit", () => {
		let received: TournamentEvent<"TransitionFailed"> | undefined;
		bus.on("TransitionFailed", (event) => {
			received = event;
		});

		bus.emit(
			makeEvent("TransitionFailed", {
				from: "LOBBY",
				to: "PLAYER_TURNS",
				reason: "not enough players",
			}),
		);

		expect(received).toBeDefined();
		expect(Object.isFrozen(received)).toBe(true);
		expect(Object.isFrozen(received.payload)).toBe(true);
		expect(Object.isFrozen(received.metadata)).toBe(true);
		expect(() => {
			(received.payload as { reason: string }).reason = "mutated";
		}).toThrow(TypeError);
		expect(received.payload.reason).toBe("not enough players");
	});

	it("treats an emit with no listeners as a no-op", () => {
		expect(() =>
			bus.emit(makeEvent("TournamentCancelled", { reason: "abandoned" })),
		).not.toThrow();
		expect(errors).toHaveLength(0);
	});

	it("does not deliver the in-flight event to a listener registered during its dispatch", () => {
		const late = jest.fn();
		bus.on("RoundStarted", () => {
			bus.on("RoundStarted", late);
		});

		bus.emit(makeEvent("RoundStarted", { round: 1 }));
		expect(late).not.toHaveBeenCalled();

		bus.emit(makeEvent("RoundStarted", { round: 2 }));
		expect(late).toHaveBeenCalledTimes(1);
	});

	it("uses a caller-provided timestamp verbatim in createTournamentEvent", () => {
		const event = createTournamentEvent({
			name: "RoundStarted",
			tournamentId: TOURNAMENT_ID,
			round: 1,
			payload: { round: 1 },
			timestamp: 123456789,
		});

		expect(event.timestamp).toBe(123456789);
	});
});
