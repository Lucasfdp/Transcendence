import { describe, expect, it } from "vitest";

import { LocalReplayRuntime } from "../runtime/LocalReplayRuntime";

describe("LocalReplayRuntime", () => {
	it("owns replay capture, recorder state, and persistence as one runtime", async () => {
		const imported: unknown[] = [];
		const runtime = new LocalReplayRuntime<
			{ phase: string; seq: number },
			string
		>({
			gameId: "kame-knock",
			captureStepMs: 100,
			buildSnapshot: (phaseOverride) => ({
				phase: phaseOverride ?? "active",
				seq: 0,
			}),
		});

		runtime.startCapture();
		runtime.addElapsed(120);
		runtime.captureTick(120);
		runtime.captureFrame(true, "finished");

		await runtime.persist({
			gameId: "kame-knock",
			mode: "singleplayer",
			user: { id: 4, username: "player" },
			playerCount: 1,
			playerNames: ["player"],
			winnerSide: null,
			importReplay: async (payload) => {
				imported.push(payload);
			},
		});
		await runtime.waitForPendingPersist();

		expect(imported).toEqual([
			expect.objectContaining({
				gameId: "kame-knock",
				metadata: expect.objectContaining({
					contractVersion: 2,
					powerupsEnabled: false,
					participants: [expect.objectContaining({ userId: 4 })],
				}),
				frames: expect.arrayContaining([
					expect.objectContaining({
						changes: expect.objectContaining({
							phase: "finished",
						}),
					}),
				]),
			}),
		]);
	});
});
