import { User } from '../users/entities/user.entity';

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  unlockDescription: string;
  rewardLabel?: string;
  isUnlocked: (user: User) => boolean;
}

export interface AchievementView {
  id: string;
  title: string;
  description: string;
  unlockDescription: string;
  rewardLabel?: string;
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
    isUnlocked: (user) => (user.profile?.gamesPlayed ?? 0) >= 1,
  },
  {
    id: 'first-win',
    title: 'First Victory',
    description: 'Win one match.',
    unlockDescription: 'First victory secured. Your technique is starting to stand out.',
    rewardLabel: 'Winner badge',
    isUnlocked: (user) => (user.profile?.totalWins ?? 0) >= 1,
  },
  {
    id: 'dojo-regular',
    title: 'Dojo Regular',
    description: 'Play 10 matches.',
    unlockDescription: 'Ten matches completed. Your discipline is starting to show.',
    rewardLabel: 'Consistency mark',
    isUnlocked: (user) => (user.profile?.gamesPlayed ?? 0) >= 10,
  },
  {
    id: 'rising-shell',
    title: 'Rising Shell',
    description: 'Reach level 2.',
    unlockDescription: 'You reached level 2. Your shell feels lighter.',
    rewardLabel: 'Starter rank improved',
    isUnlocked: (user) => (user.level ?? 1) >= 2,
  },
  {
    id: 'first-bounty',
    title: 'First Bounty',
    description: 'Earn coins for the first time.',
    unlockDescription: 'You earned your first dojo coins.',
    rewardLabel: 'Coins registered',
    isUnlocked: (user) => (user.coins ?? 0) > 0,
  },
];
