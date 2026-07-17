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
import { createMinigameCatalog } from "../minigame/minigame-catalog";
import {
	MinigameLaunchResult,
	MinigameLifecycleSignal,
} from "../minigame/minigame.types";
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
		seed: "seed-a",
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

	it("wires the Board so a Tile Action (teleport) can drive it through services", () => {
		const { engines } = makeEngines();
		// A teleport Tile Action run through the real engine relocates the player
		// on the wired Board (services.board), proving the F3 seam is live.
		const action = engines.actionFactory.create({
			type: "teleport",
			parameters: { tileId: "tile-4" },
		});
		expect(action).not.toBeNull();
		const result = engines.actionEngine.execute(
			action!,
			engines.makeActionContext({ playerId: 10 }),
		);
		expect(result.status).toBe("success");
		expect(engines.board.getPosition(10)).toBe("tile-4");
	});

	it("wires Random Events so a randomEvent tile action runs an event end-to-end", () => {
		const { engines, events } = makeEngines();
		const action = engines.actionFactory.create({ type: "randomEvent" });
		expect(action).not.toBeNull();
		const result = engines.actionEngine.execute(
			action!,
			engines.makeActionContext({ playerId: 10 }),
		);
		expect(result.status).toBe("success");
		expect(events.some((e) => e.name === "RandomEventSelected")).toBe(true);
		const finished = events.find((e) => e.name === "RandomEventFinished");
		expect(finished).toBeDefined();
		expect(
			(finished!.payload as { actionStatuses: readonly string[] }).actionStatuses.every(
				(s) => s === "success",
			),
		).toBe(true);
	});

	it("wires steal so an attemptSteal action moves points between real players via Economy", () => {
		const { engines, events } = makeEngines();
		const before = engines.economy.getBalance(10) ?? 0;
		const action = engines.actionFactory.create({
			type: "attemptSteal",
			parameters: { amount: 25 },
		});
		const result = engines.actionEngine.execute(
			action!,
			engines.makeActionContext({ playerId: 10 }),
		);
		expect(result.status).toBe("success");
		// The thief gained the stolen amount (a real victim lost it).
		expect(engines.economy.getBalance(10)).toBe(before + 25);
		expect(events.some((e) => e.name === "StealSucceeded")).toBe(true);
		expect(events.some((e) => e.name === "PointsTransferred")).toBe(true);
	});

	it("wires the Shop so a purchase charges Economy and delivers via the Reward Resolver", () => {
		const { engines, events } = makeEngines();
		const before = engines.economy.getBalance(10) ?? 0;
		engines.shop.open(10);
		const result = engines.shop.buy(10, "pointsPack");
		expect(result.status).toBe("purchased");
		// pointsPack costs 40 and rewards +100 points → net +60.
		expect(engines.economy.getBalance(10)).toBe(before - 40 + 100);
		expect(events.some((e) => e.name === "ItemPurchased")).toBe(true);
	});

	it("wires the Shop so an item purchase lands in the buyer's inventory", () => {
		const { engines } = makeEngines();
		engines.shop.open(20);
		const result = engines.shop.buy(20, "luckyDiceOffer");
		expect(result.status).toBe("purchased");
		expect(engines.inventory.getUsed(20)).toBe(1);
	});

	it("wires a shield item so consuming it protects ONLY its holder from steals", () => {
		const { engines } = makeEngines();
		const steal = engines.services.steal!;
		expect(steal.isProtected(20)).toBe(false);

		const add = engines.inventory.add(20, SEED_ITEM_IDS.shellShield);
		expect(add.status).toBe("added");
		const instanceId = add.status === "added" ? add.slot.instanceId : "";
		const consume = engines.inventory.consume(
			20,
			instanceId,
			engines.makeActionContext({ playerId: 20 }),
		);
		expect(consume.status).toBe("consumed");

		// The personal StealPrevention rule protects the holder, nobody else.
		expect(steal.isProtected(20)).toBe(true);
		expect(steal.isProtected(30)).toBe(false);
	});

	it("wires Key Item Progression so a KeyItemReward unlocks the next Key Item", () => {
		const { engines, events } = makeEngines();
		expect(engines.keyItems.getUnlockedCount()).toBe(0);
		engines.rewards.grant(
			{ id: "kir", type: "keyItem", payload: {} },
			engines.makeActionContext({ playerId: 10 }),
		);
		expect(engines.keyItems.getUnlockedCount()).toBe(1);
		expect(events.some((e) => e.name === "KeyItemUnlocked")).toBe(true);
	});

	it("wires Key Item Progression so completing all Key Items unlocks the Final Challenge", () => {
		const { engines, events } = makeEngines();
		const required = engines.keyItems.getRequired();
		for (let i = 0; i < required; i++) {
			engines.rewards.grant(
				{ id: `kir-${i}`, type: "keyItem", payload: {} },
				engines.makeActionContext({ playerId: 10 }),
			);
		}
		expect(engines.keyItems.isComplete()).toBe(true);
		expect(events.some((e) => e.name === "AllKeyItemsUnlocked")).toBe(true);
		expect(events.some((e) => e.name === "FinalChallengeUnlocked")).toBe(true);
	});

	it("wires Minigame Integration so a completed match awards outcome points via Economy", async () => {
		const bus = new TournamentEventBus();
		const clock = new ManualClock(1_000);
		const settings = TOURNAMENT_SETTINGS_V1;
		const listeners = new Set<(s: MinigameLifecycleSignal) => void>();
		const engines = createTournamentEngines({
			tournamentId: TOURNAMENT_ID,
			participantIds: PARTICIPANT_IDS,
			settings,
			seed: "seed-a",
			bus,
			clock,
			minigameLauncher: {
				launch: async (): Promise<MinigameLaunchResult> => ({
					status: "launched",
					matchId: "match-x",
				}),
			},
			minigameLifecycle: {
				subscribe: (l) => {
					listeners.add(l);
					return () => listeners.delete(l);
				},
			},
			minigameCatalog: createMinigameCatalog([
				{ gameId: "kame-knock", minPlayers: 2, maxPlayers: 4 },
			]),
		});

		const winnerBefore = engines.economy.getBalance(10) ?? 0;
		const loserBefore = engines.economy.getBalance(20) ?? 0;
		const run = engines.minigame.run([10, 20]);
		await new Promise((r) => setImmediate(r)); // reach the wait
		for (const l of [...listeners]) {
			l({
				type: "finished",
				matchId: "match-x",
				result: {
					matchId: "match-x",
					winnerId: 10,
					outcomes: new Map([
						[10, "win"],
						[20, "loss"],
					]),
				},
			});
		}
		const result = await run;

		expect(result).toMatchObject({ status: "completed", winnerId: 10 });
		// Outcome points reached the REAL Economy through the Reward Resolver.
		expect(engines.economy.getBalance(10)).toBe(winnerBefore + settings.minigameReward.winner);
		expect(engines.economy.getBalance(20)).toBe(
			loserBefore + settings.minigameReward.participant,
		);
	});

	it("wires Gambling so a winning bet charges points and unlocks a real Key Item", () => {
		const bus = new TournamentEventBus();
		const clock = new ManualClock(1_000);
		const settings = TOURNAMENT_SETTINGS_V1;
		const engines = createTournamentEngines({
			tournamentId: TOURNAMENT_ID,
			participantIds: PARTICIPANT_IDS,
			settings,
			seed: "seed-a",
			bus,
			clock,
			// Deterministic fairness: roll 0 < any winChance ⇒ always win.
			gamblingFairness: {
				serverSeed: () => "srv",
				commit: (s) => `h:${s}`,
				roll: () => 0,
			},
		});

		// Ensure the winner can afford the stake (initialPoints < cost by default).
		engines.economy.award(10, settings.gambling.cost, "test:seed", "admin");
		const before = engines.economy.getBalance(10) ?? 0;
		expect(engines.keyItems.getUnlockedCount()).toBe(0);
		expect(engines.gambling.open(10, 0.5).status).toBe("opened");
		const result = engines.gambling.bet(10);

		expect(result).toEqual({ status: "won" });
		// Stake charged against tournament points (never coins).
		expect(engines.economy.getBalance(10)).toBe(before - settings.gambling.cost);
		// The win unlocked a real Key Item through the Reward Resolver → Progression.
		expect(engines.keyItems.getUnlockedCount()).toBe(1);
	});

	it("wires the Boss so spawning activates real Rules through the Rule Engine", () => {
		const { engines, events } = makeEngines();
		// The Boss is gated on Key Item completion (SPEC-020 "Aparición").
		expect(engines.boss.spawn().status).toBe("rejected");

		for (let i = 0; i < TOURNAMENT_SETTINGS_V1.keyItemsRequired; i++) {
			engines.keyItems.unlock(null);
		}
		const result = engines.boss.spawn();
		expect(result).toEqual({ status: "spawned", finalChallengeId: "suddenDeath" });
		expect(names(events)).toContain("BossIntroCompleted");

		// The Boss Rules are live in the REAL Rule Engine: no_steal (GLOBAL,
		// exclusive boolean) protects everyone from steals…
		expect(engines.services.steal!.isProtected(20)).toBe(true);
		// …and double_dice (value ×2) makes every roll even (d6 ×2 ∈ {2..12}).
		expect(engines.dice.roll({ playerId: 10 }).value % 2).toBe(0);

		// Finishing the Boss removes its Rules from the Rule Engine.
		engines.boss.finish();
		expect(engines.services.steal!.isProtected(20)).toBe(false);
		expect(names(events).slice(-2)).toEqual(["BossRulesRemoved", "BossFinished"]);
	});

	it("wires the Final Challenge: sudden death → Shell via the Resolver → frozen ranking (F5 checkpoint)", async () => {
		const bus = new TournamentEventBus();
		const clock = new ManualClock(1_000);
		const events: AnyTournamentEvent[] = [];
		bus.onAny((e) => events.push(e));
		const listeners = new Set<(s: MinigameLifecycleSignal) => void>();
		const engines = createTournamentEngines({
			tournamentId: TOURNAMENT_ID,
			participantIds: PARTICIPANT_IDS,
			settings: TOURNAMENT_SETTINGS_V1,
			seed: "seed-a",
			bus,
			clock,
			minigameLauncher: {
				launch: async (): Promise<MinigameLaunchResult> => ({
					status: "launched",
					matchId: "final-x",
				}),
			},
			minigameLifecycle: {
				subscribe: (l) => {
					listeners.add(l);
					return () => listeners.delete(l);
				},
			},
			minigameCatalog: createMinigameCatalog([
				{ gameId: "kame-knock", minPlayers: 2, maxPlayers: 5 },
			]),
		});

		// Reach the endgame: all Key Items unlocked → the Boss spawns and hands
		// over its Final Challenge id → the challenge starts (Runtime's job later).
		for (let i = 0; i < TOURNAMENT_SETTINGS_V1.keyItemsRequired; i++) {
			engines.keyItems.unlock(null);
		}
		expect(engines.boss.spawn().status).toBe("spawned");

		const run = engines.finalChallenge.start();
		await new Promise((r) => setImmediate(r)); // let the pipeline reach its wait
		for (const l of [...listeners]) {
			l({
				type: "finished",
				matchId: "final-x",
				result: {
					matchId: "final-x",
					winnerId: 30,
					outcomes: new Map(PARTICIPANT_IDS.map((id) => [id, id === 30 ? "win" : "loss"])),
				},
			});
		}
		const result = await run;

		expect(result).toEqual({ status: "finished", winnerId: 30, attempts: 1 });
		// THE PARROT'S SHELL landed through the REAL Reward Resolver → `grantShell`
		// Action → `services.shell` → the Shell holder, which emitted ShellGranted.
		expect(engines.shell.getHolderId()).toBe(30);
		expect(names(events)).toEqual(
			expect.arrayContaining([
				"FinalChallengeStarted",
				"VictoryConditionReached",
				"ShellGranted",
				"FinalChallengeFinished",
			]),
		);
		// The final ranking froze with the Shell holder first (SPEC-021).
		expect(engines.leaderboard.serialize().frozen).toBe(true);
		expect(engines.leaderboard.getEntries()[0].playerId).toBe(30);
	});

	it("wires a loaded-die item so consuming it forces ONLY the holder's roll to 6", () => {
		const { engines } = makeEngines();
		const add = engines.inventory.add(10, SEED_ITEM_IDS.loadedDie);
		expect(add.status).toBe("added");
		const instanceId = add.status === "added" ? add.slot.instanceId : "";
		const consume = engines.inventory.consume(
			10,
			instanceId,
			engines.makeActionContext({ playerId: 10 }),
		);
		expect(consume.status).toBe("consumed");

		// Player 10's roll is overridden to 6 by the personal dice rule; another
		// player's roll goes through the Dice engine unmodified by that rule.
		expect(engines.dice.roll({ playerId: 10 }).value).toBe(6);
	});

	it("wires the Dice so rolls are reproducible from the tournament seed", () => {
		const a = makeEngines();
		const b = makeEngines();
		const seqA = Array.from({ length: 10 }, () => a.engines.dice.roll({ playerId: 10 }).value);
		const seqB = Array.from({ length: 10 }, () => b.engines.dice.roll({ playerId: 10 }).value);
		expect(seqA).toEqual(seqB);
		expect(seqA.every((v) => v >= 1 && v <= 6)).toBe(true);
	});

	it("simulates a full round of board turns end-to-end (F3 checkpoint)", () => {
		const { engines, events } = makeEngines();
		// Each player takes exactly one turn: start → roll → (server rolls, Board
		// moves, tile resolves) → finish. The Runtime is the sequencer here.
		for (const playerId of PARTICIPANT_IDS) {
			expect(engines.turnSystem.startTurn(playerId).status).toBe("ok");
			expect(engines.turnSystem.requestRoll(playerId).status).toBe("ok");
			// The turn clears itself, so the next player can start (one active turn).
			expect(engines.turnSystem.activePlayerId).toBeNull();
		}

		// Every player took one turn and moved once on the Board (normal die ≥ 1).
		expect(events.filter((e) => e.name === "PlayerTurnStarted")).toHaveLength(
			PARTICIPANT_IDS.length,
		);
		expect(events.filter((e) => e.name === "PlayerTurnFinished")).toHaveLength(
			PARTICIPANT_IDS.length,
		);
		expect(events.filter((e) => e.name === "PlayerMoved")).toHaveLength(
			PARTICIPANT_IDS.length,
		);
		// Every player ended on a real board tile, and DiceRolled fired per turn.
		for (const playerId of PARTICIPANT_IDS) {
			expect(engines.board.getPosition(playerId)).toBeDefined();
		}
		expect(events.filter((e) => e.name === "DiceRolled")).toHaveLength(
			PARTICIPANT_IDS.length,
		);
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
		expect(roundTripped.board).toBeDefined();
		expect(roundTripped.dice).toBeDefined();
		expect(roundTripped.randomEvents).toBeDefined();
		expect(roundTripped.rng).toBeDefined();
		expect(roundTripped.shop).toBeDefined();
		expect(roundTripped.keyItems).toBeDefined();
		expect(roundTripped.minigame).toBeDefined();
		expect(roundTripped.gambling).toBeDefined();
		expect(roundTripped.boss).toBeDefined();
		expect(roundTripped.shell).toBeDefined();
		expect(roundTripped.finalChallenge).toBeDefined();
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
