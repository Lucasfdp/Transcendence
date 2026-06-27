/**
 * Shell Cards — catalog & economy constants.
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
	/** Globally unique catalog id, e.g. "power-heavy", "shrine-kame-knock". */
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

/** A catalog card enriched with the requesting user's ownership state. */
export interface CardView extends CardDefinition {
	owned: boolean;
	/** Total copies owned (0 when not owned). */
	count: number;
	/** Foil copies owned (0 when none). */
	foilCount: number;
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
	/** Overall distinct-card progress across the whole catalog. */
	totals: { owned: number; total: number };
	/** Server-authoritative pack price so the client need not hardcode it. */
	packPrice: number;
}

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
 * chosen uniformly, so the catalog must contain ≥1 card per rarity.
 */
export const RARITY_ODDS: Readonly<Record<CardRarity, number>> = {
	stone: 0.6,
	bronze: 0.27,
	jade: 0.1,
	gold: 0.03,
};

/** Chance a granted card is the shiny "foil" variant (cosmetic only). */
export const FOIL_CHANCE = 0.05;

/** Cards yielded by opening one pack. */
export const PACK_SIZE = 5;

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

// ── Catalog ──────────────────────────────────────────────────────────────────

const POWER_SHELL_CARDS: readonly CardDefinition[] = [
	{
		id: "power-heavy",
		family: "power_shell",
		rarity: "stone",
		name: "Heavy Shell",
		flavor: "Dense as a temple stone — it shoves all in its path.",
		sourceRef: "heavy",
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
	},
	{
		id: "power-giant",
		family: "power_shell",
		rarity: "stone",
		name: "Giant Shell",
		flavor: "A slow colossus that fills half the sheet.",
		sourceRef: "giant",
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
		flavor: "Spirals inward toward the heart of the house.",
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
	},
	{
		id: "power-phantom",
		family: "power_shell",
		rarity: "gold",
		name: "Phantom Shell",
		flavor: "Unseen while it moves; revealed only at rest.",
		sourceRef: "phantom",
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
		id: "skin-kanagawa",
		family: "shell_skin",
		rarity: "stone",
		name: "Kanagawa Shell",
		flavor: "The classic blue wave — the default dojo style.",
		sourceRef: "kanagawa",
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
		id: "char-reaper",
		family: "character",
		rarity: "gold",
		name: "Shinigame, the Shell Reaper",
		flavor:
			"A hooded turtle who harvests fallen shells by lantern-light. Few ever see his scythe twice.",
		sourceRef: "reaper-turtle",
		imageUrl: "/assets/character/reaper-turtle.jpg",
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
