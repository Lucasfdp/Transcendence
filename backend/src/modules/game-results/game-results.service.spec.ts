import { Test, TestingModule } from "@nestjs/testing";
import { InternalServerErrorException } from "@nestjs/common";
import { GameResultsService } from "./game-results.service";
import { UsersService } from "../users/users.service";
import { AchievementsService } from "../achievements/achievements.service";
import { CardsService } from "../cards/cards.service";
import { PackPull } from "../cards/cards.constants";
import { User } from "../users/entities/user.entity";
import { Profile } from "../profiles/entities/profile.entity";
import { getRepositoryToken } from "@nestjs/typeorm";
import { UserGameStats } from "./entities/user-game-stats.entity";
import {
	COINS_PER_COMPLETED,
	COINS_PER_DRAW,
	COINS_PER_LOSS,
	COINS_PER_WIN,
	XP_PER_COMPLETED,
	XP_PER_DRAW,
	XP_PER_WIN,
	XP_PER_LOSS,
	xpForNextLevel,
} from "./progression.constants";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<Profile> = {}): Profile {
	const profile = new Profile();
	profile.id = 1;
	profile.totalWins = overrides.totalWins ?? 0;
	profile.totalLosses = overrides.totalLosses ?? 0;
	profile.gamesPlayed = overrides.gamesPlayed ?? 0;
	profile.totalCoinsEarned = overrides.totalCoinsEarned ?? 0;
	profile.tag = overrides.tag ?? null;
	profile.showcasedAchievements = overrides.showcasedAchievements ?? null;
	return profile;
}

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.level = overrides.level ?? 1;
	user.xp = overrides.xp ?? 0;
	user.coins = overrides.coins ?? 0;
	user.isGuest = overrides.isGuest ?? false;
	user.isDevAccount = overrides.isDevAccount ?? false;
	user.profile = overrides.profile ?? makeProfile();
	return user;
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe("GameResultsService", () => {
	let service: GameResultsService;
	let usersService: jest.Mocked<UsersService>;
	let achievementsService: jest.Mocked<AchievementsService>;
	let cardsService: jest.Mocked<Pick<CardsService, "grantMatchDrop">>;
	let gameStatsRepo: {
		findOne: jest.Mock;
		create: jest.Mock;
		save: jest.Mock;
	};

	const sampleDrop: PackPull = {
		card: {
			id: "power-heavy",
			family: "power_shell",
			rarity: "stone",
			name: "Heavy Shell",
			flavor: "Dense as a temple stone.",
			sourceRef: "heavy",
		},
		foil: false,
		isNew: true,
	};

	beforeEach(async () => {
		const mockUsersService: Partial<jest.Mocked<UsersService>> = {
			save: jest.fn(),
		};
		const mockAchievementsService: Partial<
			jest.Mocked<AchievementsService>
		> = {
			evaluateForUser: jest.fn().mockResolvedValue([]),
		};
		const mockGameStatsRepo = {
			findOne: jest.fn().mockResolvedValue(null),
			create: jest.fn(
				(data: Partial<UserGameStats>) =>
					({ ...data }) as UserGameStats,
			),
			save: jest.fn(async (stats: UserGameStats) => stats),
		};
		const mockCardsService: jest.Mocked<
			Pick<CardsService, "grantMatchDrop">
		> = {
			grantMatchDrop: jest.fn().mockResolvedValue(sampleDrop),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				GameResultsService,
				{ provide: UsersService, useValue: mockUsersService },
				{
					provide: AchievementsService,
					useValue: mockAchievementsService,
				},
				{ provide: CardsService, useValue: mockCardsService },
				{
					provide: getRepositoryToken(UserGameStats),
					useValue: mockGameStatsRepo,
				},
			],
		}).compile();

		service = module.get<GameResultsService>(GameResultsService);
		usersService = module.get(UsersService);
		achievementsService = module.get(AchievementsService);
		cardsService = module.get(CardsService);
		gameStatsRepo = module.get(getRepositoryToken(UserGameStats));
	});

	// ── Happy paths ─────────────────────────────────────────────────────────────

	it("should award XP and coins on win, increment totalWins and gamesPlayed", async () => {
		const user = makeUser({ xp: 0, coins: 0 });
		usersService.save.mockResolvedValueOnce(user);

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "win",
		});

		expect(result.xpGained).toBe(XP_PER_WIN);
		expect(result.coinsGained).toBe(COINS_PER_WIN);
		expect(result.newXp).toBe(XP_PER_WIN);
		expect(result.newCoins).toBe(COINS_PER_WIN);
		expect(user.profile.totalWins).toBe(1);
		expect(user.profile.totalLosses).toBe(0);
		expect(user.profile.gamesPlayed).toBe(1);
		expect(user.profile.totalCoinsEarned).toBe(COINS_PER_WIN);
		expect(usersService.save).toHaveBeenCalledWith(user);
		expect(achievementsService.evaluateForUser).toHaveBeenCalledWith(user);
		expect(result.unlockedAchievements).toEqual([]);
	});

	it("should award loss rewards and increment totalLosses and gamesPlayed", async () => {
		const user = makeUser({ xp: 0, coins: 0 });
		usersService.save.mockResolvedValueOnce(user);

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "loss",
		});

		expect(result.xpGained).toBe(XP_PER_LOSS);
		expect(result.coinsGained).toBe(COINS_PER_LOSS);
		expect(result.newXp).toBe(XP_PER_LOSS);
		expect(result.newCoins).toBe(COINS_PER_LOSS);
		expect(user.profile.totalWins).toBe(0);
		expect(user.profile.totalLosses).toBe(1);
		expect(user.profile.gamesPlayed).toBe(1);
		expect(user.profile.totalCoinsEarned).toBe(COINS_PER_LOSS);
	});

	it("should award completed rewards without incrementing wins or losses", async () => {
		const user = makeUser({ xp: 0, coins: 0 });
		usersService.save.mockResolvedValueOnce(user);

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "completed",
		});

		expect(result.xpGained).toBe(XP_PER_COMPLETED);
		expect(result.coinsGained).toBe(COINS_PER_COMPLETED);
		expect(result.newXp).toBe(XP_PER_COMPLETED);
		expect(result.newCoins).toBe(COINS_PER_COMPLETED);
		expect(user.profile.totalWins).toBe(0);
		expect(user.profile.totalLosses).toBe(0);
		expect(user.profile.gamesPlayed).toBe(1);
		expect(user.profile.totalCoinsEarned).toBe(COINS_PER_COMPLETED);
		expect(gameStatsRepo.save).toHaveBeenCalledWith(
			expect.objectContaining({
				gamesPlayed: 1,
				totalWins: 0,
				totalLosses: 0,
			}),
		);
	});

	it("should award draw rewards without incrementing wins or losses", async () => {
		const user = makeUser({ xp: 0, coins: 0 });
		usersService.save.mockResolvedValueOnce(user);

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "draw",
		});

		expect(result.xpGained).toBe(XP_PER_DRAW);
		expect(result.coinsGained).toBe(COINS_PER_DRAW);
		expect(result.newXp).toBe(XP_PER_DRAW);
		expect(result.newCoins).toBe(COINS_PER_DRAW);
		expect(user.profile.totalWins).toBe(0);
		expect(user.profile.totalLosses).toBe(0);
		expect(user.profile.gamesPlayed).toBe(1);
		expect(user.profile.totalCoinsEarned).toBe(COINS_PER_DRAW);
		expect(gameStatsRepo.save).toHaveBeenCalledWith(
			expect.objectContaining({
				gamesPlayed: 1,
				totalWins: 0,
				totalLosses: 0,
			}),
		);
	});

	it("should create per-game stats when none exist", async () => {
		const user = makeUser();
		usersService.save.mockResolvedValueOnce(user);

		await service.submitResult(user, {
			gameId: "kame-knock",
			outcome: "win",
		});

		expect(gameStatsRepo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				user,
				gameId: "kame-knock",
				gamesPlayed: 0,
				totalWins: 0,
				totalLosses: 0,
			}),
		);
		expect(gameStatsRepo.save).toHaveBeenCalledWith(
			expect.objectContaining({
				gameId: "kame-knock",
				gamesPlayed: 1,
				totalWins: 1,
				totalLosses: 0,
			}),
		);
	});

	it("should update existing per-game stats", async () => {
		const user = makeUser();
		const stats = Object.assign(new UserGameStats(), {
			user,
			gameId: "temple-curling",
			gamesPlayed: 4,
			totalWins: 2,
			totalLosses: 2,
		});
		gameStatsRepo.findOne.mockResolvedValueOnce(stats);
		usersService.save.mockResolvedValueOnce(user);

		await service.submitResult(user, {
			gameId: "temple-curling",
			outcome: "loss",
		});

		expect(gameStatsRepo.save).toHaveBeenCalledWith(
			expect.objectContaining({
				gameId: "temple-curling",
				gamesPlayed: 5,
				totalWins: 2,
				totalLosses: 3,
			}),
		);
	});

	// ── Level-up ────────────────────────────────────────────────────────────────

	it("should level up when XP crosses the threshold", async () => {
		// Level 1 threshold is 1 000 XP. Start at 900 — a win (150 XP) pushes past it.
		const user = makeUser({ level: 1, xp: 900 });
		usersService.save.mockResolvedValueOnce(user);

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "win",
		});

		expect(result.leveledUp).toBe(true);
		expect(result.newLevel).toBe(2);
		// Carried-over XP: 900 + 150 − 1000 = 50
		expect(result.newXp).toBe(50);
	});

	it("should handle multiple level-ups in a single call", async () => {
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

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "win",
		});

		expect(result.leveledUp).toBe(true);
		expect(result.newLevel).toBe(3);
		expect(result.newXp).toBe(100);
	});

	it("should carry over excess XP correctly after levelling up", async () => {
		// Level 2 threshold = 2000. Start at level 2, xp = 1990.
		// Win adds 150 → 2140. 2140 >= 2000 → level 3, remainder = 140.
		const user = makeUser({ level: 2, xp: 1_990 });
		usersService.save.mockResolvedValueOnce(user);

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "win",
		});

		expect(result.leveledUp).toBe(true);
		expect(result.newLevel).toBe(3);
		expect(result.newXp).toBe(1_990 + XP_PER_WIN - xpForNextLevel(2));
	});

	it("should not level up when XP does not reach the threshold", async () => {
		const user = makeUser({ level: 1, xp: 0 });
		usersService.save.mockResolvedValueOnce(user);

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "win",
		});

		expect(result.leveledUp).toBe(false);
		expect(result.newLevel).toBe(1);
		expect(result.newXp).toBe(XP_PER_WIN);
	});

	// ── Error handling ──────────────────────────────────────────────────────────

	it("should throw InternalServerErrorException when usersService.save fails", async () => {
		const user = makeUser();
		usersService.save.mockRejectedValueOnce(
			new Error("DB connection lost"),
		);

		await expect(
			service.submitResult(user, { gameId: "test-game", outcome: "win" }),
		).rejects.toThrow(InternalServerErrorException);
	});

	it("should propagate InternalServerErrorException from usersService.save as-is", async () => {
		const user = makeUser();
		const original = new InternalServerErrorException("upstream failure");
		usersService.save.mockRejectedValueOnce(original);

		await expect(
			service.submitResult(user, { gameId: "test-game", outcome: "win" }),
		).rejects.toThrow(InternalServerErrorException);
	});

	it("should return newly unlocked achievements from achievement evaluation", async () => {
		const user = makeUser();
		const unlocked = [
			{
				id: "first-match",
				title: "First Match",
				description: "Complete your first match in the dojo.",
				unlockDescription: "You completed your first match.",
				rewardLabel: "Progress record unlocked",
				reward: {
					type: "none" as const,
					label: "Progress record unlocked",
				},
				progressCurrent: 1,
				progressTarget: 1,
				unlocked: true,
				unlockedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
			},
		];
		usersService.save.mockResolvedValueOnce(user);
		achievementsService.evaluateForUser.mockResolvedValueOnce(unlocked);

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "win",
		});

		expect(result.unlockedAchievements).toEqual(unlocked);
	});

	// ── Match-completion card drop ───────────────────────────────────────────────

	it("should include the cosmetic card drop in the result", async () => {
		const user = makeUser();
		usersService.save.mockResolvedValueOnce(user);

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "win",
		});

		expect(cardsService.grantMatchDrop).toHaveBeenCalledWith(user);
		expect(result.cardDrop).toEqual(sampleDrop);
	});

	it("should still record the match with a null drop when the card grant fails", async () => {
		const user = makeUser();
		usersService.save.mockResolvedValueOnce(user);
		cardsService.grantMatchDrop.mockRejectedValueOnce(
			new Error("card grant failed"),
		);

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "win",
		});

		expect(result.cardDrop).toBeNull();
		expect(result.coinsGained).toBe(COINS_PER_WIN);
		expect(usersService.save).toHaveBeenCalledWith(user);
	});

	// ── Accumulation ────────────────────────────────────────────────────────────

	it("should accumulate coins across multiple calls", async () => {
		const user = makeUser({ coins: 100 });
		usersService.save.mockResolvedValue(user);

		await service.submitResult(user, {
			gameId: "test-game",
			outcome: "win",
		});
		expect(user.coins).toBe(100 + COINS_PER_WIN);

		await service.submitResult(user, {
			gameId: "test-game",
			outcome: "loss",
		});
		expect(user.coins).toBe(100 + COINS_PER_WIN + COINS_PER_LOSS);
	});

	it("should accumulate gamesPlayed correctly for mixed outcomes", async () => {
		const user = makeUser();
		usersService.save.mockResolvedValue(user);

		await service.submitResult(user, { gameId: "g", outcome: "win" });
		await service.submitResult(user, { gameId: "g", outcome: "loss" });
		await service.submitResult(user, { gameId: "g", outcome: "draw" });
		await service.submitResult(user, { gameId: "g", outcome: "win" });

		expect(user.profile.gamesPlayed).toBe(4);
		expect(user.profile.totalWins).toBe(2);
		expect(user.profile.totalLosses).toBe(1);
	});

	// ── Bug Audit M4: achievement coin rewards reflected in the response ────────

	it("should include a coins-reward achievement's bonus in newCoins", async () => {
		const user = makeUser({ coins: 100 });
		usersService.save.mockResolvedValueOnce(user);
		// Simulate AchievementsService.applyReward: it mutates the *same* user
		// object reference and persists it internally, independent of
		// GameResultsService's own save.
		achievementsService.evaluateForUser.mockImplementationOnce(async (u) => {
			u.coins += 500;
			return [];
		});

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "win",
		});

		// Pre-fix, this would have been `100 + COINS_PER_WIN` (stale — missing
		// the achievement's +500), even though `user.coins` itself was correct.
		expect(result.newCoins).toBe(100 + COINS_PER_WIN + 500);
		expect(user.coins).toBe(result.newCoins);
	});

	it("should return the plain match-reward balance when no achievement unlocks a coin reward", async () => {
		const user = makeUser({ coins: 100 });
		usersService.save.mockResolvedValueOnce(user);

		const result = await service.submitResult(user, {
			gameId: "test-game",
			outcome: "win",
		});

		expect(result.newCoins).toBe(100 + COINS_PER_WIN);
	});

	// ── Bug Audit L4: missing profile guard ─────────────────────────────────────

	it("should throw a clear InternalServerErrorException when user.profile is missing", async () => {
		// `makeUser`'s `??` fallback means passing `profile: null` in overrides
		// doesn't stick — set it directly on the built user instead.
		const user = makeUser();
		user.profile = null as unknown as Profile;

		await expect(
			service.submitResult(user, { gameId: "test-game", outcome: "win" }),
		).rejects.toThrow(InternalServerErrorException);
		expect(usersService.save).not.toHaveBeenCalled();
	});
});
