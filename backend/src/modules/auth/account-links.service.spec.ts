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
			{ id: "one", userId: 7, method: "google" },
		]);
		await expect(service.unlink(7, "google")).rejects.toThrow(
			BadRequestException,
		);
		expect(manager.remove).not.toHaveBeenCalled();
	});

	it("removes only the requested method when another method remains", async () => {
		const google = { id: "google", userId: 7, method: "google" } as AuthIdentity;
		const shell = {
			id: "shell",
			userId: 7,
			method: "shellsmash",
		} as AuthIdentity;
		const { service, manager, users } = makeService([google, shell]);
		await service.unlink(9, "google");
		expect(users.resolveCanonicalUserId).toHaveBeenCalledWith(9);
		expect(manager.remove).toHaveBeenCalledWith(google);
	});
});
