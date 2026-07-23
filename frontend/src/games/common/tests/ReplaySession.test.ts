import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReplayDetail, ReplayFrame } from "../../../features/hub/api";
import { ReplaySession } from "../replay/ReplaySession";

function makeFrame(index: number): ReplayFrame {
	return {
		seq: index,
		tMs: index * 100,
		round: 1,
		state: index === 2 ? "finished" : "active",
		type: index === 0 ? "keyframe" : "delta",
		changes:
			index === 0
				? {
						gameId: "kame-knock",
						phase: "active",
						players: [],
						score: [0],
						entities: [],
					}
				: {
						phase: index === 2 ? "finished" : "active",
						score: [index],
					},
		removals: [],
	};
}

function makeReplay(): ReplayDetail {
	return {
		id: "replay-session",
		matchId: "match-session",
		replayVersion: 2,
		contractVersion: 2,
		metadata: {
			contractVersion: 2,
			origin: "online",
			gameId: "kame-knock",
			mode: "casual",
			participants: [],
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
		createdAt: "2026-07-23T10:00:00.000Z",
		finishedAt: "2026-07-23T10:00:00.200Z",
		expiresAt: null,
		winnerSide: 0,
		playerUserIds: [],
		playerNames: [],
		isSavedByCurrentUser: false,
		frames: [makeFrame(0), makeFrame(1), makeFrame(2)],
		events: [],
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ReplaySession", () => {
	it("keeps commands and playback position in one presentation-independent session", () => {
		let nextAnimationFrame = 0;
		const scheduled = new Map<number, FrameRequestCallback>();
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn((callback: FrameRequestCallback) => {
				nextAnimationFrame += 1;
				scheduled.set(nextAnimationFrame, callback);
				return nextAnimationFrame;
			}),
		);
		vi.stubGlobal(
			"cancelAnimationFrame",
			vi.fn((id: number) => scheduled.delete(id)),
		);
		const session = new ReplaySession(makeReplay());

		session.seekTime(150);
		session.play();
		expect(session.getState()).toMatchObject({
			frameIndex: 1,
			progress: 0.5,
			playing: true,
			timeMs: 150,
		});
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

		session.pause();
		expect(session.getState()).toMatchObject({
			frameIndex: 1,
			progress: 0.5,
			playing: false,
			timeMs: 150,
		});
		session.destroy();
		session.destroy();
	});

	it("publishes playback locally without requiring a parent feedback path", () => {
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn(() => 1),
		);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		const session = new ReplaySession(makeReplay());
		const states: number[] = [];
		const unsubscribe = session.subscribe((state) =>
			states.push(state.timeMs),
		);

		session.seekTime(100);
		session.reset();

		expect(states).toEqual([100, 0]);
		unsubscribe();
		session.destroy();
	});
});
