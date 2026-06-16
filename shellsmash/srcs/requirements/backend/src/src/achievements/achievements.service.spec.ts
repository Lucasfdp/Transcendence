import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AchievementsService } from './achievements.service';
import { UserAchievement } from './entities/user-achievement.entity';
import { UserCosmetic } from '../customization/entities/user-cosmetic.entity';
import { User } from '../users/entities/user.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { UserGameStats } from '../game-results/entities/user-game-stats.entity';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  const profile = new Profile();
  profile.totalWins = overrides.totalWins ?? 0;
  profile.totalLosses = overrides.totalLosses ?? 0;
  profile.gamesPlayed = overrides.gamesPlayed ?? 0;
  profile.totalCoinsEarned = overrides.totalCoinsEarned ?? 0;
  profile.bio = overrides.bio ?? null;
  return profile;
}

function makeUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = overrides.id ?? 1;
  user.level = overrides.level ?? 1;
  user.xp = overrides.xp ?? 0;
  user.coins = overrides.coins ?? 0;
  user.profile = overrides.profile ?? makeProfile();
  return user;
}

function makeRecord(user: User, achievementId: string): UserAchievement {
  const record = new UserAchievement();
  record.id = 1;
  record.user = user;
  record.achievementId = achievementId;
  record.unlockedAt = new Date('2026-01-01T00:00:00Z');
  return record;
}

