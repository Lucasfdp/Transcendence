import { User } from '../users/entities/user.entity';

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  unlockDescription: string;
  rewardLabel?: string;
  rewardCosmeticId?: string;
  progress: (user: User) => { current: number; target: number };
  isUnlocked: (user: User) => boolean;
}

export interface AchievementView {
  id: string;
  title: string;
  description: string;
  unlockDescription: string;
  rewardLabel?: string;
  rewardCosmeticId?: string;
  progressCurrent: number;
  progressTarget: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: 'first-match',
    title: 'First Match',
    description: 'Complete your first match in the dojo.',
    unlockDescription: 'You completed your first match. The dojo now knows your shell.',
    rewardLabel: 'Progress record unlocked',
    progress: (user) => ({ current: user.profile?.gamesPlayed ?? 0, target: 1 }),
    isUnlocked: (user) => (user.profile?.gamesPlayed ?? 0) >= 1,
  },
  {
    id: 'first-win',
    title: 'First Victory',
    description: 'Win one match.',
    unlockDescription: 'First victory secured. Your technique is starting to stand out.',
    rewardLabel: 'Dragon Shell unlocked',
    rewardCosmeticId: 'dragon',
    progress: (user) => ({ current: user.profile?.totalWins ?? 0, target: 1 }),
    isUnlocked: (user) => (user.profile?.totalWins ?? 0) >= 1,
  },
  {
    id: 'dojo-regular',
    title: 'Dojo Regular',
    description: 'Play 10 matches.',
    unlockDescription: 'Ten matches completed. Your discipline is starting to show.',
    rewardLabel: 'Bamboo Shell unlocked',
    rewardCosmeticId: 'bamboo',
    progress: (user) => ({ current: user.profile?.gamesPlayed ?? 0, target: 10 }),
    isUnlocked: (user) => (user.profile?.gamesPlayed ?? 0) >= 10,
  },
  {
    id: 'rising-shell',
    title: 'Rising Shell',
    description: 'Reach level 2.',
    unlockDescription: 'You reached level 2. Your shell feels lighter.',
    rewardLabel: 'Starter rank improved',
    progress: (user) => ({ current: user.level ?? 1, target: 2 }),
    isUnlocked: (user) => (user.level ?? 1) >= 2,
  },
  {
    id: 'first-bounty',
    title: 'First Bounty',
    description: 'Earn coins for the first time.',
    unlockDescription: 'You earned your first dojo coins.',
    rewardLabel: 'Coins registered',
    progress: (user) => ({ current: user.coins ?? 0, target: 1 }),
    isUnlocked: (user) => (user.coins ?? 0) > 0,
  },
];
