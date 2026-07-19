import type Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";

import { drawPlayerRing } from "./game-ui";

function graphicsMock(): Phaser.GameObjects.Graphics {
	return {
		lineStyle: vi.fn(),
		strokeCircle: vi.fn(),
	} as unknown as Phaser.GameObjects.Graphics;
}

describe("drawPlayerRing", () => {
	it("draws every ring layer on the physics radius", () => {
		const gfx = graphicsMock();

		drawPlayerRing(gfx, 12, 24, 30, 0x5b9bd1);

		expect(gfx.strokeCircle).toHaveBeenCalledTimes(3);
		expect(gfx.strokeCircle).toHaveBeenNthCalledWith(1, 12, 24, 30);
		expect(gfx.strokeCircle).toHaveBeenNthCalledWith(2, 12, 24, 30);
		expect(gfx.strokeCircle).toHaveBeenNthCalledWith(3, 12, 24, 30);
	});

	it("omits the dark separator for inactive shells", () => {
		const gfx = graphicsMock();

		drawPlayerRing(gfx, 12, 24, 30, 0x5b9bd1, 1, false);

		expect(gfx.strokeCircle).toHaveBeenCalledTimes(2);
		expect(gfx.lineStyle).not.toHaveBeenCalledWith(
			expect.any(Number),
			0x05080c,
			expect.any(Number),
		);
	});
});