describe('AchievementsService', () => {
  let service: AchievementsService;
  let repo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let cosmeticsRepo: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let gameStatsRepo: { find: jest.Mock };
  let usersRepo: { save: jest.Mock };

  beforeEach(async () => {
    const mockRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: Partial<UserAchievement>) => data as UserAchievement),
      save: jest.fn(async (record: UserAchievement) => ({
        ...record,
        id: 1,
        unlockedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    };
    const mockCosmeticsRepo = {
      create: jest.fn((data: Partial<UserCosmetic>) => data as UserCosmetic),
      save: jest.fn(async (record: UserCosmetic) => ({
        ...record,
        id: 1,
        unlockedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    };
    const mockGameStatsRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    const mockUsersRepo = {
      save: jest.fn(async (user: User) => user),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementsService,
        { provide: getRepositoryToken(UserAchievement), useValue: mockRepo },
        { provide: getRepositoryToken(UserCosmetic), useValue: mockCosmeticsRepo },
        { provide: getRepositoryToken(UserGameStats), useValue: mockGameStatsRepo },
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
      ],
    }).compile();

    service = module.get(AchievementsService);
    repo = module.get(getRepositoryToken(UserAchievement));
    cosmeticsRepo = module.get(getRepositoryToken(UserCosmetic));
    gameStatsRepo = module.get(getRepositoryToken(UserGameStats));
    usersRepo = module.get(getRepositoryToken(User));
  });

  it('unlocks first match milestone only once', async () => {
    const user = makeUser({ profile: makeProfile({ gamesPlayed: 1 }) });

    const firstPass = await service.evaluateForUser(user);
    expect(firstPass.some((achievement) => achievement.id === 'matches-1-played')).toBe(true);

    repo.find.mockResolvedValueOnce(firstPass.map((achievement) => makeRecord(user, achievement.id)));
    const secondPass = await service.evaluateForUser(user);

    expect(secondPass).toEqual([]);
  });

  it('unlocks ten-match milestone when gamesPlayed reaches ten', async () => {
    const user = makeUser({ profile: makeProfile({ gamesPlayed: 10 }) });

    const unlocked = await service.evaluateForUser(user);

    expect(unlocked.some((achievement) => achievement.id === 'matches-10-played')).toBe(true);
    expect(cosmeticsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ cosmeticId: 'bamboo' }));
  });

  it('unlocks dragon shell at fifty matches', async () => {
    const user = makeUser({ profile: makeProfile({ gamesPlayed: 50 }) });

    const unlocked = await service.evaluateForUser(user);

    expect(unlocked.some((achievement) => achievement.id === 'matches-50-played')).toBe(true);
    expect(cosmeticsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ cosmeticId: 'dragon' }));
  });

  it('unlocks per-game achievements from game stats context', async () => {
    const user = makeUser({ profile: makeProfile({ gamesPlayed: 1 }) });
    gameStatsRepo.find.mockResolvedValueOnce([{ user, gameId: 'kame-knock', gamesPlayed: 1, totalWins: 0, totalLosses: 0 }]);

    const unlocked = await service.evaluateForUser(user);

    expect(unlocked.some((achievement) => achievement.id === 'kame-knock-1-played')).toBe(true);
  });

  it('lists per-game played milestones for each playable mode', async () => {
    const user = makeUser();

    const achievements = await service.listForUser(user);
    const expectedModes = ['kame-knock', 'bamboo-bash', 'bell-clash', 'temple-curling'];
    const expectedTargets = [1, 5, 10, 25, 50];

    for (const mode of expectedModes) {
      for (const target of expectedTargets) {
        expect(achievements.some((achievement) => achievement.id === `${mode}-${target}-played`)).toBe(true);
      }
    }
  });

  it('lists general match, level, and dojo coin milestones', async () => {
    const user = makeUser();

    const achievements = await service.listForUser(user);
    const progressTargets = [1, 5, 10, 25, 50];
    const levelTargets = [2, 5, 10, 25, 50];
    const coinTargets = [1, 50, 100, 250, 500];

    for (const target of progressTargets) {
      expect(achievements.some((achievement) => achievement.id === `matches-${target}-played`)).toBe(true);
    }

    for (const target of levelTargets) {
      expect(achievements.some((achievement) => achievement.id === `level-${target}-reached`)).toBe(true);
    }

    for (const target of coinTargets) {
      expect(achievements.some((achievement) => achievement.id === `dojo-coins-${target}-earned`)).toBe(true);
    }
  });

  it('grants coin rewards once when an achievement unlocks', async () => {
    const user = makeUser({ coins: 10, profile: makeProfile({ totalCoinsEarned: 1 }) });

    const unlocked = await service.evaluateForUser(user);

    expect(unlocked.some((achievement) => achievement.id === 'dojo-coins-1-earned')).toBe(true);
    expect(user.coins).toBe(35);
    expect(usersRepo.save).toHaveBeenCalledWith(expect.objectContaining({ coins: 35 }));
  });

  it('lists the full catalog with locked and unlocked state', async () => {
    const user = makeUser();
    repo.find.mockResolvedValueOnce([makeRecord(user, 'matches-1-played')]);

    const achievements = await service.listForUser(user);

    expect(achievements.length).toBeGreaterThan(1);
    expect(achievements.find((achievement) => achievement.id === 'matches-1-played')?.unlocked).toBe(true);
    expect(achievements.find((achievement) => achievement.id === 'matches-50-played')?.unlocked).toBe(false);
  });

  it('includes backend progress values in achievement views', async () => {
    const user = makeUser({ profile: makeProfile({ gamesPlayed: 4, totalWins: 0 }) });

    const achievements = await service.listForUser(user);

    expect(achievements.find((achievement) => achievement.id === 'matches-5-played')).toEqual(
      expect.objectContaining({ progressCurrent: 4, progressTarget: 5 }),
    );
  });

  it('does not duplicate achievements or cosmetic rewards on duplicate evaluation', async () => {
    const user = makeUser({ profile: makeProfile({ gamesPlayed: 1, totalWins: 1 }) });

    const firstPass = await service.evaluateForUser(user);
    repo.find.mockResolvedValueOnce(firstPass.map((achievement) => makeRecord(user, achievement.id)));
    const secondPass = await service.evaluateForUser(user);

    expect(secondPass).toEqual([]);
    expect(cosmeticsRepo.save).not.toHaveBeenCalled();
  });

  it('does not duplicate coin rewards when already unlocked', async () => {
    const user = makeUser({ coins: 10, profile: makeProfile({ totalCoinsEarned: 1 }) });
    repo.find.mockResolvedValueOnce([
      makeRecord(user, 'dojo-coins-1-earned'),
      makeRecord(user, 'matches-1-played'),
    ]);

    const unlocked = await service.evaluateForUser(user);

    expect(unlocked).toEqual([]);
    expect(user.coins).toBe(10);
    expect(usersRepo.save).not.toHaveBeenCalled();
  });

  it('ignores duplicate cosmetic reward rows safely', async () => {
    cosmeticsRepo.save.mockRejectedValueOnce({ code: '23505' });
    const user = makeUser({ profile: makeProfile({ gamesPlayed: 50, totalWins: 1 }) });

    const unlocked = await service.evaluateForUser(user);

    expect(unlocked.some((achievement) => achievement.id === 'matches-50-played')).toBe(true);
  });
});
