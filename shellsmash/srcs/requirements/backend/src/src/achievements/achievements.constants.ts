import { User } from '../users/entities/user.entity';
import { UserGameStats } from '../game-results/entities/user-game-stats.entity';

export interface AchievementContext {
  user: User;
  gameStats: Map<string, UserGameStats>;
}

export type AchievementReward =
  | { type: 'cosmetic'; cosmeticId: string; label: string }
  | { type: 'coins'; amount: number; label: string }
  | { type: 'title'; titleId: string; label: string }
  | { type: 'none'; label?: string };

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

const noReward = (label?: string): AchievementReward => ({ type: 'none', ...(label ? { label } : {}) });

const cosmeticReward = (cosmeticId: string, label: string): AchievementReward => ({
  type: 'cosmetic',
  cosmeticId,
  label,
});

const coinReward = (amount: number, label: string): AchievementReward => ({
  type: 'coins',
  amount,
  label,
});

const profileValue = (ctx: AchievementContext, key: 'gamesPlayed' | 'totalWins' | 'totalLosses' | 'totalCoinsEarned'): number => (
  ctx.user.profile?.[key] ?? 0
);

const gameValue = (ctx: AchievementContext, gameId: string, key: 'gamesPlayed' | 'totalWins' | 'totalLosses'): number => (
  ctx.gameStats.get(gameId)?.[key] ?? 0
);

const globalProgress = (
  key: 'gamesPlayed' | 'totalWins' | 'totalLosses' | 'totalCoinsEarned',
  target: number,
) => (ctx: AchievementContext): { current: number; target: number } => ({ current: profileValue(ctx, key), target });

const gameProgress = (
  gameId: string,
  key: 'gamesPlayed' | 'totalWins' | 'totalLosses',
  target: number,
) => (ctx: AchievementContext): { current: number; target: number } => ({ current: gameValue(ctx, gameId, key), target });

const levelProgress = (target: number) => (ctx: AchievementContext): { current: number; target: number } => ({
  current: ctx.user.level ?? 1,
  target,
});

