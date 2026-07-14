import { Logger } from "@nestjs/common";

import {
	ActionConfig,
	ActionContext,
	ActionServices,
	ExecutionResult,
} from "../actions/action.interface";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { AnyTournamentEvent } from "../events/tournament-event.types";
import { ManualClock } from "../infra/clock";
import { Registry } from "../registry/registry";
import {
	SEED_ITEM_IDS,
	createItemRegistry,
} from "./item-registry";
import { ItemDefinition, ItemEffectRunner } from "./item.types";
import { TournamentInventory } from "./tournament-inventory";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PARTICIPANT_IDS = [10, 20, 30];
const CAPACITY = 3;

/** Recording effect runner: captures every `run` call and returns canned results. */
class RecordingEffectRunner implements ItemEffectRunner {
	readonly calls: {
		effects: readonly ActionConfig[];
		context: ActionContext;
	}[] = [];
	constructor(private readonly results: ExecutionResult[] = []) {}
	run(
		effects: readonly ActionConfig[],
		context: ActionContext,
	): ExecutionResult[] {
		this.calls.push({ effects, context });
		return [...this.results];
	}
}

interface Harness {
	inventory: TournamentInventory;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
	runner: RecordingEffectRunner;
	registry: Registry<ItemDefinition>;
}

function makeInventory(
	overrides: {
		participantIds?: number[];
		capacity?: number;
		effectRunner?: ItemEffectRunner;
		registry?: Registry<ItemDefinition>;
		getRound?: () => number;
	} = {},
): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((event) => events.push(event));
	const runner = new RecordingEffectRunner();
	const registry = overrides.registry ?? createItemRegistry({ seed: true });
	const inventory = new TournamentInventory({
		tournamentId: TOURNAMENT_ID,
		participantIds: overrides.participantIds ?? PARTICIPANT_IDS,
		capacity: overrides.capacity ?? CAPACITY,
		registry,
		bus,
		clock,
		effectRunner: overrides.effectRunner ?? runner,
		getRound: overrides.getRound,
	});
	return { inventory, bus, clock, events, runner, registry };
}

/** Minimal ActionContext for consume (the Inventory only passes it through). */
function makeContext(playerId: number, bus: TournamentEventBus): ActionContext {
	const services = {} as ActionServices;
	return {
		tournamentId: TOURNAMENT_ID,
		playerId,
		round: 0,
		eventBus: bus,
		services,
	};
}

function eventsNamed(events: AnyTournamentEvent[], name: string): AnyTournamentEvent[] {
	return events.filter((event) => event.name === name);
}

