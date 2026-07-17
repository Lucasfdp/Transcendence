import { Logger } from "@nestjs/common";

import { ManualClock } from "../infra/clock";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { AnyTournamentEvent } from "../events/tournament-event.types";
import {
	EconomySnapshot,
	RewardRuleApplier,
	TournamentEconomy,
	WalletSnapshot,
} from "./tournament-economy";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PARTICIPANT_IDS = [10, 20, 30, 40];
const INITIAL_POINTS = 100;

interface Harness {
	economy: TournamentEconomy;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
}

function makeEconomy(
	overrides: {
		participantIds?: number[];
		initialPoints?: number;
		rewardRuleApplier?: RewardRuleApplier;
		getRound?: () => number;
	} = {},
): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((event) => events.push(event));
	const economy = new TournamentEconomy({
		tournamentId: TOURNAMENT_ID,
		participantIds: overrides.participantIds ?? PARTICIPANT_IDS,
		initialPoints: overrides.initialPoints ?? INITIAL_POINTS,
		bus,
		clock,
		rewardRuleApplier: overrides.rewardRuleApplier,
		getRound: overrides.getRound,
	});
	return { economy, bus, clock, events };
}

function eventsNamed(events: AnyTournamentEvent[], name: string): AnyTournamentEvent[] {
	return events.filter((event) => event.name === name);
}

/** Reconstructs a balance purely from a wallet's transaction history. */
function replayBalance(initialPoints: number, wallet: WalletSnapshot): number {
	return wallet.transactionHistory.reduce(
		(sum, transaction) => sum + transaction.amount,
		initialPoints,
	);
}

