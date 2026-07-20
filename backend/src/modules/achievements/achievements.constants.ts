import { User } from "../users/entities/user.entity";
import { UserGameStats } from "../game-results/entities/user-game-stats.entity";

export interface AchievementContext {
	user: User;
	gameStats: Map<string, UserGameStats>;
	/** Tournaments won (The Parrot's Shell champion count, SPEC-037/D10). */
	tournamentsWon: number;
}

export type AchievementReward =
	| { type: "cosmetic"; cosmeticId: string; label: string }
	| { type: "coins"; amount: number; label: string }
	| { type: "title"; titleId: string; label: string }
	| { type: "none"; label?: string };

export interface AchievementDefinition {
	id: string;
	title: string;
	description: string;
	unlockDescription: string;
	reward: AchievementReward;
	progress: (ctx: AchievementContext) => { current: number; target: number };
	isUnlocked: (ctx: AchievementContext) => boolean;
}

export interface AchievementView {
	id: string;
	title: string;
	description: string;
	unlockDescription: string;
	rewardLabel?: string;
	reward: AchievementReward;
	progressCurrent: number;
	progressTarget: number;
	unlocked: boolean;
	unlockedAt: string | null;
}

const noReward = (label?: string): AchievementReward => ({
	type: "none",
	...(label ? { label } : {}),
});

const cosmeticReward = (
	cosmeticId: string,
	label: string,
): AchievementReward => ({
	type: "cosmetic",
	cosmeticId,
	label,
});

const coinReward = (amount: number, label: string): AchievementReward => ({
	type: "coins",
	amount,
	label,
});

const profileValue = (
	ctx: AchievementContext,
	key: "gamesPlayed" | "totalWins" | "totalLosses" | "totalCoinsEarned",
): number => ctx.user.profile?.[key] ?? 0;

const gameValue = (
	ctx: AchievementContext,
	gameId: string,
	key: "gamesPlayed" | "totalWins" | "totalLosses" | "perfectRounds",
): number => ctx.gameStats.get(gameId)?.[key] ?? 0;

const globalProgress =
	(
		key: "gamesPlayed" | "totalWins" | "totalLosses" | "totalCoinsEarned",
		target: number,
	) =>
	(ctx: AchievementContext): { current: number; target: number } => ({
		current: profileValue(ctx, key),
		target,
	});

const gameProgress =
	(
		gameId: string,
		key: "gamesPlayed" | "totalWins" | "totalLosses" | "perfectRounds",
		target: number,
	) =>
	(ctx: AchievementContext): { current: number; target: number } => ({
		current: gameValue(ctx, gameId, key),
		target,
	});

const levelProgress =
	(target: number) =>
	(ctx: AchievementContext): { current: number; target: number } => ({
		current: ctx.user.level ?? 1,
		target,
	});

const reaches =
	(
		progress: (ctx: AchievementContext) => {
			current: number;
			target: number;
		},
	) =>
	(ctx: AchievementContext): boolean =>
		progress(ctx).current >= progress(ctx).target;

const gamePlayedMilestones = [1, 5, 10, 25, 50] as const;
const globalProgressMilestones = [1, 5, 10, 25, 50] as const;
const levelMilestones = [2, 5, 10, 25, 50] as const;
const dojoCoinMilestones = [1, 50, 100, 250, 500] as const;

const matchAchievements = (): AchievementDefinition[] =>
	globalProgressMilestones.map((target) => ({
		id: `matches-${target}-played`,
		title: `Dojo Matches ${target}`,
		description: `Play ${target} ${target === 1 ? "match" : "matches"}.`,
		unlockDescription: `${target} ${target === 1 ? "match" : "matches"} completed.`,
		reward:
			target === 10
				? cosmeticReward("bamboo", "Bamboo Shell unlocked")
				: target === 50
					? cosmeticReward("dragon", "Dragon Shell unlocked")
					: noReward(`Match ${target} milestone recorded`),
		progress: globalProgress("gamesPlayed", target),
		isUnlocked: reaches(globalProgress("gamesPlayed", target)),
	}));

const levelAchievements = (): AchievementDefinition[] =>
	levelMilestones.map((target) => ({
		id: `level-${target}-reached`,
		title: `Dojo Level ${target}`,
		description: `Reach level ${target}.`,
		unlockDescription: `You reached level ${target}.`,
		reward: noReward(`Level ${target} milestone recorded`),
		progress: levelProgress(target),
		isUnlocked: reaches(levelProgress(target)),
	}));

