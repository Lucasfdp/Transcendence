import { describe, expect, it } from "vitest";

import type { ArenaPixels } from "../arenas/arena";
import { applyArenaBallPowerCycle } from "./arena-power-runtime";
import { PowerType } from "./power-system";

const arena = {
	cx: 500,
	cy: 400,
	rx: 300,
	ry: 220,
	scale: 1,
} as ArenaPixels;

describe("arena-power-runtime", () => {
	it("creates two auxiliary balls for splitter", () => {
		const entries = applyArenaBallPowerCycle(
			PowerType.SPLITTER,
			{ x: 100, y: 120, vx: 10, vy: 0, r: 20 },
			arena,
			2,
		);

		expect(entries).toHaveLength(2);
		expect(entries.every((entry) => entry.player === 2)).toBe(true);
		expect(entries.every((entry) => entry.ball.r < 20)).toBe(true);
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
});
