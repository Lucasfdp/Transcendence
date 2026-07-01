import {
	BadRequestException,
	InternalServerErrorException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { FriendsService } from "../friends/friends.service";
import { Report } from "./entities/report.entity";
import { ReportsService } from "./reports.service";

const mockReportRepo = () => ({
	create: jest.fn((v) => v),
	save: jest.fn(async (v) => ({ id: 1, ...v })),
});

const mockFriendsService = () => ({
	block: jest.fn().mockResolvedValue(undefined),
});

describe("ReportsService", () => {
	let service: ReportsService;
	let reportRepo: ReturnType<typeof mockReportRepo>;
	let friendsService: ReturnType<typeof mockFriendsService>;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ReportsService,
				{ provide: getRepositoryToken(Report), useFactory: mockReportRepo },
				{ provide: FriendsService, useFactory: mockFriendsService },
			],
		}).compile();

		service = module.get(ReportsService);
		reportRepo = module.get(getRepositoryToken(Report));
		friendsService = module.get(FriendsService);
	});

	describe("create", () => {
		it("should throw BadRequestException when reporting yourself", async () => {
			await expect(
				service.create(1, 1, "harassment"),
			).rejects.toThrow(BadRequestException);
			expect(reportRepo.save).not.toHaveBeenCalled();
			expect(friendsService.block).not.toHaveBeenCalled();
		});

		it("should persist the report on the happy path", async () => {
			await service.create(1, 2, "harassment", "being rude");

			expect(reportRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({
					reporterId: 1,
					reportedId: 2,
					category: "harassment",
					message: "being rude",
				}),
			);
		});

		it("should default message to null when not provided", async () => {
			await service.create(1, 2, "spam");

			expect(reportRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ message: null }),
			);
		});

		it("should auto-block the reported user after persisting the report", async () => {
			await service.create(1, 2, "cheating");

			expect(friendsService.block).toHaveBeenCalledWith(1, 2);
		});

		it("should throw InternalServerErrorException when persisting the report fails", async () => {
			reportRepo.save.mockRejectedValue(new Error("DB down"));

			await expect(service.create(1, 2, "other")).rejects.toThrow(
				InternalServerErrorException,
			);
			expect(friendsService.block).not.toHaveBeenCalled();
		});

		it("should propagate errors from the auto-block step", async () => {
			friendsService.block.mockRejectedValue(
				new InternalServerErrorException("Failed to block user"),
			);

			await expect(service.create(1, 2, "spam")).rejects.toThrow(
				"Failed to block user",
			);
		});
	});
});
