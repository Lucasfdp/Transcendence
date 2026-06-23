export type CosmeticType = "shell_skin" | "hub_background";

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
};

export const COSMETICS: CosmeticDefinition[] = [
	{
		id: "kanagawa",
		type: "shell_skin",
		name: "Kanagawa Shell",
		description: "Classic blue shell pattern. The default dojo style.",
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
		id: "cycle_bg",
		type: "hub_background",
		name: "Cycle Background",
		description: "Layered parallax sky with a moving day-cycle horizon.",
		price: 0,
		defaultUnlocked: true,
		accentColor: 0x526f9f,
		previewColor: 0xbcd8ff,
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
