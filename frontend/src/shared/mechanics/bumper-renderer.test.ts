import { describe, expect, it, vi } from "vitest";
import { BUMPER_FLASH_MS, drawBumper } from "./bumper-renderer";

function createGraphics() {
	return {
		fillStyle: vi.fn(),
		fillCircle: vi.fn(),
		lineStyle: vi.fn(),
		strokeCircle: vi.fn(),
	};
}

describe("drawBumper", () => {
	it("draws the shared dark and gold bumper", () => {
		const gfx = createGraphics();

		drawBumper(gfx as never, 40, 60, 20, 2);

		expect(gfx.fillStyle.mock.calls).toEqual([
			[0x2a1a08, 1],
			[0xd4a843, 0.6],
		]);
		expect(gfx.fillCircle.mock.calls).toEqual([
			[40, 60, 20],
			[40, 60, 4.4],
		]);
		expect(gfx.lineStyle).toHaveBeenCalledWith(5, 0xd4a843, 0.85);
		expect(gfx.strokeCircle).toHaveBeenCalledWith(40, 60, 20);
	});

	it("adds the Temple Curling impact flash", () => {
		const gfx = createGraphics();

		drawBumper(gfx as never, 40, 60, 20, 1, BUMPER_FLASH_MS);

		expect(gfx.fillStyle.mock.calls[0]).toEqual([0xffd700, 0.55]);
		expect(gfx.fillCircle.mock.calls[0]).toEqual([40, 60, 35]);
		expect(gfx.lineStyle).toHaveBeenCalledWith(2.5, 0xd4a843, 1);
		expect(gfx.fillStyle.mock.calls.at(-1)).toEqual([0xd4a843, 1]);
	});
});
