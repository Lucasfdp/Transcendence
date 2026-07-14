import { describe, expect, it } from "vitest";

import {
	LocalReplayPersistenceRuntime,
	persistLocalReplayImport,
} from "../runtime/LocalReplayPersistenceRuntime";
import { SceneReplayRecorder } from "../localReplay";

describe("LocalReplayPersistenceRuntime", () => {
	it("persists local replay imports through the common persistence runtime", async () => {
		const recorder = new SceneReplayRecorder<{ phase: string }>();
		recorder.start("bell-clash", () => ({ phase: "active" }));
		const imported: unknown[] = [];

		const runtime = new LocalReplayPersistenceRuntime();
		runtime.start({
			recorder,
			gameId: "bell-clash",
			mode: "singleplayer",
			user: { id: 7, username: "player" },
			playerCount: 1,
			playerNames: ["player"],
			winnerSide: null,
			importReplay: async (payload) => {
				imported.push(payload);
			},
		});
		await runtime.waitForPending();

		expect(imported).toEqual([
			expect.objectContaining({
				gameId: "bell-clash",
				status: "finished",
				metadata: expect.objectContaining({
					contractVersion: 2,
					powerupsEnabled: false,
					participants: [
						expect.objectContaining({ userId: 7, username: "player" }),
					],
				}),
			}),
		]);
	});

	it("skips replay persistence for guests", async () => {
		const recorder = new SceneReplayRecorder<{ phase: string }>();
		recorder.start("kame-knock", () => ({ phase: "active" }));
		let imported = false;

		await persistLocalReplayImport({
			recorder,
			gameId: "kame-knock",
			mode: "singleplayer",
			user: { id: 7, username: "guest", isGuest: true },
			playerCount: 1,
			playerNames: ["guest"],
			winnerSide: null,
			importReplay: async () => {
				imported = true;
			},
		});

		expect(imported).toBe(false);
	});
});