const reaches = (
  progress: (ctx: AchievementContext) => { current: number; target: number },
) => (ctx: AchievementContext): boolean => progress(ctx).current >= progress(ctx).target;

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: 'first-match',
    title: 'First Match',
    description: 'Complete your first match in the dojo.',
    unlockDescription: 'You completed your first match. The dojo now knows your shell.',
    reward: noReward('Progress record unlocked'),
    progress: globalProgress('gamesPlayed', 1),
    isUnlocked: reaches(globalProgress('gamesPlayed', 1)),
  },
  {
    id: 'dojo-regular',
    title: 'Dojo Regular',
    description: 'Play 10 matches.',
    unlockDescription: 'Ten matches completed. Your discipline is starting to show.',
    reward: cosmeticReward('bamboo', 'Bamboo Shell unlocked'),
    progress: globalProgress('gamesPlayed', 10),
    isUnlocked: reaches(globalProgress('gamesPlayed', 10)),
  },
  {
    id: 'dojo-veteran',
    title: 'Dojo Veteran',
    description: 'Play 50 matches.',
    unlockDescription: 'Fifty matches completed. You are part of the dojo floorboards now.',
    reward: noReward('Veteran milestone recorded'),
    progress: globalProgress('gamesPlayed', 50),
    isUnlocked: reaches(globalProgress('gamesPlayed', 50)),
  },
  {
    id: 'first-win',
    title: 'First Victory',
    description: 'Win one match.',
    unlockDescription: 'First victory secured. Your technique is starting to stand out.',
    reward: cosmeticReward('dragon', 'Dragon Shell unlocked'),
    progress: globalProgress('totalWins', 1),
    isUnlocked: reaches(globalProgress('totalWins', 1)),
  },
  {
    id: 'rising-shell',
    title: 'Rising Shell',
    description: 'Reach level 2.',
    unlockDescription: 'You reached level 2. Your shell feels lighter.',
    reward: noReward('Starter rank improved'),
    progress: levelProgress(2),
    isUnlocked: reaches(levelProgress(2)),
  },
  {
    id: 'seasoned-shell',
    title: 'Seasoned Shell',
    description: 'Reach level 5.',
    unlockDescription: 'You reached level 5. The dojo respects your persistence.',
    reward: noReward('Level milestone recorded'),
    progress: levelProgress(5),
    isUnlocked: reaches(levelProgress(5)),
  },
  {
    id: 'first-bounty',
    title: 'First Bounty',
    description: 'Earn coins for the first time.',
    unlockDescription: 'You earned your first dojo coins.',
    reward: coinReward(25, '25 bonus coins'),
    progress: globalProgress('totalCoinsEarned', 1),
    isUnlocked: reaches(globalProgress('totalCoinsEarned', 1)),
  },
  {
    id: 'coin-collector',
    title: 'Coin Collector',
    description: 'Earn 500 total coins over time.',
    unlockDescription: 'Five hundred coins earned. Your shell purse is getting heavy.',
    reward: noReward('Coin milestone recorded'),
    progress: globalProgress('totalCoinsEarned', 500),
    isUnlocked: reaches(globalProgress('totalCoinsEarned', 500)),
  },
  {
    id: 'kame-knock-initiate',
    title: 'Kame Knock Initiate',
    description: 'Play 1 Kame Knock match.',
    unlockDescription: 'You stepped into Kame Knock for the first time.',
    reward: noReward(),
    progress: gameProgress('kame-knock', 'gamesPlayed', 1),
    isUnlocked: reaches(gameProgress('kame-knock', 'gamesPlayed', 1)),
  },
  {
    id: 'kame-knock-regular',
    title: 'Kame Knock Regular',
    description: 'Play 10 Kame Knock matches.',
    unlockDescription: 'Ten Kame Knock matches completed. The ring knows your rhythm.',
    reward: noReward('Kame Knock milestone recorded'),
    progress: gameProgress('kame-knock', 'gamesPlayed', 10),
    isUnlocked: reaches(gameProgress('kame-knock', 'gamesPlayed', 10)),
  },
  {
    id: 'bamboo-bash-initiate',
    title: 'Bamboo Bash Initiate',
    description: 'Play 1 Bamboo Bash match.',
    unlockDescription: 'You took your first swing in Bamboo Bash.',
    reward: noReward(),
    progress: gameProgress('bamboo-bash', 'gamesPlayed', 1),
    isUnlocked: reaches(gameProgress('bamboo-bash', 'gamesPlayed', 1)),
  },
  {
    id: 'bamboo-bash-regular',
    title: 'Bamboo Bash Regular',
    description: 'Play 10 Bamboo Bash matches.',
    unlockDescription: 'Ten Bamboo Bash matches completed. Splinters fear you.',
    reward: noReward('Bamboo Bash milestone recorded'),
    progress: gameProgress('bamboo-bash', 'gamesPlayed', 10),
    isUnlocked: reaches(gameProgress('bamboo-bash', 'gamesPlayed', 10)),
  },
  {
    id: 'shell-curl-initiate',
    title: 'Shell Curl Initiate',
    description: 'Play 1 Shell Curl match.',
    unlockDescription: 'You slid into Shell Curl for the first time.',
    reward: noReward(),
    progress: gameProgress('shell-curl', 'gamesPlayed', 1),
    isUnlocked: reaches(gameProgress('shell-curl', 'gamesPlayed', 1)),
  },
  {
    id: 'shell-curl-regular',
    title: 'Shell Curl Regular',
    description: 'Play 10 Shell Curl matches.',
    unlockDescription: 'Ten Shell Curl matches completed. Your line control is improving.',
    reward: noReward('Shell Curl milestone recorded'),
    progress: gameProgress('shell-curl', 'gamesPlayed', 10),
    isUnlocked: reaches(gameProgress('shell-curl', 'gamesPlayed', 10)),
  },
];
