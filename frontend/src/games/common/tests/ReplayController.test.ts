import { describe, expect, it } from "vitest";
import type { ReplayDetail, ReplayFrame } from "../../../features/hub/api";
import { ReplayController } from "../ReplayController";

function makeFrame(index: number): ReplayFrame {
	return {
		seq: index,
		tMs: index * 100,
		round: 1,
		state: index === 2 ? "finished" : "active",
		type: index === 0 ? "keyframe" : "delta",
		changes:
			index === 0
				? { gameId: "kame-knock", phase: "active", players: [{ side: 0, userId: 1, username: "A" }], score: [0], entities: [] }
				: { phase: index === 2 ? "finished" : "active", score: [index] },
		removals: [],
	};
}

function makeReplay(): ReplayDetail {
	return {
		id: "replay-1",
		matchId: "match-1",
		replayVersion: 2,
		contractVersion: 2,
		metadata: {
			contractVersion: 2,
			origin: "online",
			gameId: "kame-knock",
			mode: "casual",
			participants: [{ side: 0, userId: 1, username: "A" }],
			durationMs: 200,
			sampleHz: 20,
			keyframeIntervalMs: 1000,
			preRollMs: 3000,
			statistics: {},
			powerupsEnabled: false,
		},
		durationMs: 200,
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
		events: [{ seq: 0, tMs: 100, round: 1, type: "action:start", payload: {} }],
	};
}

describe("ReplayController", () => {
	it("advances on tMs and stops at the stable final frame", () => {
		const controller = new ReplayController(makeReplay());
		controller.setPlayback(0, 0, true);
		controller.update(50);
		expect(controller.getState()).toMatchObject({ frameIndex: 0, progress: 0.5, playing: true, timeMs: 50 });
		controller.update(150);
		expect(controller.getState()).toMatchObject({ frameIndex: 2, progress: 0, playing: false, timeMs: 200 });
	});

	it("seeks by time and reconstructs from the preceding keyframe", () => {
		const controller = new ReplayController(makeReplay());
		controller.seekTime(150);
		expect(controller.getState()).toMatchObject({ frameIndex: 1, progress: 0.5, timeMs: 150 });
		expect(controller.getState().frame?.snapshot.score).toEqual([1]);
	});

	it("delivers events against the same relative timeline", () => {
		const controller = new ReplayController(makeReplay());
		expect(controller.getEventsUpTo(99)).toHaveLength(0);
		expect(controller.getEventsUpTo(100)).toHaveLength(1);
	});
});
