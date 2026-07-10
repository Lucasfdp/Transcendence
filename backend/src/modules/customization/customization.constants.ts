export type CosmeticType =
	| "shell_skin"
	| "hub_background"
	| "hub_background_alter"
	| "dojo_tag";

export interface CosmeticDefinition {
	id: string;
	type: CosmeticType;
	name: string;
	description: string;
	price: number;
	unlockAchievementId?: string;
	defaultUnlocked?: boolean;
	accentColor: number;
	previewColor?: number;
	parentCosmeticId?: string;
	tagEmoji?: string;
}

export interface CosmeticView extends CosmeticDefinition {
	owned: boolean;
	equipped: boolean;
	unlockRequirement?: { type: "achievement"; achievementId: string };
	lockedReason?: "achievement-locked" | "not enough coins" | "purchasable";
}

const LEGACY_COSMETIC_IDS: Record<string, string> = {
	default_dojo: "night_bg",
	sunset_dojo: "sunset_bg",
	cycle_bg: "night_cycle_bg",
};

export const COSMETICS: CosmeticDefinition[] = [
	{
		id: "base",
		type: "shell_skin",
		name: "Default Shell",
		description: "The plain starter shell. No special colour, no decoration, just the shell every player begins with.",
		price: 0,
		defaultUnlocked: true,
		accentColor: 0x1a3a5c,
	},
	{
		id: "dragon",
		type: "shell_skin",
		name: "Dragon Shell",
		description: "A fierce red shell for proven winners.",
		price: 150,
		unlockAchievementId: "matches-50-played",
		accentColor: 0x8b0000,
	},
	{
		id: "bamboo",
		type: "shell_skin",
		name: "Bamboo Shell",
		description: "A calm green shell awarded to regular dojo players.",
		price: 250,
		unlockAchievementId: "matches-10-played",
		accentColor: 0x2d5a1b,
	},
	{
		id: "purple",
		type: "shell_skin",
		name: "Purple Shell",
		description: "A purple shell for players who want a bolder dojo look.",
		price: 200,
		accentColor: 0x7a45b8,
	},
	{
		id: "pink",
		type: "shell_skin",
		name: "Pink Shell",
		description: "A bright pink shell for players who bring extra flair to the dojo.",
		price: 200,
		accentColor: 0xf26bb8,
	},
	{
		id: "stone",
		type: "shell_skin",
		name: "Stone Shell",
		description: "A rugged stone shell for players who prefer a grounded look.",
		price: 200,
		accentColor: 0x6f7378,
	},
	{
		id: "night_bg",
		type: "hub_background",
		name: "Night Background",
		description: "The moonlit Shell Smash dojo hub.",
		price: 0,
		defaultUnlocked: true,
		accentColor: 0x14083a,
		previewColor: 0xfff5d6,
	},
	{
		id: "sunset_bg",
		type: "hub_background",
		name: "Sunset Background",
		description: "A warm orange and violet dojo at dusk.",
		price: 0,
		defaultUnlocked: true,
		accentColor: 0xd97832,
		previewColor: 0xffd18a,
	},
	{
		id: "sunrise_bg",
		type: "hub_background",
		name: "Sunrise Background",
		description: "A bright morning dojo as the sun rises.",
		price: 150,
		accentColor: 0xf0a24b,
		previewColor: 0xffe3a6,
	},
	{
		id: "login_bg",
		type: "hub_background",
		name: "Shell Smash Gate",
		description: "The Shell Smash login gate brought into the dojo hub.",
		price: 200,
		accentColor: 0x2f5f7f,
		previewColor: 0xd7f1ff,
	},
	{
		id: "night_cycle_bg",
		type: "hub_background_alter",
		parentCosmeticId: "night_bg",
		name: "Night Cycle Alter",
		description: "Animated alter art for the moonlit dojo background.",
		price: 0,
		defaultUnlocked: true,
		accentColor: 0x526f9f,
		previewColor: 0xbcd8ff,
	},
	{
		id: "sunset_cycle_bg",
		type: "hub_background_alter",
		parentCosmeticId: "sunset_bg",
		name: "Sunset Cycle Alter",
		description: "Alter slot for the dusk dojo background.",
		price: 999,
		accentColor: 0xde7a5a,
		previewColor: 0xffc29f,
	},
	{
		id: "sunrise_cycle_bg",
		type: "hub_background_alter",
		parentCosmeticId: "sunrise_bg",
		name: "Sunrise Cycle Alter",
		description: "Alter slot for the morning dojo background.",
		price: 999,
		accentColor: 0xf0a24b,
		previewColor: 0xffdfa4,
	},
	{
		id: "login_cycle_bg",
		type: "hub_background_alter",
		parentCosmeticId: "login_bg",
		name: "Shell Smash Gate Alter",
		description: "Alter slot for the Shell Smash login gate background.",
		price: 999,
		accentColor: 0x2f5f7f,
		previewColor: 0xd7f1ff,
	},
	{
		id: "shell-first",
		type: "dojo_tag",
		name: "Shell First",
		description: "Plays it safe — defence wins games.",
		price: 0,
		defaultUnlocked: true,
		accentColor: 0x4a6f8f,
		tagEmoji: "🛡️",
	},
	{
		id: "speed-swimmer",
		type: "dojo_tag",
		name: "Speed Swimmer",
		description: "Fast and aggressive, always first to strike.",
		price: 80,
		accentColor: 0x5fc7d9,
		tagEmoji: "💨",
	},
	{
		id: "sniper-shell",
		type: "dojo_tag",
		name: "Sniper Shell",
		description: "Precision over power — every shot counts.",
		price: 120,
		unlockAchievementId: "matches-10-played",
		accentColor: 0xd95f5f,
		tagEmoji: "🎯",
	},
	{
		id: "wild-card",
		type: "dojo_tag",
		name: "Wild Card",
		description: "Unpredictable — opponents never know what's coming.",
		price: 100,
		accentColor: 0x9a6bd1,
		tagEmoji: "🎲",
	},
	{
		id: "shadow-snapper",
		type: "dojo_tag",
		name: "Shadow Snapper",
		description: "Sneaky and patient — strikes when least expected.",
		price: 180,
		unlockAchievementId: "matches-50-played",
		accentColor: 0x2e3142,
		tagEmoji: "🥷",
	},
	{
		id: "ancient-wisdom",
		type: "dojo_tag",
		name: "Ancient Wisdom",
		description: "Strategic and methodical — thinks three moves ahead.",
		price: 120,
		unlockAchievementId: "matches-10-played",
		accentColor: 0x7b6fb0,
		tagEmoji: "🧠",
	},
	{
		id: "immovable-stone",
		type: "dojo_tag",
		name: "Immovable Stone",
		description: "Patient and stubborn — outlasts everyone.",
		price: 100,
		accentColor: 0x6d6a62,
		tagEmoji: "🗿",
	},
	{
		id: "bamboo-monk",
		type: "dojo_tag",
		name: "Bamboo Monk",
		description: "Zen and unbothered — win or lose, it's all training.",
		price: 80,
		accentColor: 0x4c8a4a,
		tagEmoji: "🎋",
	},
	{
		id: "show-off-shell",
		type: "dojo_tag",
		name: "Show-off Shell",
		description: "Loves style — winning in style is the only way.",
		price: 160,
		unlockAchievementId: "dojo-coins-100-earned",
		accentColor: 0xc878c8,
		tagEmoji: "🎭",
	},
	{
		id: "trophy-hunter",
		type: "dojo_tag",
		name: "Trophy Hunter",
		description: "Achievement obsessed — every milestone must be earned.",
		price: 200,
		unlockAchievementId: "matches-50-played",
		accentColor: 0xd4af37,
		tagEmoji: "🏆",
	},
	{
		id: "night-crawler",
		type: "dojo_tag",
		name: "Night Crawler",
		description: "Lives for the late-night sessions.",
		price: 80,
		accentColor: 0x3a3f7a,
		tagEmoji: "🌙",
	},
	{
		id: "go-with-the-flow",
		type: "dojo_tag",
		name: "Go With the Flow",
		description: "Here for a good time — no pressure.",
		price: 80,
		accentColor: 0x3e9bc6,
		tagEmoji: "🌊",
	},
	{
		id: "shell-surfer",
		type: "dojo_tag",
		name: "Shell Surfer",
		description: "Adaptable and laid-back — rides whatever comes.",
		price: 100,
		accentColor: 0x2fbf9f,
		tagEmoji: "🏄",
	},
	{
		id: "dragon-chaser",
		type: "dojo_tag",
		name: "Dragon Chaser",
		description: "Always grinding — the next rank is always in sight.",
		price: 180,
		unlockAchievementId: "matches-50-played",
		accentColor: 0xa83e2f,
		tagEmoji: "🐉",
	},
	{
		id: "bamboo-grazer",
		type: "dojo_tag",
		name: "Bamboo Grazer",
		description: "Chill and unhurried — the dojo is a garden.",
		price: 80,
		accentColor: 0x72a844,
		tagEmoji: "🍃",
	},
	{
		id: "thunder-shell",
		type: "dojo_tag",
		name: "Thunder Shell",
		description: "Explosive energy — every match is a storm.",
		price: 160,
		unlockAchievementId: "dojo-coins-100-earned",
		accentColor: 0xf0c445,
		tagEmoji: "⚡",
	},
];

export function findCosmetic(
	cosmeticId: string,
): CosmeticDefinition | undefined {
	const normalizedId = normalizeCosmeticId(cosmeticId);
	return COSMETICS.find((cosmetic) => cosmetic.id === normalizedId);
}

export function normalizeCosmeticId(cosmeticId: string): string {
	return LEGACY_COSMETIC_IDS[cosmeticId] ?? cosmeticId;
}
