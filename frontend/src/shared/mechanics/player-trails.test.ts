import type Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";

import { drawClassicPlayerTrail } from "./player-trails";

function createGraphicsMock() {
	return {
		fillCircle: vi.fn(),
		lineBetween: vi.fn(),
		lineStyle: vi.fn(),
	};
}

describe("drawClassicPlayerTrail", () => {
	it("draws one progressively faded segment for every consecutive pair", () => {
		const gfx = createGraphicsMock();
		const positions = [
			{ x: 10, y: 20 },
			{ x: 30, y: 40 },
			{ x: 50, y: 60 },
		];

		drawClassicPlayerTrail(
			gfx as unknown as Phaser.GameObjects.Graphics,
			positions,
			0xf0d979,
			{ scale: 1.5 },
		);

		expect(gfx.lineBetween.mock.calls).toEqual([
			[10, 20, 30, 40],
			[30, 40, 50, 60],
		]);
		expect(gfx.lineStyle.mock.calls).toEqual([
			[6, 0xf0d979, 0.1 + (1 / 3) * 0.38],
			[6, 0xf0d979, 0.1 + (2 / 3) * 0.38],
		]);
		expect(gfx.fillCircle).not.toHaveBeenCalled();

		const compactGfx = createGraphicsMock();
		drawClassicPlayerTrail(
			compactGfx as unknown as Phaser.GameObjects.Graphics,
			positions.slice(0, 2),
			0xf0d979,
			{ scale: 0.4 },
		);
		expect(compactGfx.lineStyle).toHaveBeenCalledWith(
			2,
			0xf0d979,
			0.1 + (1 / 2) * 0.38,
		);
	});

	it.each([{ positions: [] }, { positions: [{ x: 10, y: 20 }] }])(
		"does not draw a trail with fewer than two positions",
		({ positions }) => {
			const gfx = createGraphicsMock();

			drawClassicPlayerTrail(
				gfx as unknown as Phaser.GameObjects.Graphics,
				positions,
				0xf0d979,
			);

			expect(gfx.lineStyle).not.toHaveBeenCalled();
			expect(gfx.lineBetween).not.toHaveBeenCalled();
			expect(gfx.fillCircle).not.toHaveBeenCalled();
		},
	);

	it("keeps independent trails disconnected", () => {
		const gfx = createGraphicsMock();

		drawClassicPlayerTrail(
			gfx as unknown as Phaser.GameObjects.Graphics,
			[
				{ x: 1, y: 2 },
				{ x: 3, y: 4 },
			],
			0xf0d979,
		);
		drawClassicPlayerTrail(
			gfx as unknown as Phaser.GameObjects.Graphics,
			[
				{ x: 100, y: 200 },
				{ x: 300, y: 400 },
			],
			0x9fd890,
		);

		expect(gfx.lineBetween.mock.calls).toEqual([
			[1, 2, 3, 4],
			[100, 200, 300, 400],
		]);
	});
});
