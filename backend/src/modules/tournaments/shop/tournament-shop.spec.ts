import { Logger } from "@nestjs/common";

import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { ManualClock } from "../infra/clock";
import { createShopRegistry, V1_SHOP_OFFER_IDS } from "./shop-registry";
import { ShopEconomyPort } from "./shop.types";
import { TournamentShop, TournamentShopOptions } from "./tournament-shop";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SHOP_TIMEOUT_MS = 30_000;

class FakeEconomy {
	balance = 1000;
	removeStatus: "success" | "rejected" = "success";
	readonly removes: { playerId: number; amount: number }[] = [];
	getBalance(): number {
		return this.balance;
	}
	remove(playerId: number, amount: number) {
		this.removes.push({ playerId, amount });
		return this.removeStatus === "success"
			? { status: "success" as const }
			: { status: "rejected" as const, rejection: "insufficient_balance" };
	}
}

class FakeGranter {
	grantStatus: "resolved" | "rejected" = "resolved";
	readonly grants: string[] = [];
	grant(reward: { id: string }) {
		this.grants.push(reward.id);
		return this.grantStatus === "resolved"
			? { status: "resolved" as const }
			: { status: "rejected" as const, reason: "invalid_config" };
	}
}

interface Harness {
	shop: TournamentShop;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
	economy: FakeEconomy;
	granter: FakeGranter;
}

function makeShop(overrides: Partial<TournamentShopOptions> = {}): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((e) => events.push(e));
	const economy = new FakeEconomy();
	const granter = new FakeGranter();
	const shop = new TournamentShop({
		tournamentId: TOURNAMENT_ID,
		bus,
		clock,
		economy: economy as unknown as ShopEconomyPort,
		rewardGranter: granter as unknown as TournamentShopOptions["rewardGranter"],
		shopTimeoutMs: SHOP_TIMEOUT_MS,
		getRound: () => 3,
		...overrides,
	});
	return { shop, bus, clock, events, economy, granter };
}

function names(events: AnyTournamentEvent[]): string[] {
	return events.map((e) => e.name);
}

