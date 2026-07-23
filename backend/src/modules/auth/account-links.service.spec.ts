import { BadRequestException } from "@nestjs/common";
import { AccountLinksService } from "./account-links.service";
import type { AuthIdentity } from "./entities/auth-identity.entity";

describe("AccountLinksService", () => {
	const makeService = (rows: Partial<AuthIdentity>[]) => {
		const manager = {
			find: jest.fn().mockResolvedValue(rows),
			remove: jest.fn().mockResolvedValue(undefined),
		};
		const dataSource = {
			transaction: jest.fn(async (operation: (value: typeof manager) => unknown) =>
				operation(manager),
			),
		};
		const users = {
			resolveCanonicalUserId: jest.fn().mockResolvedValue(7),
		};
		const service = new AccountLinksService(
			{} as never,
			{} as never,
			users as never,
			dataSource as never,
			{ isQueued: jest.fn().mockReturnValue(false) } as never,
		);
		return { service, manager, users };
	};

	it("rejects removal of the final sign-in method", async () => {
		const { service, manager } = makeService([
			{ id: "one", userId: 7, method: "forty_two" },
		]);
		await expect(service.unlink(7, "forty_two")).rejects.toThrow(
			BadRequestException,
		);
		expect(manager.remove).not.toHaveBeenCalled();
	});

	it("removes only the requested method when another method remains", async () => {
		const fortyTwo = {
			id: "forty-two",
			userId: 7,
			method: "forty_two",
		} as AuthIdentity;
		const shell = {
			id: "shell",
			userId: 7,
			method: "shellsmash",
		} as AuthIdentity;
		const { service, manager, users } = makeService([fortyTwo, shell]);
		await service.unlink(9, "forty_two");
		expect(users.resolveCanonicalUserId).toHaveBeenCalledWith(9);
		expect(manager.remove).toHaveBeenCalledWith(fortyTwo);
	});

	it("does not count a retained legacy Google identity as a sign-in method", async () => {
		const { service, manager } = makeService([
			{ id: "legacy", userId: 7, method: "google" },
			{ id: "forty-two", userId: 7, method: "forty_two" },
		]);

		await expect(service.unlink(7, "forty_two")).rejects.toThrow(
			BadRequestException,
		);
		expect(manager.remove).not.toHaveBeenCalled();
	});
});
