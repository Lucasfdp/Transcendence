/**
 * tournament-engines.spec.ts — the F2 integration checkpoint
 * ("Reward → Inventory / Economy integration green").
 *
 * Proves the composition root wires the six engines so that granting an abstract
 * `Reward` actually moves real state THROUGH the one Action Engine: a composite
 * Victory reward (points + item) credits the wallet (Economy) AND places the
 * item (Inventory), and the corresponding facts flow on the shared bus. This is
 * the end-to-end seam every gameplay system will later stand on — no engine is
 * exercised in isolation here.
 */

import { Logger } from "@nestjs/common";

import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { ManualClock } from "../infra/clock";
import { TOURNAMENT_SETTINGS_V1, TournamentSettings } from "../config/settings.catalog";
import { SEED_ITEM_IDS } from "../inventory/item-registry";
import { Reward } from "../rewards/reward.types";
import { createTournamentEngines, TournamentEngines } from "./tournament-engines";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PARTICIPANT_IDS = [10, 20, 30, 40];

interface Harness {
	engines: TournamentEngines;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
	settings: TournamentSettings;
}

function makeEngines(): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((event) => events.push(event));
	const settings = TOURNAMENT_SETTINGS_V1;
	const engines = createTournamentEngines({
		tournamentId: TOURNAMENT_ID,
		participantIds: PARTICIPANT_IDS,
		settings,
		bus,
		clock,
	});
	return { engines, bus, clock, events, settings };
}

function names(events: AnyTournamentEvent[]): string[] {
	return events.map((event) => event.name);
}

describe("createTournamentEngines — F2 Reward→Inventory/Economy integration", () => {
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

	it("wires every engine with per-tournament state seeded from settings", () => {
		const { engines, settings } = makeEngines();
		expect(engines.economy.getBalance(10)).toBe(settings.initialPoints);
		expect(engines.inventory.getCapacity(10)).toBe(settings.inventoryCapacity);
		expect(engines.inventory.getUsed(10)).toBe(0);
		expect(engines.leaderboard.getEntries()).toHaveLength(PARTICIPANT_IDS.length);
	});

	it("grants a PointsReward that credits the real wallet through the Action Engine", () => {
		const { engines } = makeEngines();
		const reward: Reward = {
			id: "minigame-win",
			type: "points",
			payload: { amount: 50, reason: "minigame", source: "minigame" },
		};

		const result = engines.rewards.grant(
			reward,
			engines.makeActionContext({ playerId: 10 }),
		);

		expect(result.status).toBe("resolved");
		if (result.status === "resolved") {
			expect(result.results.map((r) => r.status)).toEqual(["success"]);
		}
		expect(engines.economy.getBalance(10)).toBe(
			TOURNAMENT_SETTINGS_V1.initialPoints + 50,
		);
	});

	it("grants a composite Victory reward → points credited AND item added, with facts on the bus", () => {
		const { engines, events } = makeEngines();
		const victory: Reward = {
			id: "victory",
			type: "composite",
			payload: {
				rewards: [
					{
						id: "victory-points",
						type: "points",
						payload: { amount: 500, reason: "victory", source: "boss" },
					},
					{
						id: "victory-item",
						type: "item",
						payload: { itemId: SEED_ITEM_IDS.luckyDice },
					},
				],
			},
		};

		const result = engines.rewards.grant(
			victory,
			engines.makeActionContext({ playerId: 20 }),
		);

		// Both children resolved successfully through the one Action Engine.
		expect(result.status).toBe("resolved");
		if (result.status === "resolved") {
			expect(result.results.map((r) => r.status)).toEqual(["success", "success"]);
		}

		// Economy: the wallet is really credited (identity multiplier, no rules).
		expect(engines.economy.getBalance(20)).toBe(
			TOURNAMENT_SETTINGS_V1.initialPoints + 500,
		);

		// Inventory: the item really landed in the player's inventory.
		const inventory = engines.inventory.getInventory(20);
		expect(inventory?.used).toBe(1);
		expect(inventory?.slots[0].itemId).toBe(SEED_ITEM_IDS.luckyDice);

		// The owner-system facts flowed on the shared bus (not emitted by Actions).
		const emitted = names(events);
		expect(emitted).toContain("CompositeRewardStarted");
		expect(emitted).toContain("PointsAwarded");
		expect(emitted).toContain("WalletUpdated");
		expect(emitted).toContain("ItemAdded");
		expect(emitted).toContain("CompositeRewardFinished");
		expect(emitted).toContain("RewardResolved");
	});

	it("propagates WalletUpdated into the Leaderboard projection", () => {
		const { engines } = makeEngines();
		engines.rewards.grant(
			{ id: "big", type: "points", payload: { amount: 300, source: "boss" } },
			engines.makeActionContext({ playerId: 30 }),
		);
		// Player 30 now leads on points (competition ranking off WalletUpdated).
		expect(engines.leaderboard.getPosition(30)).toBe(1);
	});

	it("serialize() produces a JSON-safe snapshot of every engine", () => {
		const { engines } = makeEngines();
		engines.rewards.grant(
			{ id: "pts", type: "points", payload: { amount: 10, source: "tile" } },
			engines.makeActionContext({ playerId: 10 }),
		);
		const snapshot = engines.serialize();
		const roundTripped = JSON.parse(JSON.stringify(snapshot));
		expect(roundTripped).toEqual(snapshot);
		expect(roundTripped.economy).toBeDefined();
		expect(roundTripped.rules).toBeDefined();
		expect(roundTripped.leaderboard).toBeDefined();
		expect(roundTripped.inventory).toBeDefined();
		expect(roundTripped.rewards).toBeDefined();
	});

	it("a full inventory rejects the item but still resolves the reward (no throw)", () => {
		const { engines } = makeEngines();
		const ctx = engines.makeActionContext({ playerId: 40 });
		// Fill player 40's inventory to capacity with lucky dice.
		for (let i = 0; i < TOURNAMENT_SETTINGS_V1.inventoryCapacity; i++) {
			engines.inventory.add(40, SEED_ITEM_IDS.luckyDice);
		}
		const result = engines.rewards.grant(
			{ id: "one-more", type: "item", payload: { itemId: SEED_ITEM_IDS.luckyDice } },
			ctx,
		);
		// The grant resolves; the item Action reports failed (inventory full).
		expect(result.status).toBe("resolved");
		if (result.status === "resolved") {
			expect(result.results.map((r) => r.status)).toEqual(["failed"]);
		}
		expect(engines.inventory.getUsed(40)).toBe(
			TOURNAMENT_SETTINGS_V1.inventoryCapacity,
		);
	});
});
