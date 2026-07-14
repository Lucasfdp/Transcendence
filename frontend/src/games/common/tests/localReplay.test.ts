import { describe, expect, it } from "vitest";
import {
	buildLocalReplayImportRequest,
	buildLocalReplayPlayers,
	normalizeReplayImportFrames,
	replayBallToEntity,
	resolveReplayWinnerSide,
	SceneReplayRecorder,
	trimReplayRoundPreRoll,
} from "../localReplay";
import { ReplayEncoder, reconstructReplayFrame } from "../replay/ReplayEncoder";

function encodedFrames(count: number, stepMs = 100) {
	const encoder = new ReplayEncoder();
	return Array.from({ length: count }, (_value, index) =>
		encoder.encode(index, index * stepMs, { phase: "active", index }, index === 0),
	).filter((frame): frame is NonNullable<typeof frame> => frame !== null);
}

describe("localReplay", () => {
	it("normalises v2 sequence without changing monotonic time", () => {
		const source = encodedFrames(2, 120).map((frame, index) => ({ ...frame, seq: index + 10 }));
		const frames = normalizeReplayImportFrames(source);
		expect(frames.map((frame) => ({ seq: frame.seq, tMs: frame.tMs }))).toEqual([
			{ seq: 0, tMs: 0 },
			{ seq: 1, tMs: 120 },
		]);
	});

	it("keeps first and last frames when compacting imports", () => {
		const frames = encodedFrames(5);

		const normalized = normalizeReplayImportFrames(frames, 3);

		expect(normalized).toHaveLength(3);
		expect(reconstructReplayFrame(normalized, 0)).toMatchObject({ index: 0 });
		expect(reconstructReplayFrame(normalized, 2)).toMatchObject({ index: 4 });
		expect(normalized[normalized.length - 1]?.tMs).toBe(400);
		expect(normalized.map((frame) => frame.seq)).toEqual([0, 1, 2]);
	});

	it("preserves duration and reconstructability when compacting", () => {
		const normalized = normalizeReplayImportFrames(encodedFrames(3, 120), 2);
		expect(normalized).toHaveLength(2);
		expect(normalized[1]).toMatchObject({ seq: 1, tMs: 240, type: "keyframe" });
		expect(reconstructReplayFrame(normalized, 1)).toMatchObject({ index: 2 });
	});

	it("limits round pre-roll to three seconds without compressing later pauses", () => {
		const frames = encodedFrames(3, 5000);
		const timeline = trimReplayRoundPreRoll(frames, [
			{ seq: 0, tMs: 5000, round: 0, type: "action:start", payload: {} },
		]);
		expect(timeline.events[0]?.tMs).toBe(3000);
		expect(timeline.frames[timeline.frames.length - 1]?.tMs).toBe(8000);
		expect(
			(timeline.frames[timeline.frames.length - 1]?.tMs ?? 0) -
				(timeline.events[0]?.tMs ?? 0),
		).toBe(5000);
	});

	it("captures player visuals and visible power metadata", () => {
		const players = buildLocalReplayPlayers(
			{
				id: 7,
				username: "user",
				turtleName: "turtle",
				shellSkin: "red-shell",
				hubBackground: "sunset_bg",
				hubBackgroundAlter: "sunset_cycle_bg",
			},
			2,
		);
		const entity = replayBallToEntity(
			{
				id: "ball-1",
				side: 0,
				x: 0.4,
				y: 0.5,
				vx: 1,
				vy: 2,
				power: "giant",
				moving: true,
			},
			"fallback-shell",
		);

		expect(players[0]).toMatchObject({
			userId: 7,
			username: "turtle",
			shellSkin: "red-shell",
			hubBackground: "sunset_bg",
			hubBackgroundAlter: "sunset_cycle_bg",
		});
		expect(entity).toMatchObject({
			type: "projectile",
			scale: 2,
			spriteKey: "fallback-shell",
			stateFlags: expect.arrayContaining(["moving", "power:giant"]),
		});
	});

	it("resolves winners only when there is a single highest score", () => {
		expect(resolveReplayWinnerSide([1, 3, 2])).toBe(1);
		expect(resolveReplayWinnerSide([3, 3, 1])).toBeNull();
	});

	it("records local replay frames through the shared recorder runtime", () => {
		const recorder = new SceneReplayRecorder<{ phase: string; seq: number }>();

		recorder.start("bamboo-bash", () => ({
			phase: "active",
			seq: recorder.nextSeq(),
		}));
		recorder.addElapsed(120);
		recorder.captureOnInterval(120, 100, () => ({
			phase: "active",
			seq: recorder.nextSeq(),
		}));

		expect(recorder.getReplayId()).toMatch(/^local:bamboo-bash:/);
		expect(recorder.getFrames()).toHaveLength(2);
		expect(recorder.buildImportFrames()).toEqual([
			expect.objectContaining({ seq: 0, tMs: 0, type: "keyframe" }),
			expect.objectContaining({ seq: 1, tMs: 100, type: "delta" }),
		]);
		recorder.addElapsed(80);
		recorder.captureOnInterval(80, 100, () => ({ phase: "active", seq: recorder.nextSeq() }));
		const capturedFrames = recorder.getFrames();
		expect(capturedFrames[capturedFrames.length - 1]?.tMs).toBe(200);
	});

	it("builds replay import payloads with the finished status contract", () => {
		expect(
			buildLocalReplayImportRequest({
				gameId: "bell-clash",
				mode: "singleplayer",
				createdAt: "2026-07-04T10:00:00.000Z",
				finishedAt: "2026-07-04T10:00:02.000Z",
				winnerSide: 0,
				playerUserIds: [7],
				playerNames: ["Player 1"],
			frames: encodedFrames(2, 2000),
			}),
		).toMatchObject({
			gameId: "bell-clash",
			mode: "singleplayer",
			status: "finished",
			winnerSide: 0,
			durationMs: 2000,
			metadata: expect.objectContaining({
				contractVersion: 2,
				powerupsEnabled: false,
				participants: [{ side: 0, userId: 7, username: "Player 1" }],
			}),
		});
	});

});