describe("TournamentEconomy (SPEC-011)", () => {
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

	// ── Wallet initialization (SPEC-011 "Player Wallet") ────────────────────

	it("initializes exactly one wallet per participant at initialPoints", () => {
		const { economy } = makeEconomy();
		for (const playerId of PARTICIPANT_IDS) {
			const wallet = economy.getWallet(playerId);
			expect(wallet).toBeDefined();
			expect(wallet?.currentPoints).toBe(INITIAL_POINTS);
			expect(wallet?.spentPoints).toBe(0);
			expect(wallet?.earnedPoints).toBe(0);
			expect(wallet?.transactionHistory).toEqual([]);
		}
		expect(economy.serialize().wallets).toHaveLength(PARTICIPANT_IDS.length);
	});

	// ── Award happy path + events ───────────────────────────────────────────

	it("award credits the wallet, stores a transaction, emits PointsAwarded then WalletUpdated", () => {
		const { economy, events } = makeEconomy();
		const result = economy.award(10, 50, "tile-landing", "tile");

		expect(result.status).toBe("success");
		if (result.status !== "success") {
			throw new Error("expected success");
		}
		const wallet = economy.getWallet(10);
		expect(wallet?.currentPoints).toBe(150);
		expect(wallet?.earnedPoints).toBe(50);
		expect(wallet?.spentPoints).toBe(0);
		expect(wallet?.transactionHistory).toHaveLength(1);
		expect(wallet?.transactionHistory[0].amount).toBe(50);
		expect(wallet?.transactionHistory[0].operation).toBe("award");
		expect(wallet?.transactionHistory[0].id).toBe(result.transaction.id);

		const awarded = eventsNamed(events, "PointsAwarded");
		expect(awarded).toHaveLength(1);
		expect(awarded[0].playerId).toBe(10);
		expect(awarded[0].payload).toEqual({
			amount: 50,
			reason: "tile-landing",
			source: "tile",
			transactionId: result.transaction.id,
		});

		// WalletUpdated carries the resulting balance and comes after PointsAwarded.
		const updated = eventsNamed(events, "WalletUpdated");
		expect(updated).toHaveLength(1);
		expect(updated[0].payload).toEqual({
			currentPoints: 150,
			spentPoints: 0,
			earnedPoints: 50,
		});
		expect(events.map((e) => e.name)).toEqual(["PointsAwarded", "WalletUpdated"]);
	});

	// ── Remove happy path + events ──────────────────────────────────────────

	it("remove debits the wallet, emits PointsRemoved then WalletUpdated", () => {
		const { economy, events } = makeEconomy();
		const result = economy.remove(20, 40, "shop-purchase", "shop");

		expect(result.status).toBe("success");
		const wallet = economy.getWallet(20);
		expect(wallet?.currentPoints).toBe(60);
		expect(wallet?.spentPoints).toBe(40);
		expect(wallet?.earnedPoints).toBe(0);
		expect(wallet?.transactionHistory[0].amount).toBe(-40);

		const removed = eventsNamed(events, "PointsRemoved");
		expect(removed).toHaveLength(1);
		expect(removed[0].payload).toMatchObject({
			amount: 40,
			reason: "shop-purchase",
			source: "shop",
		});
		expect(events.map((e) => e.name)).toEqual(["PointsRemoved", "WalletUpdated"]);
	});

	it("emits a WalletUpdated after every applied operation", () => {
		const { economy, events } = makeEconomy();
		economy.award(10, 10, "r", "tile");
		economy.remove(10, 5, "r", "shop");
		economy.award(10, 3, "r", "rule");

		expect(eventsNamed(events, "WalletUpdated")).toHaveLength(3);
	});

	// ── Rejections (SPEC-011 "Casos límite"): no mutation ───────────────────

	it("rejects a negative award amount, emits EconomyRejected, mutates nothing", () => {
		const { economy, events } = makeEconomy();
		const result = economy.award(10, -5, "bad", "admin");

		expect(result).toEqual({ status: "rejected", rejection: "negative_amount" });
		expect(economy.getBalance(10)).toBe(INITIAL_POINTS);
		expect(economy.getWallet(10)?.transactionHistory).toEqual([]);

		const rejected = eventsNamed(events, "EconomyRejected");
		expect(rejected).toHaveLength(1);
		expect(rejected[0].payload).toEqual({
			operation: "award",
			amount: -5,
			reason: "bad",
			source: "admin",
			rejection: "negative_amount",
		});
		expect(eventsNamed(events, "WalletUpdated")).toHaveLength(0);
	});

	it("rejects remove with insufficient balance, mutates nothing", () => {
		const { economy, events } = makeEconomy();
		const result = economy.remove(10, INITIAL_POINTS + 1, "too-much", "gambling");

		expect(result).toEqual({
			status: "rejected",
			rejection: "insufficient_balance",
		});
		expect(economy.getBalance(10)).toBe(INITIAL_POINTS);
		expect(economy.getWallet(10)?.transactionHistory).toEqual([]);
		expect(eventsNamed(events, "EconomyRejected")[0].payload).toMatchObject({
			rejection: "insufficient_balance",
			operation: "remove",
		});
		expect(eventsNamed(events, "WalletUpdated")).toHaveLength(0);
	});

	it("allows removing exactly the full balance (never goes negative)", () => {
		const { economy } = makeEconomy();
		const result = economy.remove(10, INITIAL_POINTS, "all", "shop");
		expect(result.status).toBe("success");
		expect(economy.getBalance(10)).toBe(0);
	});

	it("rejects an award that would overflow MAX_SAFE_INTEGER, logs an error, mutates nothing", () => {
		const errorSpy = jest
			.spyOn(Logger.prototype, "error")
			.mockImplementation(() => undefined);
		const { economy, events } = makeEconomy({
			participantIds: [10],
			initialPoints: Number.MAX_SAFE_INTEGER - 1,
		});
		const result = economy.award(10, 10, "boom", "rule");

		expect(result).toEqual({ status: "rejected", rejection: "overflow" });
		expect(economy.getBalance(10)).toBe(Number.MAX_SAFE_INTEGER - 1);
		expect(economy.getWallet(10)?.transactionHistory).toEqual([]);
		expect(errorSpy).toHaveBeenCalled();
		expect(eventsNamed(events, "EconomyRejected")[0].payload).toMatchObject({
			rejection: "overflow",
		});
	});

	// ── Unknown player (SPEC-011 "Casos límite") ────────────────────────────

	it("rejects a command for an unknown player without throwing", () => {
		const { economy, events } = makeEconomy();
		expect(() => economy.award(999, 10, "ghost", "admin")).not.toThrow();
		const result = economy.remove(999, 10, "ghost", "admin");
		expect(result.status).toBe("rejected");
		expect(economy.getWallet(999)).toBeUndefined();
		expect(eventsNamed(events, "EconomyRejected").length).toBeGreaterThan(0);
	});

	// ── Transfer (SPEC-011 "Transfer") ──────────────────────────────────────

	it("transfer atomically moves points, emits PointsTransferred then two WalletUpdated", () => {
		const { economy, events } = makeEconomy();
		const result = economy.transfer(10, 20, 25, "steal", "steal");

		expect(result.status).toBe("success");
		expect(economy.getBalance(10)).toBe(75);
		expect(economy.getBalance(20)).toBe(125);

		const transferred = eventsNamed(events, "PointsTransferred");
		expect(transferred).toHaveLength(1);
		expect(transferred[0].playerId).toBeNull();
		expect(transferred[0].payload).toMatchObject({
			fromPlayerId: 10,
			toPlayerId: 20,
			amount: 25,
			source: "steal",
		});

		// Both wallets share the one logical transfer id.
		const fromTx = economy.getWallet(10)?.transactionHistory[0];
		const toTx = economy.getWallet(20)?.transactionHistory[0];
		expect(fromTx?.amount).toBe(-25);
		expect(toTx?.amount).toBe(25);
		expect(fromTx?.id).toBe(toTx?.id);

		expect(events.map((e) => e.name)).toEqual([
			"PointsTransferred",
			"WalletUpdated",
			"WalletUpdated",
		]);
		const walletUpdates = eventsNamed(events, "WalletUpdated");
		expect(walletUpdates[0].playerId).toBe(10);
		expect(walletUpdates[1].playerId).toBe(20);
	});

	it("transfer with insufficient source balance moves the AVAILABLE balance (v1, SPEC-040)", () => {
		const { economy, events } = makeEconomy();
		economy.remove(10, 90, "setup", "admin"); // wallet 10 now holds 10
		const before = events.length;

		const result = economy.transfer(10, 20, 25, "steal", "steal");
		expect(result.status).toBe("success");
		expect(economy.getBalance(10)).toBe(0);
		expect(economy.getBalance(20)).toBe(110);

		const transferred = events
			.slice(before)
			.filter((e) => e.name === "PointsTransferred");
		expect(transferred[0].payload).toMatchObject({ amount: 10 });
	});

	it("transfer rejects a negative amount, mutates nothing", () => {
		const { economy } = makeEconomy();
		const result = economy.transfer(10, 20, -5, "steal", "steal");
		expect(result).toEqual({ status: "rejected", rejection: "negative_amount" });
		expect(economy.getBalance(10)).toBe(INITIAL_POINTS);
		expect(economy.getBalance(20)).toBe(INITIAL_POINTS);
	});

	// ── Reward-rule seam (architect ruling F2-2) ────────────────────────────

	it("default reward-rule applier is identity (award credits the base amount)", () => {
		const { economy } = makeEconomy();
		economy.award(10, 30, "r", "tile");
		expect(economy.getBalance(10)).toBe(130);
	});

	it("a doubling applier fires ONLY on award, not on remove or transfer", () => {
		const calls: number[] = [];
		const doubling: RewardRuleApplier = {
			applyRewardMultiplier: ({ baseAmount }) => {
				calls.push(baseAmount);
				return baseAmount * 2;
			},
		};
		const { economy, events } = makeEconomy({ rewardRuleApplier: doubling });

		economy.award(10, 20, "r", "rule"); // credited 40
		expect(economy.getBalance(10)).toBe(140);
		expect(eventsNamed(events, "PointsAwarded")[0].payload).toMatchObject({
			amount: 40,
		});

		economy.remove(10, 10, "r", "shop"); // seam must NOT fire
		economy.transfer(10, 20, 10, "steal", "steal"); // seam must NOT fire

		expect(calls).toEqual([20]);
	});

	// ── Integrity (SPEC-011 "Integridad") ───────────────────────────────────

	it("every wallet balance is reconstructable from its transaction history", () => {
		const { economy } = makeEconomy();
		economy.award(10, 50, "a", "tile");
		economy.remove(10, 20, "b", "shop");
		economy.award(20, 15, "c", "minigame");
		economy.transfer(10, 30, 40, "steal", "steal");
		economy.remove(30, 5, "d", "gambling");

		const snapshot = economy.serialize();
		for (const wallet of snapshot.wallets) {
			expect(replayBalance(snapshot.initialPoints, wallet)).toBe(
				wallet.currentPoints,
			);
			// earned/spent totals also match the signed history split.
			const earned = wallet.transactionHistory
				.filter((t) => t.amount >= 0)
				.reduce((s, t) => s + t.amount, 0);
			const spent = wallet.transactionHistory
				.filter((t) => t.amount < 0)
				.reduce((s, t) => s - t.amount, 0);
			expect(wallet.earnedPoints).toBe(earned);
			expect(wallet.spentPoints).toBe(spent);
		}
	});

	// ── Timestamps / determinism (SPEC-028) ─────────────────────────────────

	it("uses clock.now() for timestamps and never Math.random or Date.now", () => {
		const randomSpy = jest.spyOn(Math, "random");
		const dateNowSpy = jest.spyOn(Date, "now");

		const bus = new TournamentEventBus();
		const clock = new ManualClock(5_000);
		const economy = new TournamentEconomy({
			tournamentId: TOURNAMENT_ID,
			participantIds: PARTICIPANT_IDS,
			initialPoints: INITIAL_POINTS,
			bus,
			clock,
		});
		economy.award(10, 10, "r", "tile");
		economy.remove(10, 5, "r", "shop");
		economy.transfer(10, 20, 3, "steal", "steal");

		expect(economy.getWallet(10)?.transactionHistory[0].timestamp).toBe(5_000);
		expect(randomSpy).not.toHaveBeenCalled();
		expect(dateNowSpy).not.toHaveBeenCalled();
	});

	// ── serialize() JSON-safety + round in envelopes ────────────────────────

	it("serialize() returns JSON-safe data", () => {
		const { economy } = makeEconomy();
		economy.award(10, 10, "r", "tile");
		economy.transfer(10, 20, 5, "steal", "steal");

		const snapshot = economy.serialize();
		expect(() => JSON.stringify(snapshot)).not.toThrow();
		const roundTripped = JSON.parse(JSON.stringify(snapshot)) as EconomySnapshot;
		expect(roundTripped).toEqual(snapshot);
	});

	it("tags event envelopes with the current round from getRound()", () => {
		let round = 0;
		const { economy, events } = makeEconomy({ getRound: () => round });
		round = 7;
		economy.award(10, 10, "r", "tile");
		expect(eventsNamed(events, "PointsAwarded")[0].round).toBe(7);
		expect(eventsNamed(events, "WalletUpdated")[0].round).toBe(7);
	});

	it("restoreFrom rebuilds an economy identical to its snapshot", () => {
		const { economy } = makeEconomy();
		economy.award(10, 50, "a", "tile");
		economy.transfer(10, 20, 25, "steal", "steal");
		const snapshot = economy.serialize();

		const restored = TournamentEconomy.restoreFrom(snapshot, {
			tournamentId: TOURNAMENT_ID,
			bus: new TournamentEventBus(),
			clock: new ManualClock(0),
		});
		expect(restored.serialize()).toEqual(snapshot);
	});
});
