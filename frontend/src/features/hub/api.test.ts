import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, NetworkError } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => "application/json" },
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

describe("hub API contracts", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
		vi.stubGlobal("fetch", fetchMock);
		document.cookie =
			"csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("requests the current session from the auth endpoint", async () => {
		await api.getMe();

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/me",
			expect.objectContaining({ credentials: "include" }),
		);
	});

	it("reports the reverse proxy restart sentinel as a transient failure", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ status: "unavailable" }));

		await expect(api.getMe()).rejects.toBeInstanceOf(NetworkError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("encodes usernames when requesting a public profile", async () => {
		await api.getUser("turtle rival");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/users/turtle%20rival",
			expect.objectContaining({ credentials: "include" }),
		);
	});

	it("sends friend requests using the expected endpoint and payload", async () => {
		await api.sendFriendRequest("rival");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/friends/request",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ username: "rival" }),
			}),
		);
	});

	it("marks a conversation as read through its REST endpoint", async () => {
		await api.markConversationReadRest(10);

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/chat/conversations/10/read",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("uploads an avatar under the backend avatar field", async () => {
		const avatar = new File(["image"], "avatar.png", { type: "image/png" });

		await api.uploadAvatar(avatar);

		const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("/api/users/me/avatar");
		expect(request.method).toBe("POST");
		expect(request.body).toBeInstanceOf(FormData);
		expect((request.body as FormData).get("avatar")).toBe(avatar);
	});

	it("clears an uploaded avatar through the current-user endpoint", async () => {
		await api.clearAvatar();

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/users/me/avatar",
			expect.objectContaining({ method: "DELETE" }),
		);
	});
});
