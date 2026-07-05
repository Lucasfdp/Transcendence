import { describe, expect, it } from "vitest";
import { computeCardTilt, FOIL_SHINE_INTENSITY } from "./cardTilt";

describe("computeCardTilt", () => {
	it("should return zero rotation and centred shine when the pointer is at the card's centre", () => {
		const tilt = computeCardTilt(0.5, 0.5);
		expect(tilt.rotateX).toBe(0);
		expect(tilt.rotateY).toBe(0);
		expect(tilt.shineX).toBe(50);
		expect(tilt.shineY).toBe(50);
	});

	it("should tilt right (positive rotateY) when the pointer is past the horizontal centre", () => {
		const tilt = computeCardTilt(1, 0.5);
		expect(tilt.rotateY).toBeGreaterThan(0);
	});

	it("should tilt left (negative rotateY) when the pointer is before the horizontal centre", () => {
		const tilt = computeCardTilt(0, 0.5);
		expect(tilt.rotateY).toBeLessThan(0);
	});

	it("should tilt back (positive rotateX) when the pointer is above the vertical centre", () => {
		const tilt = computeCardTilt(0.5, 0);
		expect(tilt.rotateX).toBeGreaterThan(0);
	});

	it("should scale rotation magnitude with the maxTiltDeg argument", () => {
		const narrow = computeCardTilt(1, 0.5, 8);
		const wide = computeCardTilt(1, 0.5, 24);
		expect(wide.rotateY).toBeGreaterThan(narrow.rotateY);
	});

	it("should clamp out-of-range normalised coordinates into 0..1 before computing shine position", () => {
		const tilt = computeCardTilt(1.5, -0.5);
		expect(tilt.shineX).toBe(100);
		expect(tilt.shineY).toBe(0);
	});

	it("should default to a centred tilt when given NaN input instead of throwing", () => {
		expect(() => computeCardTilt(Number.NaN, Number.NaN)).not.toThrow();
		const tilt = computeCardTilt(Number.NaN, Number.NaN);
		expect(tilt.shineX).toBe(50);
		expect(tilt.shineY).toBe(50);
	});
});

describe("FOIL_SHINE_INTENSITY", () => {
	it("should define an intensity for every card rarity", () => {
		expect(Object.keys(FOIL_SHINE_INTENSITY).sort()).toEqual([
			"bronze",
			"gold",
			"jade",
			"stone",
		]);
	});

	it("should increase shine intensity as rarity increases from stone to gold", () => {
		const { stone, bronze, jade, gold } = FOIL_SHINE_INTENSITY;
		expect(stone).toBeLessThan(bronze);
		expect(bronze).toBeLessThan(jade);
		expect(jade).toBeLessThan(gold);
	});

	it("should keep every intensity within a valid 0..1 opacity range", () => {
		for (const value of Object.values(FOIL_SHINE_INTENSITY)) {
			expect(value).toBeGreaterThan(0);
			expect(value).toBeLessThanOrEqual(1);
		}
	});
});
