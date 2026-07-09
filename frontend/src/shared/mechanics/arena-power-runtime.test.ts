import { describe, expect, it } from "vitest";

import type { ArenaPixels } from "../arenas/arena";
import {
	applyArenaBallPowerCycle,
	ArenaPowerRuntime,
	stepArenaBall,
} from "./arena-power-runtime";
import { PowerType } from "./power-system";

const arena = {
	cx: 500,
	cy: 400,
	rx: 300,
	ry: 220,
	scale: 1,
} as ArenaPixels;

describe("arena-power-runtime", () => {
	it("steps arena balls with friction override correction", () => {
		const ball = {
			x: arena.cx,
			y: arena.cy,
			vx: 100,
			vy: 0,
			r: 10,
			frictionOverride: 0.5,
		};

		const moving = stepArenaBall(ball, 16.67, arena);

		expect(moving).toBe(true);
		expect(ball.x).toBeCloseTo(arena.cx + 1.667, 3);
		expect(ball.vx).toBeCloseTo(50, 1);
	});

	it("creates two auxiliary balls for splitter", () => {
		const ball = { x: 100, y: 120, vx: 10, vy: 0, r: 20 };
		const entries = applyArenaBallPowerCycle(
			PowerType.SPLITTER,
			ball,
			arena,
			2,
		);

		expect(entries).toHaveLength(2);
		expect(entries.every((entry) => entry.player === 2)).toBe(true);
		expect(entries.every((entry) => entry.ball.r < 20)).toBe(true);
		expect(ball.x).toBeCloseTo(106.75, 5);
		expect(ball.y).toBe(120);
		expect(ball.vx).toBeCloseTo(8.5, 5);
		expect(ball.vy).toBe(0);
		expect(ball.r).toBe(15);
	});

	it("creates a mirrored auxiliary ball for mirror", () => {
		const entries = applyArenaBallPowerCycle(
			PowerType.MIRROR,
			{ x: 120, y: 200, vx: 15, vy: -4, r: 18 },
			arena,
			1,
		);

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			player: 1,
			ball: {
				x: arena.cx * 2 - 120,
				y: 200,
				vx: -15,
				vy: -4,
			},
		});
	});

	it("applies direct powers on the main ball without spawning auxiliaries", () => {
		const ball = { x: 0, y: 0, vx: 4, vy: 5, r: 10 };

		const entries = applyArenaBallPowerCycle(
			PowerType.GIANT,
			ball,
			arena,
			0,
		);

		expect(entries).toEqual([]);
		expect(ball.r).toBeGreaterThan(10);
	});

	it("owns power application and auxiliary ball registration", () => {
		const runtime = new ArenaPowerRuntime();
		const ball = { x: 100, y: 120, vx: 10, vy: 0, r: 20 };

		const spawned = runtime.applyPower(PowerType.SPLITTER, ball, arena, 2);

		expect(spawned).toBe(2);
		expect(runtime.length).toBe(2);
		expect(runtime.all().map((entry) => entry.player)).toEqual([2, 2]);
	});

	it("prunes settled auxiliary balls after firing onSettled once", () => {
		const runtime = new ArenaPowerRuntime();
		const settled: Array<{ player: number; radius: number }> = [];

		runtime.push({
			player: 1,
			ball: { x: 10, y: 15, vx: 0, vy: 0, r: 12 },
		});

		runtime.update(16, arena, {
			onSettled: ({ player, ball }) => {
				settled.push({ player, radius: ball.r });
			},
		});
		runtime.update(16, arena, {
			onSettled: ({ player, ball }) => {
				settled.push({ player, radius: ball.r });
			},
		});

		expect(settled).toEqual([{ player: 1, radius: 12 }]);
		expect(runtime.length).toBe(0);
	});
});
