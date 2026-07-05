/**
 * Shell Cards — catalogue & economy constants.
 *
 * Cards are PURELY COSMETIC collectibles. Nothing here affects gameplay
 * balance. Card subjects reuse entities that already exist in the game
 * (power-shells, shrines/minigames, shell skins) so no new art pipeline is
 * needed — the frontend draws a procedural frame around the existing icon.
 *
 * See docs/SHELL_CARDS_SPEC.md.
 */

export type CardRarity = "stone" | "bronze" | "jade" | "gold";
export type CardFamily = "power_shell" | "shrine" | "shell_skin" | "character";

export interface CardDefinition {
	/** Globally unique catalogue id, e.g. "power-heavy", "shrine-kame-knock". */
	id: string;
	family: CardFamily;
	rarity: CardRarity;
	name: string;
	flavor: string;
	/** Reference into the source domain: PowerType | gameId | cosmeticId. */
	sourceRef: string;
	/**
	 * Optional static art served from the public assets dir. When absent, the
	 * frontend draws a procedural frame around the source icon/thumbnail.
	 */
	imageUrl?: string;
}

/** A catalogue card enriched with the requesting user's ownership state. */
export interface CardView extends CardDefinition {
	owned: boolean;
	/** Total copies owned (0 when not owned). */
	count: number;
	/** Foil copies owned (0 when none). */
	foilCount: number;
	/**
	 * Prismatic copies owned (0 when none). Always ≤ foilCount — prismatic is
	 * a rarer state layered on top of foil, gold-rarity only.
	 */
	prismaticCount: number;
}

/** Per-family ("set") collection progress. */
export interface CardSetProgress {
	family: CardFamily;
	/** Distinct cards owned in this family. */
	owned: number;
	/** Total distinct cards in this family. */
	total: number;
}

/** One card revealed when opening a pack. */
export interface PackPull {
	card: CardDefinition;
	foil: boolean;
	/** Always implies `foil: true` — see PRISMATIC_CHANCE_FRACTION. */
	prismatic: boolean;
	/** True if this was the player's first copy of the card. */
	isNew: boolean;
}

/** The outcome of opening one pack. */
export interface PackResult {
	pulls: PackPull[];
	/** The player's coin balance after the purchase and any dupe refunds. */
	coins: number;
}

/** The full binder response for a user. */
export interface BinderView {
	cards: CardView[];
	sets: CardSetProgress[];
	/** Overall distinct-card progress across the whole catalogue. */
	totals: { owned: number; total: number };
	/** Every pack tier the player can buy, server-authoritative and fully transparent. */
	packTiers: readonly PackTierView[];
}

/** Stable identifiers for the purchasable pack tiers, cheapest to priciest. */
export type PackTierId = "basic" | "deluxe" | "legendary";

/**
 * One purchasable pack tier: its own price, rarity odds (MUST sum to 1, see
 * cards.constants.spec.ts), foil chance, and an optional guaranteed minimum
 * rarity for one slot in the pack (see cards.roll.ts `rollGuaranteedCard`
 * and `GUARANTEED_SLOT_INDEX`).
 */
export interface PackTierDefinition {
	id: PackTierId;
	name: string;
	priceCoins: number;
	rarityOdds: Readonly<Record<CardRarity, number>>;
	foilChance: number;
	guaranteedMinRarity?: CardRarity;
}

/**
 * The tier view sent to the client. Odds/price/guarantee are shown to the
 * player in full (transparency matches the casino module's provably-fair
 * disclosure ethos) — so this is currently identical in shape to
 * {@link PackTierDefinition}.
 */
export type PackTierView = PackTierDefinition;

/** Rarity ladder, ordered common → rare (dojo-themed). */
export const CARD_RARITIES: readonly CardRarity[] = [
	"stone",
	"bronze",
	"jade",
	"gold",
] as const;

export const CARD_FAMILIES: readonly CardFamily[] = [
	"power_shell",
	"shrine",
	"shell_skin",
	"character",
] as const;

/**
 * Probability a single roll lands on each rarity tier. MUST sum to 1
 * (asserted in cards.constants.spec.ts). A card of the rolled rarity is then
 * chosen uniformly, so the catalogue must contain ≥1 card per rarity.
 */
