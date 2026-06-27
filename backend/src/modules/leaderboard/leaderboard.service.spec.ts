import { InternalServerErrorException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { UserGameStats } from "../game-results/entities/user-game-stats.entity";
import { FriendsService } from "../friends/friends.service";
import { UserRating } from "../matchmaking/entities/user-rating.entity";
import { LeaderboardService } from "./leaderboard.service";

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

const createQbMock = (rawRows: Record<string, unknown>[]) => ({
	innerJoin: jest.fn().mockReturnThis(),
	select: jest.fn().mockReturnThis(),
	where: jest.fn().mockReturnThis(),
	andWhere: jest.fn().mockReturnThis(),
	groupBy: jest.fn().mockReturnThis(),
	addGroupBy: jest.fn().mockReturnThis(),
	orderBy: jest.fn().mockReturnThis(),
	limit: jest.fn().mockReturnThis(),
	getRawMany: jest.fn().mockResolvedValue(rawRows),
});

const mockUserRatingRepo = (rows: Record<string, unknown>[] = []) => ({
	createQueryBuilder: jest.fn(() => createQbMock(rows)),
});

const mockUserGameStatsRepo = (rows: Record<string, unknown>[] = []) => ({
	createQueryBuilder: jest.fn(() => createQbMock(rows)),
});

const mockFriendsService = () => ({
	getFriendIds: jest.fn().mockResolvedValue([]),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rawRatingRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
	userId: "10",
	username: "kame",
	turtleName: "KameMaster",
	avatar: null,
	level: "5",
	rating: "1200",
	wins: "8",
	losses: "2",
	draws: "1",
	...overrides,
});

const rawStatsRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
	userId: "10",
	username: "kame",
	turtleName: "KameMaster",
	avatar: null,
	level: "5",
	totalWins: "15",
	...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LeaderboardService", () => {
	let service: LeaderboardService;
	let friendsService: ReturnType<typeof mockFriendsService>;
	let userRatingRepo: ReturnType<typeof mockUserRatingRepo>;
	let userGameStatsRepo: ReturnType<typeof mockUserGameStatsRepo>;

	const buildModule = async (
		ratingRows: Record<string, unknown>[] = [],
		statsRows: Record<string, unknown>[] = [],
	) => {
		userRatingRepo = mockUserRatingRepo(ratingRows);
		userGameStatsRepo = mockUserGameStatsRepo(statsRows);
		friendsService = mockFriendsService();

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				LeaderboardService,
				{
					provide: getRepositoryToken(UserRating),
					useValue: userRatingRepo,
				},
				{
					provide: getRepositoryToken(UserGameStats),
					useValue: userGameStatsRepo,
				},
				{ provide: FriendsService, useValue: friendsService },
			],
		}).compile();

		service = module.get(LeaderboardService);
	};

	// ── getGameLeaderboard ───────────────────────────────────────────────────

	describe("getGameLeaderboard", () => {
		it("should return ranked entries with correct field types for global scope", async () => {
			await buildModule([rawRatingRow()]);

			const result = await service.getGameLeaderboard(1, "shell-curl", "global");

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				rank: 1,
				userId: 10,
				username: "kame",
				turtleName: "KameMaster",
				avatar: null,
				level: 5,
				rating: 1200,
				wins: 8,
				losses: 2,
				draws: 1,
			});
		});

		it("should assign rank sequentially when multiple entries returned", async () => {
			await buildModule([
				rawRatingRow({ userId: "10", rating: "1500" }),
				rawRatingRow({ userId: "20", rating: "1300", username: "shell2" }),
				rawRatingRow({ userId: "30", rating: "1100", username: "shell3" }),
			]);

			const result = await service.getGameLeaderboard(1, "shell-curl", "global");

			expect(result.map((e) => e.rank)).toEqual([1, 2, 3]);
		});

		it("should apply andWhere with allowedIds when scope is friends", async () => {
			friendsService = mockFriendsService();
			(friendsService.getFriendIds as jest.Mock).mockResolvedValue([20, 30]);

			await buildModule([rawRatingRow()]);
			// Re-inject friendsService with the overridden mock
			const module: TestingModule = await Test.createTestingModule({
				providers: [
					LeaderboardService,
					{
						provide: getRepositoryToken(UserRating),
						useValue: mockUserRatingRepo([rawRatingRow()]),
					},
					{
						provide: getRepositoryToken(UserGameStats),
						useValue: mockUserGameStatsRepo([]),
					},
					{ provide: FriendsService, useValue: friendsService },
				],
			}).compile();

			service = module.get(LeaderboardService);
			const result = await service.getGameLeaderboard(1, "shell-curl", "friends");

			expect(friendsService.getFriendIds).toHaveBeenCalledWith(1);
			expect(result).toHaveLength(1);
		});

		it("should return empty array when no ratings exist for the game", async () => {
			await buildModule([]);

			const result = await service.getGameLeaderboard(1, "unknown-game", "global");

			expect(result).toEqual([]);
		});

		it("should throw InternalServerErrorException when the repository throws", async () => {
			await buildModule();
			const qb = createQbMock([]);
			(qb.getRawMany as jest.Mock).mockRejectedValue(new Error("DB down"));
			userRatingRepo.createQueryBuilder.mockReturnValue(qb);

			await expect(
				service.getGameLeaderboard(1, "shell-curl", "global"),
			).rejects.toThrow(InternalServerErrorException);
		});
	});

	// ── getOverallLeaderboard ────────────────────────────────────────────────

	describe("getOverallLeaderboard", () => {
		it("should return ranked entries with totalWins aggregated", async () => {
			await buildModule([], [rawStatsRow()]);

			const result = await service.getOverallLeaderboard(1, "global");

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				rank: 1,
				userId: 10,
				username: "kame",
				turtleName: "KameMaster",
				avatar: null,
				level: 5,
				totalWins: 15,
			});
		});

		it("should include caller in allowedIds even when they have no friends", async () => {
			(friendsService.getFriendIds as jest.Mock).mockResolvedValue([]);
			await buildModule([], [rawStatsRow()]);

			const qbSpy = jest.fn(() => createQbMock([rawStatsRow()]));
			userGameStatsRepo.createQueryBuilder = qbSpy;

			await service.getOverallLeaderboard(99, "friends");

			expect(friendsService.getFriendIds).toHaveBeenCalledWith(99);
		});

		it("should return empty array when no stats rows exist", async () => {
			await buildModule([], []);

			const result = await service.getOverallLeaderboard(1, "global");

			expect(result).toEqual([]);
		});

		it("should throw InternalServerErrorException when the repository throws", async () => {
			await buildModule([], []);
			const qb = createQbMock([]);
			(qb.getRawMany as jest.Mock).mockRejectedValue(new Error("DB error"));
			userGameStatsRepo.createQueryBuilder.mockReturnValue(qb);

			await expect(
				service.getOverallLeaderboard(1, "global"),
			).rejects.toThrow(InternalServerErrorException);
		});
	});
});
