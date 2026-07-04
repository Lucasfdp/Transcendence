import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, api } from "./api";

/** Minimal fake Response covering only what apiFetch/apiUploadFile touch. */
function makeResponse(
	status: number,
	body: unknown = null,
	options: { contentType?: string } = {},
): Response {
	const contentType = options.contentType ?? "application/json";
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: {
			get: (name: string) =>
				name.toLowerCase() === "content-type" ? contentType : null,
		},
		json: async () => body,
		text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
	} as unknown as Response;
}

describe("hub/api — apiFetch transient-retry gating (Bug Audit L1)", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		document.cookie = "";
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("retries a GET once on a transient 503 and returns the successful result", async () => {
		fetchMock
			.mockResolvedValueOnce(makeResponse(503, { message: "unavailable" }))
			.mockResolvedValueOnce(makeResponse(200, { ok: true }));

		const result = await api.getMe();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result).toEqual({ ok: true });
	});

	it("does NOT retry a non-idempotent POST on a transient 503 — fails fast instead", async () => {
		// sendFriendRequest is not marked idempotent: a lost response could
		// mean the request actually succeeded, so silently retrying it risks
		// creating confusing duplicate-request errors instead of a clean
		// single outcome.
		fetchMock.mockResolvedValueOnce(
			makeResponse(503, { message: "unavailable" }),
		);

		await expect(api.sendFriendRequest("rival")).rejects.toBeInstanceOf(
			AuthError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("retries a POST marked idempotent once on a transient 503 and succeeds", async () => {
		// markConversationReadRest opts into `idempotent: true` since marking
		// a conversation read is safe to repeat.
		fetchMock
			.mockResolvedValueOnce(makeResponse(503, { message: "unavailable" }))
			.mockResolvedValueOnce(makeResponse(204));

		await expect(
			api.markConversationReadRest(10),
		).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("still throws AuthError when an idempotent POST fails both the original attempt and the retry", async () => {
		fetchMock
			.mockResolvedValueOnce(makeResponse(503, { message: "unavailable" }))
			.mockResolvedValueOnce(makeResponse(503, { message: "still down" }));

		await expect(api.markConversationReadRest(10)).rejects.toBeInstanceOf(
			AuthError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("does not retry a non-transient error status (e.g. 404) regardless of idempotent", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(404, { message: "gone" }));

		await expect(api.markConversationReadRest(10)).rejects.toBeInstanceOf(
			AuthError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("hub/api — apiUploadFile empty-body handling (Bug Audit L2)", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		document.cookie = "";
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const fakeAvatar = () =>
		new File(["fake-image-bytes"], "avatar.png", { type: "image/png" });

	it("parses a normal JSON response as before", async () => {
		fetchMock.mockResolvedValueOnce(
			makeResponse(200, { avatarUrl: "/uploads/avatars/x.png" }),
		);

		const result = await api.uploadAvatar(fakeAvatar());

		expect(result).toEqual({ avatarUrl: "/uploads/avatars/x.png" });
	});

	it("returns an empty object instead of throwing on a 204 empty body", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(204));

		await expect(api.uploadAvatar(fakeAvatar())).resolves.toEqual({});
	});
});