export const RARITY_ODDS: Readonly<Record<CardRarity, number>> = {
	stone: 0.6,
	bronze: 0.27,
	jade: 0.1,
	gold: 0.03,
};

/** Chance a granted card is the shiny "foil" variant (cosmetic only). */
export const FOIL_CHANCE = 0.05;

/**
 * Fraction of foil-gold pulls that upgrade to "prismatic" — the rarest
 * cosmetic state, gold-rarity only. Scales naturally with pack tier because
 * it's conditioned on the tier's own foilChance already having hit.
 */
export const PRISMATIC_CHANCE_FRACTION = 0.1;

/** Cards yielded by opening one pack. */
export const PACK_SIZE = 5;

/**
 * The 0-indexed pack slot that carries a tier's guaranteed-minimum-rarity
 * roll, when `PackTierDefinition.guaranteedMinRarity` is set. Fixed (not
 * randomised) for simplicity — the last card in the pack.
 */
export const GUARANTEED_SLOT_INDEX = PACK_SIZE - 1;

/** Coin cost to open one pack (the coin sink). */
export const PACK_PRICE_COINS = 100;

/**
 * Coins trickled back when a granted card is a duplicate, by rarity, so no
 * pull feels dead. There is no crafting/dust economy (see spec §4).
 */
export const DUPLICATE_COIN_REFUND: Readonly<Record<CardRarity, number>> = {
	stone: 2,
	bronze: 5,
	jade: 12,
	gold: 30,
};

// ── Pack tiers ───────────────────────────────────────────────────────────────
//
// Three purchasable tiers: basic (the original, unchanged), deluxe, and
// legendary. Only the tier's odds/price/foil-chance/guarantee differ — pack
// size, the duplicate-refund table, and everything about how a card is
// granted stay the same across every tier (see docs/SHELL_CARDS_SPEC.md).

/** Deluxe tier's rarity odds — must sum to 1 (asserted in cards.constants.spec.ts). */
const DELUXE_RARITY_ODDS: Readonly<Record<CardRarity, number>> = {
	stone: 0.35,
	bronze: 0.35,
	jade: 0.22,
	gold: 0.08,
};

/** Legendary tier's rarity odds — must sum to 1 (asserted in cards.constants.spec.ts). */
const LEGENDARY_RARITY_ODDS: Readonly<Record<CardRarity, number>> = {
	stone: 0.15,
	bronze: 0.3,
	jade: 0.35,
	gold: 0.2,
};

const DELUXE_PACK_PRICE_COINS = 400;
const LEGENDARY_PACK_PRICE_COINS = 1500;

const DELUXE_FOIL_CHANCE = 0.08;
const LEGENDARY_FOIL_CHANCE = 0.15;

/**
 * The legendary tier guarantees at least one card at or above this rarity in
 * every pack (see `rollGuaranteedCard` and `GUARANTEED_SLOT_INDEX`).
 */
const LEGENDARY_GUARANTEED_MIN_RARITY: CardRarity = "gold";

/** The default tier used wherever a caller doesn't pick a specific one (e.g. match-end drops). */
export const BASIC_PACK_TIER: PackTierDefinition = {
	id: "basic",
	name: "Basic Pack",
	priceCoins: PACK_PRICE_COINS,
	rarityOdds: RARITY_ODDS,
	foilChance: FOIL_CHANCE,
};

const DELUXE_PACK_TIER: PackTierDefinition = {
	id: "deluxe",
	name: "Deluxe Pack",
	priceCoins: DELUXE_PACK_PRICE_COINS,
	rarityOdds: DELUXE_RARITY_ODDS,
	foilChance: DELUXE_FOIL_CHANCE,
};

const LEGENDARY_PACK_TIER: PackTierDefinition = {
	id: "legendary",
	name: "Legendary Pack",
	priceCoins: LEGENDARY_PACK_PRICE_COINS,
	rarityOdds: LEGENDARY_RARITY_ODDS,
	foilChance: LEGENDARY_FOIL_CHANCE,
	guaranteedMinRarity: LEGENDARY_GUARANTEED_MIN_RARITY,
};

