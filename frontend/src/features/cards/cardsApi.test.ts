import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardsApi } from "./cardsApi";

function makeResponse(status: number, body: unknown = null): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => "application/json" },
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

describe("cardsApi", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		document.cookie = "";
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("getCards() issues a GET /cards and returns the binder view", async () => {
		const binder = { cards: [], sets: [], totals: { owned: 0, total: 0 }, packTiers: [] };
		fetchMock.mockResolvedValueOnce(makeResponse(200, binder));

		const result = await cardsApi.getCards();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toMatch(/\/cards$/);
		expect((init as RequestInit).method ?? "GET").toBe("GET");
		expect(result).toEqual(binder);
	});

	it("openCardPack(tierId) issues a POST /cards/packs/open with { tierId } and returns the pull result", async () => {
		const packResult = { pulls: [], coins: 500 };
		fetchMock.mockResolvedValueOnce(makeResponse(200, packResult));

		const result = await cardsApi.openCardPack("deluxe");

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toMatch(/\/cards\/packs\/open$/);
		expect((init as RequestInit).method).toBe("POST");
		expect(JSON.parse((init as RequestInit).body as string)).toEqual({
			tierId: "deluxe",
		});
		expect(result).toEqual(packResult);
	});

	it("does not retry openCardPack on a transient 503 — pack opening is not idempotent", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(503, { message: "unavailable" }));

		await expect(cardsApi.openCardPack("basic")).rejects.toThrow();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
