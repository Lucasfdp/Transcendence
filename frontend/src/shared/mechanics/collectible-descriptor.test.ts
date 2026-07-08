import { describe, expect, it } from "vitest";

import {
	buildCircularCollectibleDescriptor,
	collectibleToBlocker,
	hitsCircularCollectible,
	remapCollectibleDescriptors,
	resolveCollectiblePosition,
	resolveCollectibleRadius,
} from "./collectible-descriptor";
import { PowerType } from "./power-system";

const arena = {
	cx: 100,
	cy: 80,
	rx: 50,
	ry: 40,
	scale: 2,
};

describe("collectible-descriptor", () => {
	it("resolves normalised collectible position and source radius", () => {
		const collectible = buildCircularCollectibleDescriptor({
			id: "power-1",
			type: "power-pickup",
			effect: PowerType.ROCKET,
			position: { mode: "normalised", x: 0.5, y: -0.25 },
			radius: 12,
			radiusUnit: "source",
			serialise: { id: 1, type: PowerType.ROCKET, nx: 0.5, ny: -0.25 },
		});

		expect(resolveCollectiblePosition(collectible, arena)).toEqual({
			x: 125,
			y: 70,
		});
		expect(resolveCollectibleRadius(collectible, arena)).toBe(24);
		expect(hitsCircularCollectible(collectible, arena, 130, 70, 2)).toBe(true);
		expect(hitsCircularCollectible(collectible, arena, 170, 70, 2)).toBe(false);
		expect(collectibleToBlocker(collectible, arena, 3)).toEqual({
			x: 125,
			y: 70,
			r: 27,
		});
	});

	it("remaps descriptors without mutating the source descriptor", () => {
		const source = buildCircularCollectibleDescriptor({
			id: 7,
			type: "power-pickup",
			effect: PowerType.GIANT,
			position: { mode: "absolute", x: 10, y: 20 },
			radius: 8,
			radiusUnit: "pixels",
			rendering: { label: "giant" },
		});

		const [remapped] = remapCollectibleDescriptors([source], (collectible) => ({
			...collectible,
			position: { ...collectible.position, x: collectible.position.x * 2 },
			geometry: {
				...collectible.geometry,
				radius: collectible.geometry.radius + 4,
			},
		}));

		expect(remapped.position.x).toBe(20);
		expect(remapped.geometry.radius).toBe(12);
		expect(source.position.x).toBe(10);
		expect(source.geometry.radius).toBe(8);
	});
});