describe("TournamentShop (SPEC-012)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("open emits ShopRequested then ShopOpened and starts a session", () => {
		const { shop, events, clock } = makeShop();
		const result = shop.open(10);
		expect(result.status).toBe("opened");
		expect(shop.openSessionPlayerId).toBe(10);
		expect(names(events)).toEqual(["ShopRequested", "ShopOpened"]);
		expect(events[1].payload).toMatchObject({ deadlineAt: clock.now() + SHOP_TIMEOUT_MS });
	});

	it("ignores a second open while a session is in progress", () => {
		const { shop } = makeShop();
		shop.open(10);
		expect(shop.open(20)).toEqual({ status: "ignored", reason: "session_in_progress" });
		expect(shop.openSessionPlayerId).toBe(10);
	});

	it("closes immediately with 'empty' for an empty catalog", () => {
		const { shop, events } = makeShop({ registry: createShopRegistry() });
		shop.open(10);
		expect(names(events)).toEqual(["ShopRequested", "ShopClosed"]);
		expect(events[1].payload).toEqual({ outcome: "empty" });
		expect(shop.openSessionPlayerId).toBeNull();
	});

	it("buys an offer: charges Economy, grants the Reward, emits ItemPurchased + ShopClosed", () => {
		const { shop, events, economy, granter } = makeShop();
		shop.open(10);
		const result = shop.buy(10, V1_SHOP_OFFER_IDS.pointsPack);

		expect(result.status).toBe("purchased");
		expect(economy.removes).toEqual([{ playerId: 10, amount: 40 }]);
		expect(granter.grants).toEqual(["reward:shop:pointsPack"]);
		const after = names(events);
		expect(after).toContain("PurchaseRequested");
		expect(after).toContain("ItemPurchased");
		expect(after[after.length - 1]).toBe("ShopClosed");
		expect(shop.openSessionPlayerId).toBeNull();
	});

	it("rejects an unknown offer and keeps the session open", () => {
		const { shop, events } = makeShop();
		shop.open(10);
		const result = shop.buy(10, "no-such-offer");
		expect(result).toEqual({ status: "rejected", reason: "unknown_offer" });
		expect(shop.openSessionPlayerId).toBe(10);
		expect(events.some((e) => e.name === "PurchaseRejected")).toBe(true);
	});

	it("rejects when the player cannot afford the offer (no charge)", () => {
		const { shop, economy } = makeShop();
		economy.balance = 10;
		shop.open(10);
		const result = shop.buy(10, V1_SHOP_OFFER_IDS.pointsPack);
		expect(result).toEqual({ status: "rejected", reason: "insufficient_points" });
		expect(economy.removes).toHaveLength(0);
	});

	it("rejects when a requirement (minRound) is unmet", () => {
		const { shop } = makeShop({ getRound: () => 1 });
		shop.open(10, 1);
		// badgeOffer requires minRound 2.
		const result = shop.buy(10, V1_SHOP_OFFER_IDS.badge);
		expect(result).toEqual({ status: "rejected", reason: "requirements_unmet" });
	});

	it("enforces per-player stock", () => {
		const { shop } = makeShop();
		// luckyDice: perPlayer limit 2.
		shop.open(10);
		expect(shop.buy(10, V1_SHOP_OFFER_IDS.luckyDice).status).toBe("purchased");
		shop.open(10);
		expect(shop.buy(10, V1_SHOP_OFFER_IDS.luckyDice).status).toBe("purchased");
		shop.open(10);
		expect(shop.buy(10, V1_SHOP_OFFER_IDS.luckyDice)).toEqual({
			status: "rejected",
			reason: "out_of_stock",
		});
	});

	it("rejects a buy with no open session", () => {
		const { shop } = makeShop();
		expect(shop.buy(10, V1_SHOP_OFFER_IDS.pointsPack)).toEqual({
			status: "rejected",
			reason: "no_session",
		});
	});

	it("cancel closes the session with 'cancelled'", () => {
		const { shop, events } = makeShop();
		shop.open(10);
		shop.cancel(10);
		expect(shop.openSessionPlayerId).toBeNull();
		expect(events.find((e) => e.name === "ShopClosed")?.payload).toEqual({
			outcome: "cancelled",
		});
	});

	it("times out the session with 'timeout'", () => {
		const { shop, events, clock } = makeShop();
		shop.open(10);
		clock.advance(SHOP_TIMEOUT_MS);
		expect(shop.openSessionPlayerId).toBeNull();
		expect(events.find((e) => e.name === "ShopClosed")?.payload).toEqual({
			outcome: "timeout",
		});
	});

	it("rejects invalid_reward when the grant is refused after charging (logged)", () => {
		const { shop, granter, economy } = makeShop();
		granter.grantStatus = "rejected";
		shop.open(10);
		const result = shop.buy(10, V1_SHOP_OFFER_IDS.pointsPack);
		expect(result).toEqual({ status: "rejected", reason: "invalid_reward" });
		expect(economy.removes).toHaveLength(1); // charged
	});

	it("applies a Rule price modifier", () => {
		const { shop, economy } = makeShop({
			priceModifier: { apply: ({ basePrice }) => basePrice * 2 },
		});
		shop.open(10);
		shop.buy(10, V1_SHOP_OFFER_IDS.pointsPack);
		expect(economy.removes).toEqual([{ playerId: 10, amount: 80 }]);
	});

	it("serialize() round-trips and records purchases", () => {
		const { shop } = makeShop();
		shop.open(10);
		shop.buy(10, V1_SHOP_OFFER_IDS.pointsPack);
		const snapshot = shop.serialize();
		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(snapshot.purchases[V1_SHOP_OFFER_IDS.pointsPack]).toBe(1);
		expect(snapshot.session).toBeNull();
	});

	it("never calls Date.now (uses the injected clock)", () => {
		const dateNowSpy = jest.spyOn(Date, "now");
		const { shop, clock } = makeShop();
		shop.open(10);
		shop.buy(10, V1_SHOP_OFFER_IDS.pointsPack);
		clock.advance(SHOP_TIMEOUT_MS);
		expect(dateNowSpy).not.toHaveBeenCalled();
	});
});
