import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { GameResultsService } from './game-results.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { Profile } from '../profiles/entities/profile.entity';
import {
  COINS_PER_WIN, COINS_PER_LOSS,
  XP_PER_WIN, XP_PER_LOSS,
  xpForNextLevel,
} from './progression.constants';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  const profile = new Profile();
  profile.id           = 1;
  profile.totalWins    = overrides.totalWins    ?? 0;
  profile.totalLosses  = overrides.totalLosses  ?? 0;
  profile.gamesPlayed  = overrides.gamesPlayed  ?? 0;
  profile.bio          = overrides.bio          ?? null;
  return profile;
}

function makeUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id           = overrides.id           ?? 1;
  user.username     = overrides.username     ?? 'TestTurtle';
  user.level        = overrides.level        ?? 1;
  user.xp           = overrides.xp           ?? 0;
  user.coins        = overrides.coins        ?? 0;
  user.isGuest      = overrides.isGuest      ?? false;
  user.isDevAccount = overrides.isDevAccount ?? false;
  user.profile      = overrides.profile      ?? makeProfile();
  return user;
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('GameResultsService', () => {
  let service: GameResultsService;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const mockUsersService: Partial<jest.Mocked<UsersService>> = {
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameResultsService,
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service      = module.get<GameResultsService>(GameResultsService);
    usersService = module.get(UsersService);
  });

  // ── Happy paths ─────────────────────────────────────────────────────────────

  it('should award XP and coins on win, increment totalWins and gamesPlayed', async () => {
    const user = makeUser({ xp: 0, coins: 0 });
    usersService.save.mockResolvedValueOnce(user);

    const result = await service.submitResult(user, { gameId: 'test-game', outcome: 'win' });

    expect(result.xpGained).toBe(XP_PER_WIN);
    expect(result.coinsGained).toBe(COINS_PER_WIN);
    expect(result.newXp).toBe(XP_PER_WIN);
    expect(result.newCoins).toBe(COINS_PER_WIN);
    expect(user.profile.totalWins).toBe(1);
    expect(user.profile.totalLosses).toBe(0);
    expect(user.profile.gamesPlayed).toBe(1);
    expect(usersService.save).toHaveBeenCalledWith(user);
  });

  it('should award reduced XP on loss, no coins, increment totalLosses and gamesPlayed', async () => {
    const user = makeUser({ xp: 0, coins: 0 });
    usersService.save.mockResolvedValueOnce(user);

    const result = await service.submitResult(user, { gameId: 'test-game', outcome: 'loss' });

    expect(result.xpGained).toBe(XP_PER_LOSS);
    expect(result.coinsGained).toBe(COINS_PER_LOSS);
    expect(result.newXp).toBe(XP_PER_LOSS);
    expect(result.newCoins).toBe(0);
    expect(user.profile.totalWins).toBe(0);
    expect(user.profile.totalLosses).toBe(1);
    expect(user.profile.gamesPlayed).toBe(1);
  });

  // ── Level-up ────────────────────────────────────────────────────────────────

  it('should level up when XP crosses the threshold', async () => {
    // Level 1 threshold is 1 000 XP. Start at 900 — a win (150 XP) pushes past it.
    const user = makeUser({ level: 1, xp: 900 });
    usersService.save.mockResolvedValueOnce(user);

    const result = await service.submitResult(user, { gameId: 'test-game', outcome: 'win' });

    expect(result.leveledUp).toBe(true);
    expect(result.newLevel).toBe(2);
    // Carried-over XP: 900 + 150 − 1000 = 50
    expect(result.newXp).toBe(50);
  });

  it('should handle multiple level-ups in a single call', async () => {
    // Level 1 threshold: 1 000. Level 2 threshold: 2 000.
    // Starting at level 1 with 0 XP and awarding 3 500 XP should push to level 3.
    // 3500 >= 1000 → level 2, remainder 2500
    // 2500 >= 2000 → level 3, remainder 500
    const testXpGain = 3_500;
    // Override XP_PER_WIN for this test by supplying the right starting state.
    // We fake the internal award by starting the user with enough XP to ensure
    // multiple thresholds are crossed after a single win (+150 XP).
    // Actually, let's test the loop directly: start at level 1, 0 xp, and
    // manually test with a high xp start so the *result* of adding XP_PER_WIN
    // triggers two level-ups.
    //
    // Level 1 threshold = 1000. Level 2 threshold = 2000.
    // Start: level 1, xp = 990. Win adds 150 → 1140.
    // 1140 >= 1000 → level 2, remainder = 140. 140 < 2000 → stop.
    // Only 1 level-up in that case.
    //
    // For 2 level-ups: level 1, xp = 2950. Win adds 150 → 3100.
    // 3100 >= 1000 → level 2, remainder = 2100.
    // 2100 >= 2000 → level 3, remainder = 100. Stop.
    void testXpGain; // unused above — used for documentation
    const user = makeUser({ level: 1, xp: 2_950 });
    usersService.save.mockResolvedValueOnce(user);

    const result = await service.submitResult(user, { gameId: 'test-game', outcome: 'win' });

    expect(result.leveledUp).toBe(true);
    expect(result.newLevel).toBe(3);
    expect(result.newXp).toBe(100);
  });

  it('should carry over excess XP correctly after levelling up', async () => {
    // Level 2 threshold = 2000. Start at level 2, xp = 1990.
    // Win adds 150 → 2140. 2140 >= 2000 → level 3, remainder = 140.
    const user = makeUser({ level: 2, xp: 1_990 });
    usersService.save.mockResolvedValueOnce(user);

    const result = await service.submitResult(user, { gameId: 'test-game', outcome: 'win' });

    expect(result.leveledUp).toBe(true);
    expect(result.newLevel).toBe(3);
    expect(result.newXp).toBe(1_990 + XP_PER_WIN - xpForNextLevel(2));
  });

  it('should not level up when XP does not reach the threshold', async () => {
    const user = makeUser({ level: 1, xp: 0 });
    usersService.save.mockResolvedValueOnce(user);

    const result = await service.submitResult(user, { gameId: 'test-game', outcome: 'win' });

    expect(result.leveledUp).toBe(false);
    expect(result.newLevel).toBe(1);
    expect(result.newXp).toBe(XP_PER_WIN);
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  it('should throw InternalServerErrorException when usersService.save fails', async () => {
    const user = makeUser();
    usersService.save.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(
      service.submitResult(user, { gameId: 'test-game', outcome: 'win' }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('should propagate InternalServerErrorException from usersService.save as-is', async () => {
    const user = makeUser();
    const original = new InternalServerErrorException('upstream failure');
    usersService.save.mockRejectedValueOnce(original);

    await expect(
      service.submitResult(user, { gameId: 'test-game', outcome: 'win' }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  // ── Accumulation ────────────────────────────────────────────────────────────

  it('should accumulate coins across multiple calls', async () => {
    const user = makeUser({ coins: 100 });
    usersService.save.mockResolvedValue(user);

    await service.submitResult(user, { gameId: 'test-game', outcome: 'win' });
    expect(user.coins).toBe(100 + COINS_PER_WIN);

    await service.submitResult(user, { gameId: 'test-game', outcome: 'loss' });
    expect(user.coins).toBe(100 + COINS_PER_WIN + COINS_PER_LOSS);
  });

  it('should accumulate gamesPlayed correctly for mixed outcomes', async () => {
    const user = makeUser();
    usersService.save.mockResolvedValue(user);

    await service.submitResult(user, { gameId: 'g', outcome: 'win' });
    await service.submitResult(user, { gameId: 'g', outcome: 'loss' });
    await service.submitResult(user, { gameId: 'g', outcome: 'win' });

    expect(user.profile.gamesPlayed).toBe(3);
    expect(user.profile.totalWins).toBe(2);
    expect(user.profile.totalLosses).toBe(1);
  });
});
