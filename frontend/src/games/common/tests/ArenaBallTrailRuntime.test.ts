import { describe, expect, it } from "vitest";

import {
	ArenaBallTrailRuntime,
	buildArenaPowerBallTrailObjects,
} from "../runtime/ArenaBallTrailRuntime";

describe("ArenaBallTrailRuntime", () => {
	it("records arena ball trails and reads them in normalised arena space", () => {
		const runtime = new ArenaBallTrailRuntime();
		const arena = { cx: 100, cy: 200, rx: 50, ry: 25, scale: 2 };
		const ball = { x: 100, y: 200, vx: 1, vy: 0, r: 8 };

		runtime.reset("local", ball.x, ball.y);
		ball.x = 150;
		ball.y = 225;
		runtime.recordSet({
			balls: [{ id: "local", player: 0, ball }],
			isMoving: () => true,
			trailOptions: { minDistance: 1 },
		});

		expect(runtime.readNormalisedTrail("local", arena)).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		]);
	});

	it("fades stopped balls through recordSet without touching archived trails", () => {
		const runtime = new ArenaBallTrailRuntime();
		runtime.set("shell", [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 20, y: 0 },
		]);
		// Without fadeAbsentIds, trails stored under synthetic ids that are
		// never present in the record call must persist untouched.
		runtime.set("history-1", [
			{ x: 5, y: 5 },
			{ x: 6, y: 6 },
		]);
		const stoppedBall = { x: 20, y: 0, vx: 0, vy: 0, r: 8 };
		const recordStopped = () =>
			runtime.recordSet({
				balls: [{ id: "shell", player: 0, ball: stoppedBall }],
				isMoving: () => false,
				trailOptions: { stoppedFadePointsPerRecord: 2 },
			});

		recordStopped();
		expect(runtime.get("shell")).toEqual([{ x: 20, y: 0 }]);
		recordStopped();
		expect(runtime.get("shell")).toBeUndefined();
		expect(runtime.get("history-1")).toEqual([
			{ x: 5, y: 5 },
			{ x: 6, y: 6 },
		]);
	});

	it("dissolves orphaned trails when fadeAbsentIds is enabled", () => {
		const runtime = new ArenaBallTrailRuntime();
		// A settled power ball is pruned from the runtime, so its id stops
		// appearing in record calls and its trail must fade out on its own.
		runtime.set("power-0", [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 20, y: 0 },
			{ x: 30, y: 0 },
		]);
		const movingBall = { x: 50, y: 50, vx: 1, vy: 0, r: 8 };
		const record = () =>
			runtime.recordSet({
				balls: [{ id: "local", player: 0, ball: movingBall }],
				isMoving: () => true,
				trailOptions: {
					minDistance: 1,
					stoppedFadePointsPerRecord: 2,
				},
				fadeAbsentIds: true,
			});

		record();
		expect(runtime.get("power-0")).toHaveLength(2);
		expect(runtime.get("local")).toHaveLength(1);
		record();
		expect(runtime.get("power-0")).toBeUndefined();
	});

	it("records moving trails in place without replacing the stored array", () => {
		const runtime = new ArenaBallTrailRuntime();
		const trail = [{ x: 0, y: 0 }];
		runtime.set("shell", trail);
		runtime.recordSet({
			balls: [
				{
					id: "shell",
					player: 0,
					ball: { x: 50, y: 0, vx: 1, vy: 0, r: 8 },
				},
			],
			isMoving: () => true,
			trailOptions: { minDistance: 1 },
		});

		expect(runtime.get("shell")).toBe(trail);
		expect(trail).toHaveLength(2);
	});

	it("resolves a missing trailEffect per player without overriding explicit effects", () => {
		const runtime = new ArenaBallTrailRuntime();
		const consulted: number[] = [];

		runtime.recordSet({
			balls: [
				{
					id: "a",
					player: 0,
					ball: { x: 0, y: 0, vx: 1, vy: 0, r: 8 },
				},
				{
					id: "b",
					player: 1,
					ball: { x: 5, y: 0, vx: 1, vy: 0, r: 8 },
					trailEffect: "trail_fire",
				},
			],
			isMoving: () => true,
			trailOptions: { minDistance: 1 },
			trailEffectByPlayer: (player) => {
				consulted.push(player);
				return `p${player}`;
			},
		});

		// The resolver fills only the gap; an explicit per-ball effect is kept.
		expect(consulted).toEqual([0]);
	});

	it("builds stable trail objects for arena power balls", () => {
		const objects = buildArenaPowerBallTrailObjects(
			[
				{ player: 1, ball: { x: 10, y: 20, vx: 1, vy: 0, r: 4 } },
				{ player: 2, ball: { x: 30, y: 40, vx: 0, vy: 0, r: 4 } },
			],
			(ball) => ball.vx !== 0 || ball.vy !== 0,
		);

		expect(objects).toEqual([
			{
				id: "power-0",
				player: 1,
				x: 10,
				y: 20,
				moving: true,
			},
			{
				id: "power-1",
				player: 2,
				x: 30,
				y: 40,
				moving: false,
			},
		]);
	});

	it("preserves authoritative ids for projected power balls", () => {
		const [object] = buildArenaPowerBallTrailObjects(
			[
				{
					id: 42,
					player: 1,
					ball: { x: 10, y: 20, vx: 1, vy: 0, r: 4 },
				},
			],
			() => true,
		);

		expect(object.id).toBe(42);
	});

	it("reads rectangular arena trails for curling-style projectiles", () => {
		const runtime = new ArenaBallTrailRuntime();
		const arena = {
			sheetX: 50,
			sheetY: 100,
			sheetW: 200,
			sheetH: 400,
			houseFarCX: 0,
			houseFarCY: 0,
			houseNearCX: 0,
			houseNearCY: 0,
			houseRadii: [1, 1, 1, 1] as [number, number, number, number],
			deliveryX: 0,
			deliveryY: 0,
			hogX: 0,
			hogY: 0,
			orientation: "vertical" as const,
			scale: 1,
		};

		runtime.set("ball", [
			{ x: 50, y: 100 },
			{ x: 250, y: 500 },
			{ x: 300, y: 700 },
		]);

		expect(
			runtime.readRectNormalisedTrail("ball", arena, { clamp: true }),
		).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
			{ x: 1, y: 1 },
		]);
	});
});
