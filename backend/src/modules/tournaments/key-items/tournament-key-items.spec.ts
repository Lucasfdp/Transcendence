/**
 * tournament-key-items.spec.ts — Key Item Progression unit tests (SPEC-017).
 *
 * Covers: ordered unlock of the next locked item; the four events and their
 * emission order; completion → AllKeyItemsUnlocked + FinalChallengeUnlocked;
 * reject-when-complete (no duplicates, never throws); `required` capping;
 * JSON-safe serialize; and no Date.now (injected clock only).
 */

import { Logger } from "@nestjs/common";

import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { ManualClock } from "../infra/clock";
import { Registry } from "../registry/registry";
import {
	createKeyItemRegistry,
	validateKeyItemDefinition,
	V1_KEY_ITEM_IDS,
} from "./key-item-registry";
import { KeyItemDefinition } from "./key-item.types";
import { TournamentKeyItems, TournamentKeyItemsOptions } from "./tournament-key-items";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

interface Harness {
	keyItems: TournamentKeyItems;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
}

function makeKeyItems(overrides: Partial<TournamentKeyItemsOptions> = {}): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((e) => events.push(e));
	const keyItems = new TournamentKeyItems({
		tournamentId: TOURNAMENT_ID,
		required: 4,
		bus,
		clock,
		getRound: () => 2,
		...overrides,
	});
	return { keyItems, bus, clock, events };
}

const names = (events: AnyTournamentEvent[]): string[] => events.map((e) => e.name);

describe("TournamentKeyItems (SPEC-017)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("starts fully locked with required=4 and no progress", () => {
		const { keyItems } = makeKeyItems();
		expect(keyItems.getRequired()).toBe(4);
		expect(keyItems.getUnlockedCount()).toBe(0);
		expect(keyItems.isComplete()).toBe(false);
		expect(keyItems.hasLockedRemaining()).toBe(true);
	});

	it("unlocks the next locked item by order and emits Unlocked + ProgressUpdated", () => {
		const { keyItems, events } = makeKeyItems();
		const result = keyItems.unlock(10);

		expect(result).toEqual({
			status: "unlocked",
			keyItemId: V1_KEY_ITEM_IDS.first,
			order: 1,
			unlockedCount: 1,
			required: 4,
			complete: false,
		});
		expect(names(events)).toEqual(["KeyItemUnlocked", "KeyItemProgressUpdated"]);
		expect(events[0].payload).toMatchObject({
			keyItemId: V1_KEY_ITEM_IDS.first,
			order: 1,
			unlockedCount: 1,
			required: 4,
			unlockedBy: 10,
		});
		// KeyItems are global: the unlock event carries the unlocker, progress is
		// tournament-wide (playerId null).
		expect(events[0].playerId).toBe(10);
		expect(events[1].playerId).toBeNull();
		expect(events[1].payload).toEqual({
			unlockedCount: 1,
			required: 4,
			completion: 0.25,
		});
	});

	it("unlocks strictly in ascending order across calls", () => {
		const { keyItems } = makeKeyItems();
		expect(keyItems.unlock(10).status).toBe("unlocked");
		expect(keyItems.unlock(20)).toMatchObject({
			keyItemId: V1_KEY_ITEM_IDS.second,
			order: 2,
		});
		expect(keyItems.unlock(30)).toMatchObject({
			keyItemId: V1_KEY_ITEM_IDS.third,
			order: 3,
		});
	});

	it("completing the last required item emits AllKeyItemsUnlocked + FinalChallengeUnlocked", () => {
		const { keyItems, events } = makeKeyItems();
		keyItems.unlock(10);
		keyItems.unlock(10);
		keyItems.unlock(10);
		events.length = 0;
		const result = keyItems.unlock(10);

		expect(result.status).toBe("unlocked");
		expect((result as { complete: boolean }).complete).toBe(true);
		expect(keyItems.isComplete()).toBe(true);
		expect(keyItems.hasLockedRemaining()).toBe(false);
		expect(names(events)).toEqual([
			"KeyItemUnlocked",
			"KeyItemProgressUpdated",
			"AllKeyItemsUnlocked",
			"FinalChallengeUnlocked",
		]);
		expect(events[3].payload).toEqual({ required: 4 });
	});

	it("rejects an unlock once progress is complete (no duplicates, no events, no throw)", () => {
		const { keyItems, events } = makeKeyItems();
		for (let i = 0; i < 4; i++) keyItems.unlock(10);
		events.length = 0;

		expect(keyItems.unlock(10)).toEqual({
			status: "rejected",
			reason: "already_complete",
		});
		expect(events).toHaveLength(0);
		expect(keyItems.getUnlockedCount()).toBe(4);
	});

	it("caps `required` to the number of defined Key Items", () => {
		// A registry with only two items but required=4 → capped to 2.
		const registry = new Registry<KeyItemDefinition>(
			"KeyItemRegistryTest",
			validateKeyItemDefinition,
		);
		registry.register({ id: "a", name: "A", description: "", icon: "", order: 1 });
		registry.register({ id: "b", name: "B", description: "", icon: "", order: 2 });
		const { keyItems } = makeKeyItems({ required: 4, registry });

		expect(keyItems.getRequired()).toBe(2);
		keyItems.unlock(10);
		expect(keyItems.unlock(10).status).toBe("unlocked");
		expect(keyItems.isComplete()).toBe(true);
		expect(keyItems.unlock(10).status).toBe("rejected");
	});

	it("serialize() round-trips and reflects unlocked status", () => {
		const { keyItems } = makeKeyItems();
		keyItems.unlock(10);
		const snapshot = keyItems.serialize();

		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(snapshot.required).toBe(4);
		expect(snapshot.items).toHaveLength(4);
		expect(snapshot.items[0]).toEqual({
			id: V1_KEY_ITEM_IDS.first,
			order: 1,
			status: "unlocked",
		});
		expect(snapshot.items[1].status).toBe("locked");
	});

	it("never calls Date.now (uses the injected clock)", () => {
		const dateNowSpy = jest.spyOn(Date, "now");
		const { keyItems } = makeKeyItems();
		keyItems.unlock(10);
		keyItems.unlock(10);
		expect(dateNowSpy).not.toHaveBeenCalled();
	});

	it("seeded registry validates and holds the four ordered placeholders", () => {
		const registry = createKeyItemRegistry({ seed: true });
		expect(registry.getAll()).toHaveLength(4);
		expect(validateKeyItemDefinition({
			id: "x",
			name: "",
			description: "",
			icon: "",
			order: 0,
		})).toEqual(["name must be a non-empty string", "order must be a positive integer"]);
	});
});
