import { describe, expect, it } from "vitest";

import {
	frameFromOvalArena,
	frameFromRectArena,
	remapLaunchable,
	remapLaunchables,
	type RuntimeArenaFrame,
} from "../runtime/launchableRemap";

describe("launchable remap runtime helper", () => {
	it("remaps positions by normalised arena coordinates", () => {
		const from: RuntimeArenaFrame = {
			originX: 100,
			originY: 200,
			width: 400,
			height: 200,
			velocityScale: 2,
		};
		const to: RuntimeArenaFrame = {
			originX: 10,
			originY: 20,
			width: 800,
			height: 600,
			velocityScale: 4,
		};

		const remapped = remapLaunchable(
			{ id: "ball-1", x: 200, y: 250, vx: 20, vy: -10 },
			from,
			to,
		);

		expect(remapped).toMatchObject({
			id: "ball-1",
			x: 210,
			y: 170,
			nx: 0.25,
			ny: 0.25,
		});
	});

	it("preserves normalised velocity when the target arena scale changes", () => {
		const remapped = remapLaunchable(
			{ id: "ball-1", x: 0, y: 0, vx: 90, vy: -30 },
			{ originX: 0, originY: 0, width: 100, height: 100, velocityScale: 3 },
			{ originX: 0, originY: 0, width: 200, height: 200, velocityScale: 5 },
		);

		expect(remapped.nvx).toBe(30);
		expect(remapped.nvy).toBe(-10);
		expect(remapped.vx).toBe(150);
		expect(remapped.vy).toBe(-50);
	});

	it("builds frames from oval and rectangular arena shapes", () => {
		expect(
			frameFromOvalArena({ cx: 500, cy: 400, rx: 200, ry: 100, scale: 2 }),
		).toEqual({
			originX: 300,
			originY: 300,
			width: 400,
			height: 200,
			velocityScale: 2,
		});
		expect(
			frameFromRectArena({
				sheetX: 40,
				sheetY: 60,
				sheetW: 800,
				sheetH: 320,
				scale: 1.5,
			}),
		).toEqual({
			originX: 40,
			originY: 60,
			width: 800,
			height: 320,
			velocityScale: 1.5,
		});
	});

	it("keeps launchable-specific fields when remapping batches", () => {
		const launchables = [
			{ id: "a", x: 5, y: 5, vx: 1, vy: 2, ownerId: "p1" },
			{ id: "b", x: 10, y: 10, vx: 3, vy: 4, ownerId: "p2" },
		] as const;

		const remapped = remapLaunchables(
			launchables,
			{ originX: 0, originY: 0, width: 10, height: 10, velocityScale: 1 },
			{ originX: 0, originY: 0, width: 20, height: 20, velocityScale: 2 },
		);

		expect(remapped).toHaveLength(2);
		expect(remapped[0]).toMatchObject({
			id: "a",
			ownerId: "p1",
			x: 10,
			y: 10,
			vx: 2,
			vy: 4,
		});
	});

	it("rejects invalid arena frames", () => {
		expect(() =>
			remapLaunchable(
				{ id: "bad", x: 0, y: 0, vx: 0, vy: 0 },
				{ originX: 0, originY: 0, width: 0, height: 10, velocityScale: 1 },
				{ originX: 0, originY: 0, width: 10, height: 10, velocityScale: 1 },
			),
		).toThrow("size must be positive");
	});
});