describe("TournamentInventory (SPEC-007 / SPEC-014)", () => {
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

	// ── Initialization ──────────────────────────────────────────────────────

	it("creates exactly one empty inventory per participant at the given capacity", () => {
		const { inventory } = makeInventory();
		for (const playerId of PARTICIPANT_IDS) {
			const snapshot = inventory.getInventory(playerId);
			expect(snapshot).toBeDefined();
			expect(snapshot?.capacity).toBe(CAPACITY);
			expect(snapshot?.used).toBe(0);
			expect(snapshot?.slots).toEqual([]);
		}
		expect(inventory.serialize().players).toHaveLength(PARTICIPANT_IDS.length);
	});

	// ── Add + events (SPEC-014 "Añadir Item") ─────────────────────────────────

	it("add assigns a slot and emits ItemAdded then InventoryUpdated", () => {
		const { inventory, events } = makeInventory();
		const result = inventory.add(10, SEED_ITEM_IDS.luckyDice);

		expect(result.status).toBe("added");
		if (result.status !== "added") return;
		expect(result.slot.itemId).toBe(SEED_ITEM_IDS.luckyDice);
		expect(result.slot.instanceId).toEqual(expect.any(String));

		const names = events.map((e) => e.name);
		expect(names).toEqual(["ItemAdded", "InventoryUpdated"]);
		const added = eventsNamed(events, "ItemAdded")[0];
		expect(added.playerId).toBe(10);
		expect(added.payload).toMatchObject({
			itemId: SEED_ITEM_IDS.luckyDice,
			instanceId: result.slot.instanceId,
			slotId: result.slot.slotId,
		});
		expect(eventsNamed(events, "InventoryUpdated")[0].payload).toEqual({
			capacity: CAPACITY,
			used: 1,
		});
	});

	// ── No stacking (SPEC-007 "Stack") ────────────────────────────────────────

	it("adds two of the same definition as two slots with distinct unique instanceIds", () => {
		const { inventory } = makeInventory();
		const a = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		const b = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		expect(a.status).toBe("added");
		expect(b.status).toBe("added");
		if (a.status !== "added" || b.status !== "added") return;

		expect(a.slot.instanceId).not.toBe(b.slot.instanceId);
		expect(a.slot.slotId).not.toBe(b.slot.slotId);
		const snapshot = inventory.getInventory(10);
		expect(snapshot?.used).toBe(2);
		expect(snapshot?.slots).toHaveLength(2);
	});

	// ── Full → reject + InventoryFull, item NOT added (SPEC-014 "Casos límite") ─

	it("rejects an add on a full inventory, emits InventoryFull and does not add", () => {
		const { inventory, events } = makeInventory({ capacity: 1 });
		expect(inventory.add(10, SEED_ITEM_IDS.luckyDice).status).toBe("added");
		events.length = 0;

		const result = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		expect(result.status).toBe("rejected");
		if (result.status === "rejected") {
			expect(result.reason).toBe("inventory_full");
		}
		expect(inventory.getUsed(10)).toBe(1);

		const names = events.map((e) => e.name);
		expect(names).toEqual(["InventoryFull"]);
		expect(eventsNamed(events, "InventoryFull")[0].payload).toEqual({
			itemId: SEED_ITEM_IDS.luckyDice,
			capacity: 1,
		});
	});

	// ── Unknown definition add rejected, no throw (SPEC-014 "Casos límite") ────

	it("rejects an add of an unknown definition without throwing or emitting", () => {
		const { inventory, events } = makeInventory();
		const result = inventory.add(10, "nonExistentItem");
		expect(result.status).toBe("rejected");
		if (result.status === "rejected") {
			expect(result.reason).toBe("unknown_definition");
		}
		expect(events).toHaveLength(0);
		expect(inventory.getUsed(10)).toBe(0);
	});

	it("rejects an add for a non-participant player", () => {
		const { inventory } = makeInventory();
		const result = inventory.add(999, SEED_ITEM_IDS.luckyDice);
		expect(result.status).toBe("rejected");
		if (result.status === "rejected") {
			expect(result.reason).toBe("unknown_player");
		}
	});

	// ── Remove + events (SPEC-014 "Eliminar Item") ────────────────────────────

	it("remove frees the slot and emits ItemRemoved, InventoryUpdated then InventoryEmpty", () => {
		const { inventory, events } = makeInventory();
		const added = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		if (added.status !== "added") throw new Error("setup failed");
		events.length = 0;

		const result = inventory.remove(10, added.slot.instanceId);
		expect(result.status).toBe("removed");
		expect(inventory.getUsed(10)).toBe(0);

		const names = events.map((e) => e.name);
		expect(names).toEqual(["ItemRemoved", "InventoryUpdated", "InventoryEmpty"]);
		expect(eventsNamed(events, "ItemRemoved")[0].payload).toMatchObject({
			itemId: SEED_ITEM_IDS.luckyDice,
			instanceId: added.slot.instanceId,
		});
	});

	it("does not emit InventoryEmpty when other slots remain", () => {
		const { inventory, events } = makeInventory();
		const a = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		inventory.add(10, SEED_ITEM_IDS.luckyDice);
		if (a.status !== "added") throw new Error("setup failed");
		events.length = 0;

		inventory.remove(10, a.slot.instanceId);
		const names = events.map((e) => e.name);
		expect(names).toEqual(["ItemRemoved", "InventoryUpdated"]);
	});

	// ── Unknown-instance remove is a safe no-op (SPEC-014 "Casos límite") ──────

	it("ignores a remove of an unknown instance without throwing or emitting", () => {
		const { inventory, events } = makeInventory();
		inventory.add(10, SEED_ITEM_IDS.luckyDice);
		events.length = 0;

		const result = inventory.remove(10, "no-such-instance");
		expect(result.status).toBe("ignored");
		if (result.status === "ignored") {
			expect(result.reason).toBe("unknown_instance");
		}
		expect(events).toHaveLength(0);
		expect(inventory.getUsed(10)).toBe(1);
	});

	// ── Consume order: validate → effects → remove-if-consumable → ConsumableUsed

	it("consumes a consumable in the exact SPEC order and passes the item effects to the runner", () => {
		const results: ExecutionResult[] = [
			{ status: "success" },
			{ status: "skipped", reason: "gate" },
		];
		const runner = new RecordingEffectRunner(results);
		const { inventory, events, bus } = makeInventory({ effectRunner: runner });
		const added = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		if (added.status !== "added") throw new Error("setup failed");
		events.length = 0;

		const def = createItemRegistry({ seed: true }).get(SEED_ITEM_IDS.luckyDice);
		const outcome = inventory.consume(
			10,
			added.slot.instanceId,
			makeContext(10, bus),
		);

		expect(outcome.status).toBe("consumed");
		if (outcome.status === "consumed") {
			expect(outcome.consumed).toBe(true);
			expect(outcome.results).toEqual(results);
		}

		// The runner received exactly the item's effect configs.
		expect(runner.calls).toHaveLength(1);
		expect(runner.calls[0].effects).toEqual(def?.effects);

		// Order: effects run BEFORE removal; ConsumableUsed is LAST.
		const names = events.map((e) => e.name);
		expect(names).toEqual([
			"ItemRemoved",
			"InventoryUpdated",
			"InventoryEmpty",
			"ConsumableUsed",
		]);
		expect(eventsNamed(events, "ConsumableUsed")[0].payload).toEqual({
			itemId: SEED_ITEM_IDS.luckyDice,
			instanceId: added.slot.instanceId,
			consumed: true,
			effectStatuses: ["success", "skipped"],
		});
		// Slot is gone after consuming a consumable.
		expect(inventory.getSlot(10, added.slot.instanceId)).toBeUndefined();
	});

	// ── Permanent item stays after consume (SPEC-007 "Consumo") ───────────────

	it("keeps a permanent item in its slot after consume and can be used again", () => {
		const runner = new RecordingEffectRunner([{ status: "success" }]);
		const { inventory, events, bus } = makeInventory({ effectRunner: runner });
		const added = inventory.add(10, SEED_ITEM_IDS.goldenParrotBadge);
		if (added.status !== "added") throw new Error("setup failed");
		events.length = 0;

		const first = inventory.consume(10, added.slot.instanceId, makeContext(10, bus));
		expect(first.status).toBe("consumed");
		if (first.status === "consumed") {
			expect(first.consumed).toBe(false);
		}
		// No removal events; only ConsumableUsed.
		expect(events.map((e) => e.name)).toEqual(["ConsumableUsed"]);
		expect(inventory.getSlot(10, added.slot.instanceId)).toBeDefined();

		// Usable again.
		const second = inventory.consume(10, added.slot.instanceId, makeContext(10, bus));
		expect(second.status).toBe("consumed");
		expect(runner.calls).toHaveLength(2);
	});

	// ── Duplicate / re-entrant consume rejected (SPEC-014 "Casos límite") ─────

	it("rejects a second consume of an already-consumed (removed) consumable", () => {
		const { inventory, bus } = makeInventory();
		const added = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		if (added.status !== "added") throw new Error("setup failed");

		inventory.consume(10, added.slot.instanceId, makeContext(10, bus));
		const second = inventory.consume(10, added.slot.instanceId, makeContext(10, bus));
		expect(second.status).toBe("rejected");
		if (second.status === "rejected") {
			expect(second.reason).toBe("unknown_instance");
		}
	});

	it("rejects a re-entrant consume of the same instance while its effects run", () => {
		// A runner that tries to consume the same instance again mid-flight must
		// be rejected with already_consumed (the in-flight guard).
		let reentrantResult: string | undefined;
		const reentrantRunner: ItemEffectRunner = {
			run: () => {
				const r = inventory.consume(10, instanceId, makeContext(10, bus));
				reentrantResult = r.status === "rejected" ? r.reason : r.status;
				return [{ status: "success" }];
			},
		};
		const { inventory, bus } = makeInventory({ effectRunner: reentrantRunner });
		const added = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		if (added.status !== "added") throw new Error("setup failed");
		const instanceId = added.slot.instanceId;

		const outcome = inventory.consume(10, instanceId, makeContext(10, bus));
		expect(outcome.status).toBe("consumed");
		expect(reentrantResult).toBe("already_consumed");
	});

	it("rejects a consume of an unknown instance / foreign player", () => {
		const { inventory, bus } = makeInventory();
		const added = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		if (added.status !== "added") throw new Error("setup failed");

		// Unknown instance.
		expect(inventory.consume(10, "nope", makeContext(10, bus)).status).toBe(
			"rejected",
		);
		// The instance belongs to player 10, so player 20 cannot consume it.
		const foreign = inventory.consume(20, added.slot.instanceId, makeContext(20, bus));
		expect(foreign.status).toBe("rejected");
		if (foreign.status === "rejected") {
			expect(foreign.reason).toBe("unknown_instance");
		}
		// Still intact for the real owner.
		expect(inventory.getSlot(10, added.slot.instanceId)).toBeDefined();
	});

	it("does not remove or emit ConsumableUsed when a definition cannot be resolved", () => {
		// Register an item, add it, then unregister the definition: consume must
		// reject not_usable (SPEC-007 "Item inválido → No ejecutar").
		const registry = createItemRegistry({ seed: true });
		const { inventory, events, bus, runner } = makeInventory({ registry });
		const added = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		if (added.status !== "added") throw new Error("setup failed");
		registry.unregister(SEED_ITEM_IDS.luckyDice);
		events.length = 0;

		const outcome = inventory.consume(10, added.slot.instanceId, makeContext(10, bus));
		expect(outcome.status).toBe("rejected");
		if (outcome.status === "rejected") {
			expect(outcome.reason).toBe("not_usable");
		}
		expect(runner.calls).toHaveLength(0);
		expect(events).toHaveLength(0);
		expect(inventory.getSlot(10, added.slot.instanceId)).toBeDefined();
	});

	// ── Disconnected player inventory intact (SPEC-014 "Casos límite") ────────

	it("leaves a player's inventory intact while other players act", () => {
		const { inventory, bus } = makeInventory();
		const a = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		inventory.add(20, SEED_ITEM_IDS.luckyDice);
		if (a.status !== "added") throw new Error("setup failed");

		// Player 20 (disconnected) does nothing; player 10 churns their inventory.
		inventory.consume(10, a.slot.instanceId, makeContext(10, bus));
		inventory.add(10, SEED_ITEM_IDS.goldenParrotBadge);

		expect(inventory.getUsed(20)).toBe(1);
		expect(inventory.getInventory(20)?.slots).toHaveLength(1);
	});

	// ── Queries + stable slot order ───────────────────────────────────────────

	it("keeps a stable slot order across adds and removals", () => {
		const { inventory } = makeInventory({ capacity: 5 });
		const ids: string[] = [];
		for (let i = 0; i < 4; i++) {
			const r = inventory.add(10, SEED_ITEM_IDS.luckyDice);
			if (r.status === "added") ids.push(r.slot.instanceId);
		}
		// Remove the second one; the rest keep their relative order.
		inventory.remove(10, ids[1]);
		const order = inventory.getInventory(10)?.slots.map((s) => s.instanceId);
		expect(order).toEqual([ids[0], ids[2], ids[3]]);
	});

	// ── serialize() JSON round-trip ───────────────────────────────────────────

	it("serialize() produces a JSON-safe snapshot that round-trips", () => {
		const { inventory } = makeInventory();
		inventory.add(10, SEED_ITEM_IDS.luckyDice);
		inventory.add(20, SEED_ITEM_IDS.goldenParrotBadge);

		const snapshot = inventory.serialize();
		const roundTripped = JSON.parse(JSON.stringify(snapshot));
		expect(roundTripped).toEqual(snapshot);
		expect(roundTripped.tournamentId).toBe(TOURNAMENT_ID);
		expect(roundTripped.players).toHaveLength(PARTICIPANT_IDS.length);
		const p10 = roundTripped.players.find((p: { playerId: number }) => p.playerId === 10);
		expect(p10.used).toBe(1);
		expect(p10.slots[0].itemId).toBe(SEED_ITEM_IDS.luckyDice);
	});

	// ── Determinism (SPEC-028): no Math.random, no Date.now ───────────────────

	it("never calls Math.random or Date.now", () => {
		const randomSpy = jest.spyOn(Math, "random");
		const dateNowSpy = jest.spyOn(Date, "now");
		const runner = new RecordingEffectRunner([{ status: "success" }]);
		const { inventory, bus } = makeInventory({ effectRunner: runner });

		const added = inventory.add(10, SEED_ITEM_IDS.luckyDice);
		if (added.status !== "added") throw new Error("setup failed");
		inventory.consume(10, added.slot.instanceId, makeContext(10, bus));
		inventory.add(20, SEED_ITEM_IDS.goldenParrotBadge);
		inventory.serialize();

		expect(randomSpy).not.toHaveBeenCalled();
		expect(dateNowSpy).not.toHaveBeenCalled();
	});

	// ── getRound flows into event envelopes ───────────────────────────────────

	it("stamps the current round from getRound onto emitted events", () => {
		const { inventory, events } = makeInventory({ getRound: () => 7 });
		inventory.add(10, SEED_ITEM_IDS.luckyDice);
		expect(events.every((e) => e.round === 7)).toBe(true);
	});
});