/** Every purchasable pack tier, cheapest to priciest. */
export const PACK_TIERS: readonly PackTierDefinition[] = [
	BASIC_PACK_TIER,
	DELUXE_PACK_TIER,
	LEGENDARY_PACK_TIER,
] as const;

export const PACK_TIER_IDS: readonly PackTierId[] = PACK_TIERS.map(
	(tier) => tier.id,
);

// ── Catalogue ──────────────────────────────────────────────────────────────────

const POWER_SHELL_CARDS: readonly CardDefinition[] = [
	{
		id: "power-heavy",
		family: "power_shell",
		rarity: "stone",
		name: "Heavy Shell",
		flavor: "Dense as a temple stone — it shoves all in its path.",
		sourceRef: "heavy",
		imageUrl: "/assets/power-ups/heavyPower.png",
	},
	{
		id: "power-slick",
		family: "power_shell",
		rarity: "stone",
		name: "Slick Shell",
		flavor: "Glides forever across the polished dojo floor.",
		sourceRef: "slick",
	},
	{
		id: "power-spinning",
		family: "power_shell",
		rarity: "stone",
		name: "Spinning Shell",
		flavor: "Curls hard, like a top loosed by a master's hand.",
		sourceRef: "spinning",
		imageUrl: "/assets/power-ups/spinningPower.png",
	},
	{
		id: "power-bouncer",
		family: "power_shell",
		rarity: "stone",
		name: "Bouncer Shell",
		flavor: "Caroms off the walls with a cheerful clack.",
		sourceRef: "bouncer",
	},
	{
		id: "power-tiny",
		family: "power_shell",
		rarity: "stone",
		name: "Tiny Shell",
		flavor: "Small, swift, and maddeningly hard to strike.",
		sourceRef: "tiny",
		imageUrl: "/assets/power-ups/tinyPower.png",
	},
	{
		id: "power-giant",
		family: "power_shell",
		rarity: "stone",
		name: "Giant Shell",
		flavor: "A slow colossus that fills half the sheet.",
		sourceRef: "giant",
		imageUrl: "/assets/power-ups/giantPower.png",
	},
	{
		id: "power-bomb",
		family: "power_shell",
		rarity: "bronze",
		name: "Bomb Shell",
		flavor: "Detonates on rest, scattering everything nearby.",
		sourceRef: "bomb",
	},
	{
		id: "power-splitter",
		family: "power_shell",
		rarity: "bronze",
		name: "Splitter Shell",
		flavor: "Cracks into a fan of smaller shells mid-flight.",
		sourceRef: "splitter",
		imageUrl: "/assets/power-ups/splitterPower.png",
	},
	{
		id: "power-magnet",
		family: "power_shell",
		rarity: "bronze",
		name: "Magnet Shell",
		flavor: "Draws wandering stones into its embrace.",
		sourceRef: "magnet",
	},
	{
		id: "power-shield",
		family: "power_shell",
		rarity: "bronze",
		name: "Shield Shell",
		flavor: "Stands its ground when lesser shells are shoved aside.",
		sourceRef: "shield",
	},
	{
		id: "power-freeze",
		family: "power_shell",
		rarity: "bronze",
		name: "Freeze Shell",
		flavor: "Locks rivals in place with a breath of winter.",
		sourceRef: "freeze",
	},
	{
		id: "power-repel",
		family: "power_shell",
		rarity: "bronze",
		name: "Repel Shell",
		flavor: "Pushes the whole field away with a silent shove.",
		sourceRef: "repel",
	},
	{
		id: "power-sticky",
		family: "power_shell",
		rarity: "bronze",
		name: "Sticky Shell",
		flavor: "Fuses with the first shell it meets; they coast as one.",
		sourceRef: "sticky",
	},
	{
		id: "power-ghost",
		family: "power_shell",
		rarity: "jade",
		name: "Ghost Shell",
		flavor: "Drifts through stones as if they were mist.",
		sourceRef: "ghost",
	},
	{
		id: "power-rocket",
		family: "power_shell",
		rarity: "jade",
		name: "Rocket Shell",
		flavor: "Twice the speed, none of the curl. Pure intent.",
		sourceRef: "rocket",
		imageUrl: "/assets/power-ups/rocketPower.png",
	},
	{
		id: "power-boomerang",
		family: "power_shell",
		rarity: "jade",
		name: "Boomerang Shell",
		flavor: "Travels out, then returns to the hand that loosed it.",
		sourceRef: "boomerang",
	},
	{
		id: "power-ricochet",
		family: "power_shell",
		rarity: "jade",
		name: "Ricochet Shell",
		flavor: "Passes through the first to strike the second.",
		sourceRef: "ricochet",
	},
	{
		id: "power-vortex",
		family: "power_shell",
		rarity: "jade",
		name: "Vortex Shell",
		flavor: "Spirals inward towards the heart of the house.",
		sourceRef: "vortex",
	},
	{
		id: "power-lightning",
		family: "power_shell",
		rarity: "gold",
		name: "Lightning Shell",
		flavor: "On rest, it banishes the nearest rival off the sheet.",
		sourceRef: "lightning",
	},
	{
		id: "power-clone",
		family: "power_shell",
		rarity: "gold",
		name: "Clone Shell",
		flavor: "Casts a mirror-self down the opposite curl.",
		sourceRef: "clone",
		imageUrl: "/assets/power-ups/mirrorPower.png",
	},
	{
		id: "power-phantom",
		family: "power_shell",
		rarity: "gold",
		name: "Phantom Shell",
		flavor: "Unseen while it moves; revealed only at rest.",
		sourceRef: "phantom",
		imageUrl: "/assets/power-ups/phantomPower.png",
	},
];

