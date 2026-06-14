import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AchievementsService } from './achievements.service';
import { UserAchievement } from './entities/user-achievement.entity';
import { User } from '../users/entities/user.entity';
import { Profile } from '../profiles/entities/profile.entity';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  const profile = new Profile();
  profile.totalWins = overrides.totalWins ?? 0;
  profile.totalLosses = overrides.totalLosses ?? 0;
  profile.gamesPlayed = overrides.gamesPlayed ?? 0;
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementsService,
        { provide: getRepositoryToken(UserAchievement), useValue: mockRepo },
      ],
    }).compile();

    service = module.get(AchievementsService);
    repo = module.get(getRepositoryToken(UserAchievement));
  });

  it('unlocks first match only once', async () => {
    const user = makeUser({ profile: makeProfile({ gamesPlayed: 1 }) });

    const firstPass = await service.evaluateForUser(user);
    expect(firstPass.some((achievement) => achievement.id === 'first-match')).toBe(true);

    repo.find.mockResolvedValueOnce(firstPass.map((achievement) => makeRecord(user, achievement.id)));
    const secondPass = await service.evaluateForUser(user);

    expect(secondPass).toEqual([]);
  });

  it('unlocks first win when totalWins reaches one', async () => {
    const user = makeUser({ profile: makeProfile({ gamesPlayed: 1, totalWins: 1 }) });

    const unlocked = await service.evaluateForUser(user);

    expect(unlocked.some((achievement) => achievement.id === 'first-win')).toBe(true);
  });

  it('unlocks dojo regular when gamesPlayed reaches ten', async () => {
    const user = makeUser({ profile: makeProfile({ gamesPlayed: 10 }) });

    const unlocked = await service.evaluateForUser(user);

    expect(unlocked.some((achievement) => achievement.id === 'dojo-regular')).toBe(true);
  });

  it('lists the full catalog with locked and unlocked state', async () => {
    const user = makeUser();
    repo.find.mockResolvedValueOnce([makeRecord(user, 'first-match')]);

    const achievements = await service.listForUser(user);

    expect(achievements.length).toBeGreaterThan(1);
    expect(achievements.find((achievement) => achievement.id === 'first-match')?.unlocked).toBe(true);
    expect(achievements.find((achievement) => achievement.id === 'first-win')?.unlocked).toBe(false);
  });
});
