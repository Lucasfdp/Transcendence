import { describe, expect, it } from "vitest";
import {
	buildLocalReplayImportRequest,
	buildLocalReplayPlayers,
	normalizeReplayImportFrames,
	replayBallToEntity,
	resolveReplayWinnerSide,
	SceneReplayRecorder,
} from "./localReplay";

describe("localReplay", () => {
	it("normalises imported frames to contract v1 timing", () => {
		const frames = normalizeReplayImportFrames([
			{
				seq: 10,
				recordedAt: "2026-07-04T10:00:00.000Z",
				snapshot: { gameId: "bamboo-bash" },
			},
			{
				seq: 20,
				recordedAt: "2026-07-04T10:00:00.120Z",
				snapshot: { gameId: "bamboo-bash" },
			},
		]);

		expect(frames).toEqual([
			expect.objectContaining({
				replayVersion: 1,
				seq: 0,
				recordedAtMs: Date.UTC(2026, 6, 4, 10, 0, 0, 0),
				tickTs: 0,
			}),
			expect.objectContaining({
				replayVersion: 1,
				seq: 1,
				recordedAtMs: Date.UTC(2026, 6, 4, 10, 0, 0, 120),
				tickTs: 120,
				deltaMs: 120,
			}),
		]);
	});

	it("keeps first and last frames when compacting imports", () => {
		const frames = Array.from({ length: 5 }, (_value, index) => ({
			seq: index,
			recordedAt: new Date(Date.UTC(2026, 6, 4, 10, 0, 0, index * 100)).toISOString(),
			snapshot: { index },
		}));

		const normalized = normalizeReplayImportFrames(frames, 3);

		expect(normalized).toHaveLength(3);
		expect(normalized[0].snapshot).toEqual({ index: 0 });
		expect(normalized[2].snapshot).toEqual({ index: 4 });
		expect(normalized.map((frame) => frame.seq)).toEqual([0, 1, 2]);
	});

	it("preserves recorder deltaMs when compacting imported frames", () => {
		const frames = [
			{
				seq: 0,
				recordedAt: "2026-07-04T10:00:00.000Z",
				deltaMs: 0,
				snapshot: { index: 0 },
			},
			{
				seq: 1,
				recordedAt: "2026-07-04T10:00:00.000Z",
				deltaMs: 120,
				snapshot: { index: 1 },
			},
			{
				seq: 2,
				recordedAt: "2026-07-04T10:00:00.000Z",
				deltaMs: 240,
				snapshot: { index: 2 },
			},
		];

		const normalized = normalizeReplayImportFrames(frames, 2);

		expect(normalized).toHaveLength(2);
		expect(normalized[1]).toMatchObject({
			seq: 1,
			deltaMs: 240,
			snapshot: { index: 2 },
		});
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
			expect.objectContaining({ seq: 0 }),
			expect.objectContaining({ seq: 1, deltaMs: 120 }),
		]);
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
				frames: [],
			}),
		).toMatchObject({
			gameId: "bell-clash",
			mode: "singleplayer",
			status: "finished",
			winnerSide: 0,
			playerUserIds: [7],
			playerNames: ["Player 1"],
		});
	});

});