const SHRINE_CARDS: readonly CardDefinition[] = [
	{
		id: "shrine-kame-knock",
		family: "shrine",
		rarity: "stone",
		name: "Kame Knock Shrine",
		flavor: "Billiards-like target smashing in the dojo arena.",
		sourceRef: "kame-knock",
	},
	{
		id: "shrine-bell-clash",
		family: "shrine",
		rarity: "bronze",
		name: "Bell Clash Shrine",
		flavor: "Ring the great temple bell from the perfect angle.",
		sourceRef: "bell-clash",
	},
	{
		id: "shrine-temple-curling",
		family: "shrine",
		rarity: "bronze",
		name: "Temple Curling Shrine",
		flavor: "Hot-seat curling with shells, bumpers, and powers.",
		sourceRef: "temple-curling",
	},
	{
		id: "shrine-bamboo-bash",
		family: "shrine",
		rarity: "jade",
		name: "Bamboo Bash Shrine",
		flavor: "Survive the forest as the bamboo closes in.",
		sourceRef: "bamboo-bash",
	},
	{
		id: "shrine-river-rush",
		family: "shrine",
		rarity: "jade",
		name: "River Rush Shrine",
		flavor: "Race the cherry-blossom current before it sweeps you away.",
		sourceRef: "river-rush",
	},
];

const SHELL_SKIN_CARDS: readonly CardDefinition[] = [
	{
		id: "skin-base",
		family: "shell_skin",
		rarity: "stone",
		name: "Default Shell",
		flavor: "The plain starter shell every player begins with.",
		sourceRef: "base",
	},
	{
		id: "skin-bamboo",
		family: "shell_skin",
		rarity: "bronze",
		name: "Bamboo Shell",
		flavor: "A calm green shell for the regular of the dojo.",
		sourceRef: "bamboo",
	},
	{
		id: "skin-dragon",
		family: "shell_skin",
		rarity: "gold",
		name: "Dragon Shell",
		flavor: "A fierce crimson shell for proven champions.",
		sourceRef: "dragon",
	},
];

