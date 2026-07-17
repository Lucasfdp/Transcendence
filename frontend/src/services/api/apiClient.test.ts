import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, NetworkError, apiFetch, apiUploadFile } from "./apiClient";

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

function lastRequestHeaders(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0) {
	return (fetchMock.mock.calls[callIndex][1] as RequestInit)
		.headers as Record<string, string>;
}

describe("apiClient — apiFetch transient-retry gating (Bug Audit L1)", () => {
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

		const result = await apiFetch("/probe");

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result).toEqual({ ok: true });
	});

	it("does NOT retry a non-idempotent POST on a transient 503 — fails fast instead", async () => {
		fetchMock.mockResolvedValueOnce(
			makeResponse(503, { message: "unavailable" }),
		);

		await expect(
			apiFetch("/probe", { method: "POST" }),
		).rejects.toBeInstanceOf(AuthError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("retries a POST marked idempotent once on a transient 503 and succeeds", async () => {
		fetchMock
			.mockResolvedValueOnce(makeResponse(503, { message: "unavailable" }))
			.mockResolvedValueOnce(makeResponse(204));

		await expect(
			apiFetch("/probe", { method: "POST", idempotent: true }),
		).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("still throws AuthError when an idempotent POST fails both the original attempt and the retry", async () => {
		fetchMock
			.mockResolvedValueOnce(makeResponse(503, { message: "unavailable" }))
			.mockResolvedValueOnce(makeResponse(503, { message: "still down" }));

		await expect(
			apiFetch("/probe", { method: "POST", idempotent: true }),
		).rejects.toBeInstanceOf(AuthError);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("does not retry a non-transient error status (e.g. 404) regardless of idempotent", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(404, { message: "gone" }));

		await expect(
			apiFetch("/probe", { method: "POST", idempotent: true }),
		).rejects.toBeInstanceOf(AuthError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("wraps a fetch-level rejection (offline) in NetworkError", async () => {
		fetchMock.mockRejectedValueOnce(new Error("offline"));

		await expect(apiFetch("/probe")).rejects.toBeInstanceOf(NetworkError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("apiClient — CSRF token handling", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		// Assigning document.cookie = "" does NOT clear a previously set
		// "csrf_token" cookie — jsdom (like real browsers) only overwrites a
		// cookie when the assignment names it explicitly. Expire it here so
		// tests in this block don't leak a token into one another.
		document.cookie = "csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("does not attach X-CSRF-Token on a GET request", async () => {
		document.cookie = "csrf_token=cookie-token";
		fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true }));

		await apiFetch("/probe");

		expect(lastRequestHeaders(fetchMock)["X-CSRF-Token"]).toBeUndefined();
	});

	it("attaches X-CSRF-Token from the csrf_token cookie on a non-GET request", async () => {
		document.cookie = "csrf_token=cookie-token";
		fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true }));

		await apiFetch("/probe", { method: "POST" });

		expect(lastRequestHeaders(fetchMock)["X-CSRF-Token"]).toBe("cookie-token");
	});

	it("refreshes the CSRF token once and replays a rejected non-GET request", async () => {
		// No csrf_token cookie yet — mirrors a fresh tab that hasn't called
		// getCsrfToken(). The mocked /auth/csrf-token response below does not
		// set a real Set-Cookie header (jsdom fetch mocks can't), so the
		// replay must fall back to the in-memory cache rather than the cookie.
		fetchMock
			.mockResolvedValueOnce(makeResponse(403, { message: "invalid csrf token" }))
			.mockResolvedValueOnce(makeResponse(200, { csrfToken: "fresh-token" }))
			.mockResolvedValueOnce(makeResponse(200, { ok: true }));

		const result = await apiFetch("/probe", { method: "POST" });

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(lastRequestHeaders(fetchMock, 2)["X-CSRF-Token"]).toBe(
			"fresh-token",
		);
		expect(result).toEqual({ ok: true });
	});

	it("throws AuthError without replaying when the rejection is not CSRF-related", async () => {
		document.cookie = "csrf_token=stale-token";
		fetchMock.mockResolvedValueOnce(
			makeResponse(403, { message: "forbidden: not your resource" }),
		);

		await expect(
			apiFetch("/probe", { method: "POST" }),
		).rejects.toBeInstanceOf(AuthError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("apiClient — apiUploadFile empty-body handling (Bug Audit L2)", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		document.cookie = "";
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("parses a normal JSON response as before", async () => {
		fetchMock.mockResolvedValueOnce(
			makeResponse(200, { avatarUrl: "/uploads/avatars/x.png" }),
		);

		const result = await apiUploadFile("/probe/upload", new FormData());

		expect(result).toEqual({ avatarUrl: "/uploads/avatars/x.png" });
	});

	it("returns an empty object instead of throwing on a 204 empty body", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(204));

		await expect(
			apiUploadFile("/probe/upload", new FormData()),
		).resolves.toEqual({});
	});
});
