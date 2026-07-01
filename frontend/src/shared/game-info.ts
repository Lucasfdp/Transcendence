import { THEME } from "./theme";
import type {
	GameInfoPanelDetails,
	GameInfoPanelRow,
} from "./ui/panels/GameInfoSidePanel";

export type GameInfoId =
	| "temple-curling"
	| "bamboo-bash"
	| "bell-clash"
	| "kame-knock";

const COMPLETION_REWARDS: GameInfoPanelRow[] = [
	{ label: "XP", value: "+30", valueColor: THEME.textJade },
	{ label: "COINS", value: "+20", valueColor: THEME.textGold },
	{ label: "CARD DROP", value: "1", valueColor: THEME.text },
];

export const GAME_INFO_PANEL_DETAILS: Record<GameInfoId, GameInfoPanelDetails> = {
	"temple-curling": {
		summaryTitle: "HOW TO SCORE",
		summaryLines: [
			"Alternate throws across 3 ends.",
			"Closest shells inside the house score for their team.",
		],
		rewardRows: COMPLETION_REWARDS,
	},
	"bamboo-bash": {
		summaryTitle: "HOW TO SCORE",
		summaryLines: [
			"Break bamboo before time runs out.",
			"Bigger bamboo is worth 100 / 150 / 250 points.",
		],
		rewardRows: COMPLETION_REWARDS,
	},
	"bell-clash": {
		summaryTitle: "HOW TO SCORE",
		summaryLines: [
			"Ring the bell in 3 shell shots.",
			"Zone multipliers: red x0.5, yellow x1.5, green x2.",
		],
		rewardRows: COMPLETION_REWARDS,
	},
	"kame-knock": {
		summaryTitle: "HOW TO SCORE",
		summaryLines: [
			"Smash targets across shell rounds.",
			"Chain hits and precise shots increase your score.",
		],
		rewardRows: COMPLETION_REWARDS,
	},
};