const dojoCoinAchievements = (): AchievementDefinition[] =>
	dojoCoinMilestones.map((target) => ({
		id: `dojo-coins-${target}-earned`,
		title: `Dojo Coins ${target}`,
		description: `Earn ${target} total dojo ${target === 1 ? "coin" : "coins"}.`,
		unlockDescription: `${target} total dojo ${target === 1 ? "coin" : "coins"} earned.`,
		reward:
			target === 1
				? coinReward(25, "25 bonus coins")
				: noReward(`Dojo coins ${target} milestone recorded`),
		progress: globalProgress("totalCoinsEarned", target),
		isUnlocked: reaches(globalProgress("totalCoinsEarned", target)),
	}));

const gamePlayedAchievements = (
	gameId: string,
	gameName: string,
): AchievementDefinition[] =>
	gamePlayedMilestones.map((target) => ({
		id: `${gameId}-${target}-played`,
		title: `${gameName} ${target}`,
		description: `Play ${target} ${gameName} ${target === 1 ? "match" : "matches"}.`,
		unlockDescription: `${target} ${gameName} ${target === 1 ? "match" : "matches"} completed.`,
		reward: noReward(`${gameName} ${target}-match milestone recorded`),
		progress: gameProgress(gameId, "gamesPlayed", target),
		isUnlocked: reaches(gameProgress(gameId, "gamesPlayed", target)),
	}));

/**
 * Kame Knock PERFECT ladder: a PERFECT is clearing every breakable target in
 * one ball round (the big "PERFECT!" splash in the arena). Counted through
 * `user_game_stats.perfectRounds`, the same participation trust class as
 * `gamesPlayed`.
 */
const kamePerfectMilestones = [1, 5, 10, 25, 50] as const;
const kamePerfectAchievements = (): AchievementDefinition[] =>
	kamePerfectMilestones.map((target) => ({
		id: `kame-knock-${target}-perfects`,
		title: target === 1 ? "Kame PERFECT!" : `Kame PERFECT! ${target}`,
		description: `Clear every breakable target in a Kame Knock round ${
			target === 1 ? "once" : `${target} times`
		}.`,
		unlockDescription:
			target === 1
				? "First PERFECT round achieved in Kame Knock."
				: `${target} PERFECT rounds achieved in Kame Knock.`,
		reward: noReward(`Kame Knock PERFECT ${target} milestone recorded`),
		progress: gameProgress("kame-knock", "perfectRounds", target),
		isUnlocked: reaches(gameProgress("kame-knock", "perfectRounds", target)),
	}));

/**
 * Tournament champion (SPEC-037/D10): win a Tournament and claim THE PARROT'S
 * SHELL. The 500-coin champion prize is granted directly by the Tournament
 * module when the win is recorded (idempotent, `lockUserForUpdate`); this
 * achievement is the durable badge, unlocked by the platform's normal lazy
 * evaluation off the persisted `tournaments.winnerUserId`.
 */
const tournamentChampionAchievement: AchievementDefinition = {
	id: "tournament-champion",
	title: "The Parrot's Shell",
	description: "Win a Tournament and claim THE PARROT'S SHELL.",
	unlockDescription: "Tournament won — THE PARROT'S SHELL is yours.",
	reward: noReward("Champion of The Parrot's Shell"),
	progress: (ctx: AchievementContext) => ({
		current: Math.min(ctx.tournamentsWon, 1),
		target: 1,
	}),
	isUnlocked: (ctx: AchievementContext): boolean => ctx.tournamentsWon >= 1,
};

export const ACHIEVEMENTS: AchievementDefinition[] = [
	...matchAchievements(),
	...levelAchievements(),
	...dojoCoinAchievements(),
	...gamePlayedAchievements("kame-knock", "Kame Knock"),
	...kamePerfectAchievements(),
	...gamePlayedAchievements("bamboo-bash", "Bamboo Bash"),
	...gamePlayedAchievements("bell-clash", "Bell Clash"),
	...gamePlayedAchievements("temple-curling", "Temple Curling"),
	tournamentChampionAchievement,
];
