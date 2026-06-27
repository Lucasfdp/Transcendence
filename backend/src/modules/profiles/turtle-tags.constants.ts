export interface TurtleTagDefinition {
	id: string;
	emoji: string;
	label: string;
	description: string;
}

export const TURTLE_TAGS: TurtleTagDefinition[] = [
	// Playstyle
	{
		id: "shell-first",
		emoji: "🛡️",
		label: "Shell First",
		description: "Plays it safe — defence wins games.",
	},
	{
		id: "speed-swimmer",
		emoji: "💨",
		label: "Speed Swimmer",
		description: "Fast and aggressive, always first to strike.",
	},
	{
		id: "sniper-shell",
		emoji: "🎯",
		label: "Sniper Shell",
		description: "Precision over power — every shot counts.",
	},
	{
		id: "wild-card",
		emoji: "🎲",
		label: "Wild Card",
		description: "Unpredictable — opponents never know what's coming.",
	},
	{
		id: "shadow-snapper",
		emoji: "🥷",
		label: "Shadow Snapper",
		description: "Sneaky and patient — strikes when least expected.",
	},
	// Personality
	{
		id: "ancient-wisdom",
		emoji: "🧠",
		label: "Ancient Wisdom",
		description: "Strategic and methodical — thinks three moves ahead.",
	},
	{
		id: "immovable-stone",
		emoji: "🗿",
		label: "Immovable Stone",
		description: "Patient and stubborn — outlasts everyone.",
	},
	{
		id: "bamboo-monk",
		emoji: "🎋",
		label: "Bamboo Monk",
		description: "Zen and unbothered — win or lose, it's all training.",
	},
	{
		id: "show-off-shell",
		emoji: "🎭",
		label: "Show-off Shell",
		description: "Loves style — winning in style is the only way.",
	},
	{
		id: "trophy-hunter",
		emoji: "🏆",
		label: "Trophy Hunter",
		description: "Achievement obsessed — every milestone must be earned.",
	},
	// Casual / fun
	{
		id: "night-crawler",
		emoji: "🌙",
		label: "Night Crawler",
		description: "Lives for the late-night sessions.",
	},
	{
		id: "go-with-the-flow",
		emoji: "🌊",
		label: "Go With the Flow",
		description: "Here for a good time — no pressure.",
	},
	{
		id: "shell-surfer",
		emoji: "🏄",
		label: "Shell Surfer",
		description: "Adaptable and laid-back — rides whatever comes.",
	},
	{
		id: "dragon-chaser",
		emoji: "🐉",
		label: "Dragon Chaser",
		description: "Always grinding — the next rank is always in sight.",
	},
	{
		id: "bamboo-grazer",
		emoji: "🍃",
		label: "Bamboo Grazer",
		description: "Chill and unhurried — the dojo is a garden.",
	},
	{
		id: "thunder-shell",
		emoji: "⚡",
		label: "Thunder Shell",
		description: "Explosive energy — every match is a storm.",
	},
];

export const TURTLE_TAG_IDS: readonly string[] = TURTLE_TAGS.map((t) => t.id);
