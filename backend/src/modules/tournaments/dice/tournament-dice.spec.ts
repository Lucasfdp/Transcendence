import { Logger } from "@nestjs/common";

import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { ManualClock } from "../infra/clock";
import { DiceValueModifier, ActiveDieResolver } from "./dice.types";
import { DEFAULT_DICE_ID, V1_DICE_IDS, createDiceRegistry } from "./dice-registry";
import { TournamentDice, TournamentDiceOptions } from "./tournament-dice";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SEED = "seed-a";

interface Harness {
	dice: TournamentDice;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
}

function makeDice(overrides: Partial<TournamentDiceOptions> = {}): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((event) => events.push(event));
	const dice = new TournamentDice({
		tournamentId: TOURNAMENT_ID,
		seed: SEED,
		bus,
		clock,
		...overrides,
	});
	return { dice, bus, clock, events };
}

function eventsNamed(events: AnyTournamentEvent[], name: string): AnyTournamentEvent[] {
	return events.filter((event) => event.name === name);
}

describe("TournamentDice (SPEC-010)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "verbose").mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("rolls a face that is a member of the die's faces", () => {
		const { dice } = makeDice();
		const normalFaces = [1, 2, 3, 4, 5, 6];
		for (let i = 0; i < 50; i++) {
			const result = dice.roll({ playerId: 10 });
			expect(result.diceId).toBe(DEFAULT_DICE_ID);
			expect(normalFaces).toContain(result.value);
		}
	});

	it("is reproducible: same seed + same roll sequence ⇒ identical values", () => {
		const a = makeDice();
		const b = makeDice();
		const seqA = Array.from({ length: 20 }, () => a.dice.roll({ playerId: 10 }).value);
		const seqB = Array.from({ length: 20 }, () => b.dice.roll({ playerId: 10 }).value);
		expect(seqA).toEqual(seqB);
	});

	it("different seed ⇒ (generally) different sequence", () => {
		const a = makeDice({ seed: "seed-a" });
		const b = makeDice({ seed: "seed-z" });
		const seqA = Array.from({ length: 20 }, () => a.dice.roll({ playerId: 10 }).value);
		const seqB = Array.from({ length: 20 }, () => b.dice.roll({ playerId: 10 }).value);
		expect(seqA).not.toEqual(seqB);
	});

	it("emits DiceRolled with the final value, diceId and seed", () => {
		const { dice, events } = makeDice();
		const result = dice.roll({ playerId: 10 });
		const rolled = eventsNamed(events, "DiceRolled");
		expect(rolled).toHaveLength(1);
		expect(rolled[0].playerId).toBe(10);
		expect(rolled[0].payload).toEqual({
			diceId: DEFAULT_DICE_ID,
			value: result.value,
			seed: SEED,
		});
	});

	it("applies a Rule value-modifier and emits DiceModified with base≠final", () => {
		const plusTwo: DiceValueModifier = {
			apply: ({ baseValue }) => baseValue + 2,
		};
		const { dice, events } = makeDice({ valueModifier: plusTwo });
		const result = dice.roll({ playerId: 10 });
		expect(result.value).toBe(result.baseValue + 2);
		const modified = eventsNamed(events, "DiceModified");
		expect(modified).toHaveLength(1);
		expect(modified[0].payload).toEqual({
			diceId: DEFAULT_DICE_ID,
			baseValue: result.baseValue,
			finalValue: result.baseValue + 2,
		});
		// DiceRolled carries the modified value.
		expect(eventsNamed(events, "DiceRolled")[0].payload).toMatchObject({
			value: result.baseValue + 2,
		});
	});

	it("does NOT emit DiceModified when the value is unchanged (identity)", () => {
		const { dice, events } = makeDice();
		dice.roll({ playerId: 10 });
		expect(eventsNamed(events, "DiceModified")).toHaveLength(0);
	});

	it("uses an ActiveDieResolver override (grande rolls only 4–6)", () => {
		const toGrande: ActiveDieResolver = { resolve: () => V1_DICE_IDS.grande };
		const { dice } = makeDice({ activeDieResolver: toGrande });
		for (let i = 0; i < 30; i++) {
			const result = dice.roll({ playerId: 10 });
			expect(result.diceId).toBe(V1_DICE_IDS.grande);
			expect([4, 5, 6]).toContain(result.value);
		}
	});

	it("an explicit input.diceId wins over the resolver", () => {
		const toGrande: ActiveDieResolver = { resolve: () => V1_DICE_IDS.grande };
		const { dice } = makeDice({ activeDieResolver: toGrande });
		const result = dice.roll({ playerId: 10, diceId: V1_DICE_IDS.chiquito });
		expect(result.diceId).toBe(V1_DICE_IDS.chiquito);
		expect([1, 2, 3]).toContain(result.value);
	});

	it("falls back to the default die when an unknown die is resolved (no throw)", () => {
		const toUnknown: ActiveDieResolver = { resolve: () => "no-such-die" };
		const { dice } = makeDice({ activeDieResolver: toUnknown });
		const result = dice.roll({ playerId: 10 });
		expect(result.diceId).toBe(DEFAULT_DICE_ID);
		expect([1, 2, 3, 4, 5, 6]).toContain(result.value);
	});

	it("serialize() round-trips and rollCount advances per roll", () => {
		const { dice } = makeDice();
		expect(dice.serialize().rollCount).toBe(0);
		dice.roll({ playerId: 10 });
		dice.roll({ playerId: 20 });
		const snapshot = dice.serialize();
		expect(snapshot.rollCount).toBe(2);
		const roundTripped = JSON.parse(JSON.stringify(snapshot));
		expect(roundTripped).toEqual(snapshot);
	});

	it("restoreFrom replays the roll counter (same next value as the original)", () => {
		const original = makeDice();
		original.dice.roll({ playerId: 10 });
		original.dice.roll({ playerId: 10 });
		const nextOriginal = original.dice.roll({ playerId: 10 }).value;

		const restored = makeDice();
		restored.dice.restoreFrom({ tournamentId: TOURNAMENT_ID, seed: SEED, rollCount: 2 });
		const nextRestored = restored.dice.roll({ playerId: 10 }).value;
		expect(nextRestored).toBe(nextOriginal);
	});

	it("never calls Math.random or Date.now", () => {
		const randomSpy = jest.spyOn(Math, "random");
		const dateNowSpy = jest.spyOn(Date, "now");
		const { dice } = makeDice();
		for (let i = 0; i < 10; i++) {
			dice.roll({ playerId: 10 });
		}
		dice.serialize();
		expect(randomSpy).not.toHaveBeenCalled();
		expect(dateNowSpy).not.toHaveBeenCalled();
	});

	it("stamps the current round from getRound onto emitted events", () => {
		const { dice, events } = makeDice({ getRound: () => 5 });
		dice.roll({ playerId: 10 });
		expect(events.every((e) => e.round === 5)).toBe(true);
	});

	it("keeps an empty-registry roll controlled (degenerate die, no throw)", () => {
		const emptyRegistry = createDiceRegistry();
		const { dice } = makeDice({ registry: emptyRegistry });
		const result = dice.roll({ playerId: 10 });
		expect(result.value).toBe(1);
	});
});