const CHARACTER_CARDS: readonly CardDefinition[] = [
	{
		id: "char-pirate",
		family: "character",
		rarity: "gold",
		name: "Kaizoku, the Corsair Shell",
		flavor:
			"Exiled from the mountain dojo, he claimed a ship and a code of his own. The seven seas are his sheet now.",
		sourceRef: "pirate-turtle",
		imageUrl: "/assets/character/pirate-turtle.webp",
	},
	{
		id: "char-reaper",
		family: "character",
		rarity: "gold",
		name: "Shinigame, the Shell Reaper",
		flavor:
			"A hooded turtle who harvests fallen shells by lantern-light. Few ever see his scythe twice.",
		sourceRef: "reaper-turtle",
		imageUrl: "/assets/character/reaper-turtle.jpg",
	},
	{
		id: "char-samurai",
		family: "character",
		rarity: "gold",
		name: "Kabuto, the Bushido Shell",
		flavor:
			"A masterless samurai turtle bound by the dojo's code. His blade is patient; his shell, unbroken.",
		sourceRef: "samurai-turtle",
		imageUrl: "/assets/character/samurai-turtle.webp",
	},
	{
		id: "char-santa",
		family: "character",
		rarity: "gold",
		name: "Santa Kame, the Yuletide Shell",
		flavor:
			"Once a year he trades the dojo mat for a sack of stolen shells — and somehow, every rival forgives him by morning.",
		sourceRef: "santa-turtle",
		imageUrl: "/assets/character/santa-turtle.webp",
	},
	{
		id: "char-assassin",
		family: "character",
		rarity: "gold",
		name: "Kagemusha, the Assassin Shell",
		flavor:
			"No footstep, no shadow, no warning. Only the shell left spinning where a rival once stood.",
		sourceRef: "assassin-turtle",
		imageUrl: "/assets/character/assassin-turtle.webp",
	},
	{
		id: "char-ghost",
		family: "character",
		rarity: "gold",
		name: "Yurei, the Wandering Ghost Shell",
		flavor:
			"Still circling the sheet long after the match ended. Some say he's still waiting for a fair roll.",
		sourceRef: "ghost-turtle",
		imageUrl: "/assets/character/ghost-turtle.webp",
	},
	{
		id: "char-sumo",
		family: "character",
		rarity: "gold",
		name: "Sumo, the Immovable Shell",
		flavor:
			"Plants himself on the sheet and dares the field to try. Nothing has moved him yet.",
		sourceRef: "sumo-turtle",
		imageUrl: "/assets/character/sumo-turtle.webp",
	},
	{
		id: "char-godly",
		family: "character",
		rarity: "gold",
		name: "Kamigame, the Godly Shell",
		flavor:
			"Ascended past mortal dojo rank, he doesn't play the odds — the odds play for him.",
		sourceRef: "godly-turtle",
		imageUrl: "/assets/character/godly-turtle.png",
	},
	{
		id: "char-demon",
		family: "character",
		rarity: "gold",
		name: "Akuma, the Demon Shell",
		flavor:
			"Cast out of the dojo for playing dirty. He came back anyway, fire and all.",
		sourceRef: "demon-turtle",
		imageUrl: "/assets/character/demon-turtle.png",
	},
	{
		id: "char-knight",
		family: "character",
		rarity: "gold",
		name: "Kishi, the Knight Shell",
		flavor:
			"Bound by an oath older than the dojo itself. His shell has never once turned from a challenge.",
		sourceRef: "knight-turtle",
		imageUrl: "/assets/character/knight-turtle.png",
	},
	{
		id: "char-rasta",
		family: "character",
		rarity: "gold",
		name: "Irie Kame, the Roots Shell",
		flavor:
			"Never in a hurry, never off the beat — he wins the same way he relaxes: with a slow smile and a steady groove.",
		sourceRef: "rasta-turtle",
		imageUrl: "/assets/character/rasta-turtle.png",
	},
];

export const CARDS: readonly CardDefinition[] = [
	...POWER_SHELL_CARDS,
	...SHRINE_CARDS,
	...SHELL_SKIN_CARDS,
	...CHARACTER_CARDS,
];

// ── Lookups ──────────────────────────────────────────────────────────────────

const CARDS_BY_ID: ReadonlyMap<string, CardDefinition> = new Map(
	CARDS.map((card) => [card.id, card]),
);

export function findCard(id: string): CardDefinition | undefined {
	return CARDS_BY_ID.get(id);
}

export function cardsByFamily(family: CardFamily): CardDefinition[] {
	return CARDS.filter((card) => card.family === family);
}

export function cardsByRarity(rarity: CardRarity): CardDefinition[] {
	return CARDS.filter((card) => card.rarity === rarity);
}

const PACK_TIERS_BY_ID: ReadonlyMap<PackTierId, PackTierDefinition> = new Map(
	PACK_TIERS.map((tier) => [tier.id, tier]),
);

export function findPackTier(id: PackTierId): PackTierDefinition | undefined {
	return PACK_TIERS_BY_ID.get(id);
}
