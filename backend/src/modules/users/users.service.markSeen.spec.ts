import { InternalServerErrorException } from "@nestjs/common";
import type { Repository } from "typeorm";
import { UsersService } from "./users.service";
import type { User } from "./entities/user.entity";

/**
 * Focused unit test for UsersService.markSeen. Constructs the service directly
 * with a minimal mocked users repository — the other injected dependencies are
 * unused by this method.
 */
describe("UsersService.markSeen", () => {
	const makeService = (update: jest.Mock): UsersService => {
		const usersRepo = { update } as unknown as Repository<User>;
		return new UsersService(
			usersRepo,
			{} as never,
			{} as never,
			{} as never,
		);
	};

	it("should update lastSeenAt for the given user", async () => {
		const update = jest.fn().mockResolvedValue({ affected: 1 });
		const service = makeService(update);
		const when = new Date("2026-07-01T00:00:00.000Z");

		await service.markSeen(7, when);

		expect(update).toHaveBeenCalledWith({ id: 7 }, { lastSeenAt: when });
	});

	it("should throw InternalServerErrorException when the update fails", async () => {
		const update = jest.fn().mockRejectedValue(new Error("db down"));
		const service = makeService(update);

		await expect(service.markSeen(7)).rejects.toThrow(
			InternalServerErrorException,
		);
	});
});
