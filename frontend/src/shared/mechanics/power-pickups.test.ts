import { describe, expect, it, vi } from "vitest";

import {
	createEllipsePowerPickupArea,
	createRectPowerPickupArea,
	remapPowerPickups,
} from "./power-pickups";
import { PowerType } from "./power-system";

describe("power-pickups", () => {
	it("creates random points without relying on a Phaser global", () => {
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.25);
		const rect = createRectPowerPickupArea({ x: 10, y: 20, w: 40, h: 60 });
		const ellipse = createEllipsePowerPickupArea({
			cx: 100,
			cy: 80,
			rx: 30,
			ry: 20,
		});

		const rectPoint = rect.randomPoint();
		const ellipsePoint = ellipse.randomPoint();

		expect(rectPoint).toEqual({ x: 20, y: 35 });
		expect(ellipse.contains(ellipsePoint.x, ellipsePoint.y, 0)).toBe(true);
		spy.mockRestore();
	});

	it("remaps pickup coordinates without mutating the source list", () => {
		const source = [
			{ id: 7, type: PowerType.GIANT, x: 10, y: 15, r: 8 },
		];

		const remapped = remapPowerPickups(source, (pickup) => ({
			...pickup,
			x: pickup.x * 2,
			y: pickup.y * 3,
			r: pickup.r + 4,
		}));

		expect(remapped).toEqual([
			{ id: 7, type: PowerType.GIANT, x: 20, y: 45, r: 12 },
		]);
		expect(source).toEqual([
			{ id: 7, type: PowerType.GIANT, x: 10, y: 15, r: 8 },
		]);
	});
});
