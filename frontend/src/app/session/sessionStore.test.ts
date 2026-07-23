import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, AuthError, type User } from "../../features/hub/api";
import {
	cacheSessionUser,
	invalidateSessionCache,
	readSession,
	resetSessionStore,
} from "./sessionStore";

vi.mock("../../features/hub/api", async (importOriginal) => {
	const original = await importOriginal<typeof import("../../features/hub/api")>();
	return {
		...original,
		api: { ...original.api, getMe: vi.fn() },
	};
});

const user = { id: 7, username: "kame" } as User;

describe("sessionStore", () => {
	beforeEach(() => {
		resetSessionStore();
		vi.mocked(api.getMe).mockReset();
	});

	it("shares one auth request between concurrent consumers", async () => {
		vi.mocked(api.getMe).mockResolvedValue(user);

		const [first, second] = await Promise.all([readSession(), readSession()]);

		expect(api.getMe).toHaveBeenCalledTimes(1);
		expect(first).toEqual({ status: "authenticated", user });
		expect(second).toBe(first);
	});

	it("reuses a recently resolved session until a forced refresh", async () => {
		vi.mocked(api.getMe).mockResolvedValue(user);

		await readSession();
		await readSession();
		await readSession(true);

		expect(api.getMe).toHaveBeenCalledTimes(2);
	});

	it("caches an explicit unauthenticated result", async () => {
		vi.mocked(api.getMe).mockRejectedValue(new AuthError(401, "Unauthorized"));

		expect(await readSession()).toEqual({
			status: "unauthenticated",
			user: null,
		});
		expect(await readSession()).toEqual({
			status: "unauthenticated",
			user: null,
		});
		expect(api.getMe).toHaveBeenCalledTimes(1);
	});

	it("does not turn a transient failure into a cached logout", async () => {
		vi.mocked(api.getMe)
			.mockRejectedValueOnce(new Error("network unavailable"))
			.mockResolvedValueOnce(user);

		await expect(readSession()).rejects.toThrow("network unavailable");
		expect(await readSession()).toEqual({ status: "authenticated", user });
		expect(api.getMe).toHaveBeenCalledTimes(2);
	});

	it("does not restore a session invalidated while a request was pending", async () => {
		let resolveOldRequest: ((value: User) => void) | undefined;
		vi.mocked(api.getMe)
			.mockImplementationOnce(
				() =>
					new Promise<User>((resolve) => {
						resolveOldRequest = resolve;
					}),
			)
			.mockResolvedValueOnce({ ...user, id: 9 });

		const oldRequest = readSession();
		invalidateSessionCache();
		const currentSession = await readSession(true);
		resolveOldRequest?.(user);
		await oldRequest;

		expect(currentSession.user?.id).toBe(9);
		expect(await readSession()).toEqual(currentSession);
	});

	it("keeps an explicit logout local until authentication forces a refresh", async () => {
		vi.mocked(api.getMe).mockResolvedValue(user);
		await readSession();
		invalidateSessionCache();

		expect(await readSession()).toEqual({
			status: "unauthenticated",
			user: null,
		});
		expect(api.getMe).toHaveBeenCalledTimes(1);
		expect(await readSession(true)).toEqual({ status: "authenticated", user });
		expect(api.getMe).toHaveBeenCalledTimes(2);
	});

	it("lets a concurrent 401 override a local user update", async () => {
		let rejectRequest: ((error: unknown) => void) | undefined;
		vi.mocked(api.getMe).mockReturnValue(
			new Promise<User>((_resolve, reject) => {
				rejectRequest = reject;
			}),
		);

		const request = readSession();
		cacheSessionUser(user);
		rejectRequest?.(new AuthError(401, "Expired"));

		expect(await request).toEqual({ status: "unauthenticated", user: null });
		expect(await readSession()).toEqual({
			status: "unauthenticated",
			user: null,
		});
	});
});
