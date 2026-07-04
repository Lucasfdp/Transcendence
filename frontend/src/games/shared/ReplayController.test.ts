import { describe, expect, it } from "vitest";
import type { ReplayDetail, ReplayFrame } from "../../features/hub/api";
import { ReplayController } from "./ReplayController";

function makeFrame(index: number, deltaMs = 100): ReplayFrame {
	const recordedAtMs = Date.UTC(2026, 6, 4, 10, 0, 0, index * deltaMs);
	return {
		replayVersion: 1,
		seq: index,
		recordedAt: new Date(recordedAtMs).toISOString(),
		recordedAtMs,
		tickTs: index * deltaMs,
		deltaMs,
		snapshot: {
			gameId: "kame-knock",
			phase: index === 2 ? "finished" : "active",
			players: [{ side: 0, userId: 1, username: "A" }],
			score: [index],
			entities: [],
		},
	};
}

function makeReplay(): ReplayDetail {
	return {
		id: "replay-1",
		matchId: "match-1",
		replayVersion: 1,
		gameId: "kame-knock",
		mode: "casual",
		status: "finished",
		frameCount: 3,
		createdAt: "2026-07-04T10:00:00.000Z",
		finishedAt: "2026-07-04T10:00:00.200Z",
		expiresAt: null,
		winnerSide: 0,
		playerUserIds: [1],
		playerNames: ["A"],
		isSavedByCurrentUser: false,
		frames: [makeFrame(0), makeFrame(1), makeFrame(2)],
		events: [
			{
				replayVersion: 1,
				type: "fx",
				seq: 1,
				recordedAt: "2026-07-04T10:00:00.100Z",
				recordedAtMs: Date.UTC(2026, 6, 4, 10, 0, 0, 100),
				tickTs: 100,
				payload: {},
			},
		],
	};
}

describe("ReplayController", () => {
	it("advances using recorded frame duration and stops at the last frame", () => {
		const controller = new ReplayController(makeReplay());

		controller.setPlayback(0, 0, true);
		controller.update(50);
		expect(controller.getState()).toMatchObject({
			frameIndex: 0,
			progress: 0.5,
			playing: true,
		});

		controller.update(150);
		expect(controller.getState()).toMatchObject({
			frameIndex: 2,
			progress: 0,
			playing: false,
		});
	});

	it("clamps seek progress and exposes the interpolated playback time", () => {
		const controller = new ReplayController(makeReplay());

		controller.seek(1, 2);

		const state = controller.getState();
		expect(state.frameIndex).toBe(1);
		expect(state.progress).toBe(1);
		expect(state.timeMs).toBe(Date.UTC(2026, 6, 4, 10, 0, 0, 200));
	});

	it("filters events by playback time", () => {
		const controller = new ReplayController(makeReplay());

		expect(
			controller.getEventsUpTo(Date.UTC(2026, 6, 4, 10, 0, 0, 99)),
		).toHaveLength(0);
		expect(
			controller.getEventsUpTo(Date.UTC(2026, 6, 4, 10, 0, 0, 100)),
		).toHaveLength(1);
	});
});
