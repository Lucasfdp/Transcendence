import { In } from "typeorm";
import { TournamentsService } from "./tournaments.service";

describe("TournamentsService", () => {
	let service: TournamentsService;
	let tournamentRepo: { update: jest.Mock };
	let participantRepo: { update: jest.Mock };
	let tournamentMatchRepo: { update: jest.Mock };

	beforeEach(() => {
		tournamentRepo = { update: jest.fn() };
		participantRepo = { update: jest.fn() };
		tournamentMatchRepo = { update: jest.fn() };
		service = new TournamentsService(
			tournamentRepo as never,
			participantRepo as never,
			tournamentMatchRepo as never,
		);
	});

	describe("onModuleInit — boot reconciliation (SPEC-023 v1 restart policy)", () => {
		it("marks pending and active tournaments as cancelled", async () => {
			tournamentRepo.update.mockResolvedValue({ affected: 3 });

			await service.onModuleInit();

			expect(tournamentRepo.update).toHaveBeenCalledTimes(1);
			expect(tournamentRepo.update).toHaveBeenCalledWith(
				{ status: In(["pending", "active"]) },
				{ status: "cancelled" },
			);
		});

		it("never touches finished or cancelled tournaments", async () => {
			tournamentRepo.update.mockResolvedValue({ affected: 0 });

			await service.onModuleInit();

			const [criteria] = tournamentRepo.update.mock.calls[0];
			expect(criteria.status.value).toEqual(["pending", "active"]);
		});

		it("skips cleanup silently when the table does not exist yet (fresh DB, 42P01)", async () => {
			tournamentRepo.update.mockRejectedValue({ code: "42P01" });

			await expect(service.onModuleInit()).resolves.toBeUndefined();
		});

		it("rethrows unexpected boot cleanup errors", async () => {
			const boom = new Error("connection refused");
			tournamentRepo.update.mockRejectedValue(boom);

			await expect(service.onModuleInit()).rejects.toThrow(
				"connection refused",
			);
		});
	});
});
