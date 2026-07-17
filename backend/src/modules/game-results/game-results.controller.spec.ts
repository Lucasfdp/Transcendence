import { HttpException, UnauthorizedException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { User } from "../users/entities/user.entity";
import { UsersService } from "../users/users.service";
import { GameResultsController } from "./game-results.controller";
import { GameResultsService, ProgressionResult } from "./game-results.service";

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.isGuest = overrides.isGuest ?? false;
	return user;
}

const sampleResult: ProgressionResult = {
	xpGained: 10,
	coinsGained: 5,
	newXp: 10,
	newLevel: 1,
	newCoins: 5,
	leveledUp: false,
	unlockedAchievements: [],
	cardDrop: null,
};

const req = { user: { id: 1 } };

describe("GameResultsController", () => {
	let controller: GameResultsController;
	let gameResultsService: { submitResult: jest.Mock };
	let usersService: { findById: jest.Mock };
	let rateLimiter: { allowKey: jest.Mock };

	beforeEach(async () => {
		gameResultsService = {
			submitResult: jest.fn().mockResolvedValue(sampleResult),
		};
		usersService = { findById: jest.fn().mockResolvedValue(makeUser()) };
		rateLimiter = { allowKey: jest.fn().mockReturnValue(true) };

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				GameResultsController,
				{ provide: GameResultsService, useValue: gameResultsService },
				{ provide: UsersService, useValue: usersService },
				{ provide: RateLimiterService, useValue: rateLimiter },
			],
		}).compile();

		controller = module.get(GameResultsController);
	});

	// ── Happy path ─────────────────────────────────────────────────────────────

	it("should record the result and return the progression delta", async () => {
		const result = await controller.submitResult(req, {
			gameId: "kame-knock",
			outcome: "completed",
		});

		expect(gameResultsService.submitResult).toHaveBeenCalledWith(
			expect.any(User),
			{ gameId: "kame-knock", outcome: "completed" },
		);
		expect(result).toEqual(sampleResult);
	});

	// ── Auth / guest handling ─────────────────────────────────────────────────

	it("should throw UnauthorizedException when the user is missing", async () => {
		usersService.findById.mockResolvedValue(null);

		await expect(
			controller.submitResult(req, {
				gameId: "kame-knock",
				outcome: "completed",
			}),
		).rejects.toBeInstanceOf(UnauthorizedException);
		expect(gameResultsService.submitResult).not.toHaveBeenCalled();
	});

	it("should return a zero-delta response for guests without writing to the DB", async () => {
		usersService.findById.mockResolvedValue(makeUser({ isGuest: true }));

		const result = await controller.submitResult(req, {
			gameId: "kame-knock",
			outcome: "completed",
		});

		expect(result).toEqual({
			xpGained: 0,
			coinsGained: 0,
			newXp: 0,
			newLevel: 1,
			newCoins: 0,
			leveledUp: false,
			unlockedAchievements: [],
			cardDrop: null,
		});
		expect(gameResultsService.submitResult).not.toHaveBeenCalled();
		expect(rateLimiter.allowKey).not.toHaveBeenCalled();
	});

	// ── Rankings Bug Audit H2: per-user rate limit ────────────────────────────

	it("should rate-limit per authenticated user", async () => {
		await controller.submitResult(req, {
			gameId: "kame-knock",
			outcome: "completed",
		});

		expect(rateLimiter.allowKey).toHaveBeenCalledWith(
			"game-result",
			"1",
			20,
			60_000,
		);
	});

	it("should throw a 429 HttpException when the rate limit is exceeded", async () => {
		rateLimiter.allowKey.mockReturnValue(false);

		const promise = controller.submitResult(req, {
			gameId: "kame-knock",
			outcome: "completed",
		});

		await expect(promise).rejects.toBeInstanceOf(HttpException);
		await expect(promise).rejects.toMatchObject({ status: 429 });
		expect(gameResultsService.submitResult).not.toHaveBeenCalled();
	});
});
