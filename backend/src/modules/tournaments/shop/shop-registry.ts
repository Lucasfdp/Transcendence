/**
 * shop-registry.ts — the immutable shop offer registry (SPEC-012) plus a tiny v1
 * PLACEHOLDER catalog.
 *
 * Offers are pure content, so they live in the generic deep-freezing
 * `Registry<T>` (SPEC-025) like items/dice/boards. The catalog is entirely data
 * (SPEC-012 "Catálogo": never built by code). The v1 set is NOT final content
 * (that is a D11 content session): it exercises the purchase flow with rewards
 * that resolve through the Reward Resolver (points + a seed item).
 */

import { SEED_ITEM_IDS } from "../inventory/item-registry";
import { Registry } from "../registry/registry";
import { ShopOffer } from "./shop.types";

/**
 * Validator (SPEC-025 / SPEC-012 "Validación"): non-empty name, non-negative
 * price, a stock policy and a reward with a type.
 */
export const validateShopOffer = (offer: ShopOffer): string[] => {
	const errors: string[] = [];
	if (!offer.name || offer.name.trim() === "") {
		errors.push("name must be a non-empty string");
	}
	if (typeof offer.price !== "number" || offer.price < 0) {
		errors.push("price must be a non-negative number");
	}
	if (!offer.stock || typeof offer.stock.kind !== "string") {
		errors.push("stock policy is required");
	}
	if (!offer.reward || typeof offer.reward.type !== "string") {
		errors.push("reward must be a Reward with a type");
	}
	return errors;
};

/** Builds a fresh shop registry; `seed: true` pre-registers the v1 catalog. */
export const createShopRegistry = (
	options: { seed?: boolean } = {},
): Registry<ShopOffer> => {
	const registry = new Registry<ShopOffer>("ShopRegistry", validateShopOffer);
	if (options.seed) {
		for (const offer of V1_SHOP_OFFERS) {
			registry.register(offer);
		}
	}
	return registry;
};

/** Ids of the v1 placeholder offers, exported for tests/integration. */
export const V1_SHOP_OFFER_IDS = {
	pointsPack: "pointsPack",
	luckyDice: "luckyDiceOffer",
	badge: "badgeOffer",
} as const;

/**
 * v1 placeholder offers (fixtures only): a points pack, a consumable item and a
 * permanent item. Rewards are abstract `Reward`s resolved by the Reward Resolver
 * (SPEC-013). Prices/stock are provisional (D2). No artistic naming logic.
 */
const V1_SHOP_OFFERS: readonly ShopOffer[] = [
	{
		id: V1_SHOP_OFFER_IDS.pointsPack,
		name: "Points Pack",
		description: "Spend points to gain more points (test offer).",
		icon: "💰",
		price: 40,
		currency: "points",
		stock: { kind: "infinite" },
		reward: {
			id: "reward:shop:pointsPack",
			type: "points",
			payload: { amount: 100, reason: "shop:pointsPack", source: "shop" },
		},
		metadata: { theme: "placeholder" },
	},
	{
		id: V1_SHOP_OFFER_IDS.luckyDice,
		name: "Lucky Dice",
		description: "A consumable Lucky Dice item.",
		icon: "🎲",
		price: 60,
		currency: "points",
		stock: { kind: "perPlayer", limit: 2 },
		reward: {
			id: "reward:shop:luckyDice",
			type: "item",
			payload: { itemId: SEED_ITEM_IDS.luckyDice },
		},
		metadata: { theme: "placeholder" },
	},
	{
		id: V1_SHOP_OFFER_IDS.badge,
		name: "Golden Parrot Badge",
		description: "A permanent passive badge.",
		icon: "🦜",
		price: 120,
		currency: "points",
		stock: { kind: "perGame", limit: 4 },
		requirements: { minRound: 2 },
		reward: {
			id: "reward:shop:badge",
			type: "item",
			payload: { itemId: SEED_ITEM_IDS.goldenParrotBadge },
		},
		metadata: { theme: "placeholder" },
	},
];
