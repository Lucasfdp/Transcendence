import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gamblingApi } from "./gamblingApi";

function makeResponse(status: number, body: unknown = null): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => "application/json" },
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

describe("gamblingApi", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		document.cookie = "";
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function lastCall() {
		const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
		return { url: String(url), init: init as RequestInit };
	}

	it("getWheel() issues a GET /casino/wheel", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, { rtp: 1 }));
		await gamblingApi.getWheel();
		expect(lastCall().url).toMatch(/\/casino\/wheel$/);
		expect(lastCall().init.method ?? "GET").toBe("GET");
	});

	it("spinFreeWheel(clientSeed) issues a POST /casino/wheel/free with { clientSeed }", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, { multiplier: 2 }));
		await gamblingApi.spinFreeWheel("seed-1");
		const { url, init } = lastCall();
		expect(url).toMatch(/\/casino\/wheel\/free$/);
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body as string)).toEqual({ clientSeed: "seed-1" });
	});

	it("spinWheel(stake, clientSeed) issues a POST /casino/wheel/spin with { stake, clientSeed }", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, { multiplier: 2 }));
		await gamblingApi.spinWheel(50, "seed-2");
		const { url, init } = lastCall();
		expect(url).toMatch(/\/casino\/wheel\/spin$/);
		expect(JSON.parse(init.body as string)).toEqual({
			stake: 50,
			clientSeed: "seed-2",
		});
	});

	it("does not retry spinWheel on a transient 503 — wagered spins are not idempotent", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(503, { message: "unavailable" }));
		await expect(gamblingApi.spinWheel(50)).rejects.toThrow();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("getFlip() issues a GET /casino/flip", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.getFlip();
		expect(lastCall().url).toMatch(/\/casino\/flip$/);
	});

	it("flip(stake, pick, clientSeed) issues a POST /casino/flip with the full body", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.flip(20, "heads", "seed-3");
		const { url, init } = lastCall();
		expect(url).toMatch(/\/casino\/flip$/);
		expect(JSON.parse(init.body as string)).toEqual({
			stake: 20,
			pick: "heads",
			clientSeed: "seed-3",
		});
	});

	it("getMonte() issues a GET /casino/monte", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.getMonte();
		expect(lastCall().url).toMatch(/\/casino\/monte$/);
	});

	it("startMonteRound(stake, clientSeed) issues a POST /casino/monte/rounds", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.startMonteRound(30, "seed-4");
		const { url, init } = lastCall();
		expect(url).toMatch(/\/casino\/monte\/rounds$/);
		expect(JSON.parse(init.body as string)).toEqual({
			stake: 30,
			clientSeed: "seed-4",
		});
	});

	it("getMonteSteps(roundId) issues a GET to the round's /steps endpoint", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.getMonteSteps("round-1");
		expect(lastCall().url).toMatch(/\/casino\/monte\/rounds\/round-1\/steps$/);
	});

	it("resolveMonteRound(roundId, selectedSlot) issues a POST to the round's /resolve endpoint", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.resolveMonteRound("round-1", 2);
		const { url, init } = lastCall();
		expect(url).toMatch(/\/casino\/monte\/rounds\/round-1\/resolve$/);
		expect(JSON.parse(init.body as string)).toEqual({ selectedSlot: 2 });
	});

	it("getSlots() issues a GET /casino/slots", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.getSlots();
		expect(lastCall().url).toMatch(/\/casino\/slots$/);
	});

	it("spinSlots(stake, clientSeed) issues a POST /casino/slots", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.spinSlots(40, "seed-5");
		const { url, init } = lastCall();
		expect(url).toMatch(/\/casino\/slots$/);
		expect(JSON.parse(init.body as string)).toEqual({
			stake: 40,
			clientSeed: "seed-5",
		});
	});

	it("getDice() issues a GET /casino/dice", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.getDice();
		expect(lastCall().url).toMatch(/\/casino\/dice$/);
	});

	it("dice(stake, direction, target, clientSeed) issues a POST /casino/dice with the full body", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.dice(10, "over", 50, "seed-6");
		const { url, init } = lastCall();
		expect(url).toMatch(/\/casino\/dice$/);
		expect(JSON.parse(init.body as string)).toEqual({
			stake: 10,
			direction: "over",
			target: 50,
			clientSeed: "seed-6",
		});
	});

	it("getPlinko() issues a GET /casino/plinko", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.getPlinko();
		expect(lastCall().url).toMatch(/\/casino\/plinko$/);
	});

	it("dropPlinko(stake, rows, clientSeed) issues a POST /casino/plinko with the full body", async () => {
		fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
		await gamblingApi.dropPlinko(15, 12, "seed-7");
		const { url, init } = lastCall();
		expect(url).toMatch(/\/casino\/plinko$/);
		expect(JSON.parse(init.body as string)).toEqual({
			stake: 15,
			rows: 12,
			clientSeed: "seed-7",
		});
	});
});
