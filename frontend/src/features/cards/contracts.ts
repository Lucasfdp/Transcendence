/**
 * features/cards/contracts.ts — Cards domain contracts.
 *
 * Moved from features/hub/api.ts: the Hub feature does not own the Shell
 * Cards binder or pack-opening domain, only ProgressionResult.cardDrop's
 * type-only reference to PackPull (see features/hub/api.ts).
 */

export type CardRarity = "stone" | "bronze" | "jade" | "gold";
export type CardFamily = "power_shell" | "shrine" | "shell_skin" | "character";

export interface CardView {
	id: string;
	family: CardFamily;
	rarity: CardRarity;
	name: string;
	flavor: string;
	sourceRef: string;
	imageUrl?: string;
	owned: boolean;
	count: number;
	foilCount: number;
	/** Always ≤ foilCount — prismatic is a rarer state layered on foil, gold-only. */
	prismaticCount: number;
}

export interface CardSetProgress {
	family: CardFamily;
	owned: number;
	total: number;
}

export interface BinderView {
	cards: CardView[];
	sets: CardSetProgress[];
	totals: { owned: number; total: number };
	packTiers: PackTierView[];
}

/** Stable identifiers for the purchasable pack tiers, cheapest to priciest. */
export type PackTierId = "basic" | "deluxe" | "legendary";

/**
 * One purchasable pack tier, fully transparent: price, rarity odds (mirrors
 * the backend's own display copy — sums to 1), foil chance, and an optional
 * guaranteed minimum rarity for one slot in the pack.
 */
export interface PackTierView {
	id: PackTierId;
	name: string;
	priceCoins: number;
	rarityOdds: Record<CardRarity, number>;
	foilChance: number;
	guaranteedMinRarity?: CardRarity;
}

export interface PackPull {
	card: Omit<CardView, "owned" | "count" | "foilCount" | "prismaticCount">;
	foil: boolean;
	/** Always implies `foil: true`. */
	prismatic: boolean;
	isNew: boolean;
}

export interface PackResult {
	pulls: PackPull[];
	coins: number;
}
