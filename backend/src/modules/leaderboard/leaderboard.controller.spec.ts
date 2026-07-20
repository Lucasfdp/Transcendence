import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { LeaderboardController } from "./leaderboard.controller";
import { LeaderboardService } from "./leaderboard.service";

const req = { user: { id: 1 } };

describe("LeaderboardController", () => {
	let controller: LeaderboardController;
	let leaderboardService: {
		getGameLeaderboard: jest.Mock;
		getOverallLeaderboard: jest.Mock;
		getTournamentLeaderboard: jest.Mock;
	};

	beforeEach(async () => {
		leaderboardService = {
			getGameLeaderboard: jest.fn().mockResolvedValue([]),
			getOverallLeaderboard: jest.fn().mockResolvedValue([]),
			getTournamentLeaderboard: jest.fn().mockResolvedValue([]),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				LeaderboardController,
				{ provide: LeaderboardService, useValue: leaderboardService },
			],
		}).compile();

		controller = module.get(LeaderboardController);
	});

	// ── GET /leaderboard — Rankings Bug Audit M1 ──────────────────────────────

	describe("getGameLeaderboard", () => {
		// Note: `getGameLeaderboard` is a synchronous method that returns a
		// Promise from the service call — it throws `BadRequestException`
		// synchronously before any promise exists, so the assertion wraps the
		// call rather than awaiting a rejection.
		it("should throw BadRequestException when gameId is missing", () => {
			expect(() =>
				controller.getGameLeaderboard(req, undefined as unknown as string, "global"),
			).toThrow(BadRequestException);
			expect(leaderboardService.getGameLeaderboard).not.toHaveBeenCalled();
		});

		it("should throw BadRequestException when gameId is empty", () => {
			expect(() =>
				controller.getGameLeaderboard(req, "", "global"),
			).toThrow(BadRequestException);
			expect(leaderboardService.getGameLeaderboard).not.toHaveBeenCalled();
		});

		it("should throw BadRequestException when gameId is not a known game", () => {
			expect(() =>
				controller.getGameLeaderboard(req, "shell-curl", "global"),
			).toThrow(BadRequestException);
			expect(leaderboardService.getGameLeaderboard).not.toHaveBeenCalled();
		});

		it("should call the service with a known gameId and default to global scope", async () => {
			await controller.getGameLeaderboard(req, "temple-curling", undefined as unknown as string);

			expect(leaderboardService.getGameLeaderboard).toHaveBeenCalledWith(
				1,
				"temple-curling",
				"global",
			);
		});

		it("should coerce an unrecognized scope value to global", async () => {
			await controller.getGameLeaderboard(req, "kame-knock", "bogus");

			expect(leaderboardService.getGameLeaderboard).toHaveBeenCalledWith(
				1,
				"kame-knock",
				"global",
			);
		});

		it("should pass the friends scope through unchanged", async () => {
			await controller.getGameLeaderboard(req, "bell-clash", "friends");

			expect(leaderboardService.getGameLeaderboard).toHaveBeenCalledWith(
				1,
				"bell-clash",
				"friends",
			);
		});
	});

	// ── GET /leaderboard/overall ───────────────────────────────────────────────

	describe("getOverallLeaderboard", () => {
		it("should default to global scope", async () => {
			await controller.getOverallLeaderboard(req, undefined as unknown as string);

			expect(leaderboardService.getOverallLeaderboard).toHaveBeenCalledWith(
				1,
				"global",
			);
		});

		it("should pass the friends scope through unchanged", async () => {
			await controller.getOverallLeaderboard(req, "friends");

			expect(leaderboardService.getOverallLeaderboard).toHaveBeenCalledWith(
				1,
				"friends",
			);
		});
	});

	// ── GET /leaderboard/tournaments (Rankings Bug Audit §5.1) ────────────────

	describe("getTournamentLeaderboard", () => {
		it("should default to global scope", async () => {
			await controller.getTournamentLeaderboard(req, undefined as unknown as string);

			expect(leaderboardService.getTournamentLeaderboard).toHaveBeenCalledWith(
				1,
				"global",
			);
		});

		it("should pass the friends scope through unchanged", async () => {
			await controller.getTournamentLeaderboard(req, "friends");

			expect(leaderboardService.getTournamentLeaderboard).toHaveBeenCalledWith(
				1,
				"friends",
			);
		});

		it("should coerce an unrecognized scope value to global", async () => {
			await controller.getTournamentLeaderboard(req, "bogus");

			expect(leaderboardService.getTournamentLeaderboard).toHaveBeenCalledWith(
				1,
				"global",
			);
		});
	});
});
