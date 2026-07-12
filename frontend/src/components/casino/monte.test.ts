import { describe, expect, it } from "vitest";
import {
	MONTE_FASTEST_SWAP_MS,
	MONTE_FIRST_SWAP_MS,
	monteSwapPairs,
	monteSwapDurations,
	swapTwoCupPositions,
} from "./monte";

describe("monte shuffle helpers", () => {
	it("swaps exactly two cup positions without mutating the input", () => {
		const cups = ["cup-a", "cup-b", "cup-c"];
		const swapped = swapTwoCupPositions(cups, 0, 2);

		expect(swapped).toEqual(["cup-c", "cup-b", "cup-a"]);
		expect(cups).toEqual(["cup-a", "cup-b", "cup-c"]);
		expect(new Set(swapped)).toEqual(new Set(cups));
	});

	it("accelerates from the first slow swap to the fastest swap", () => {
		const durations = monteSwapDurations(8);

		expect(durations[0]).toBe(MONTE_FIRST_SWAP_MS);
		expect(durations[durations.length - 1]).toBe(MONTE_FASTEST_SWAP_MS);
		expect(durations.every((duration, index) =>
			index === 0 ? true : duration <= durations[index - 1],
		)).toBe(true);
	});

	it("builds random valid swap pairs from the supplied random source", () => {
		const values = [0, 0.4, 0.99];
		const pairs = monteSwapPairs(3, () => values.shift() ?? 0);

		expect(pairs).toEqual([
			[0, 1],
			[0, 2],
			[1, 2],
		]);
		expect(pairs.every(([first, second]) => first !== second)).toBe(true);
	});
});
