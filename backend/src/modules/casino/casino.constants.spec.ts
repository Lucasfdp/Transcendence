import {
	FREE_SPIN_STAKE_COINS,
	MAX_WAGER_COINS,
	MIN_WAGER_COINS,
	TARGET_RTP,
	WHEEL_SEGMENTS,
	rollSegment,
	selectSegment,
	totalWeight,
	wheelRtp,
} from "./casino.constants";

/** Deterministic rng yielding each queued value in turn (wraps around). */
function seq(values: number[]): () => number {
	let i = 0;
	return () => values[i++ % values.length];
}

describe("casino.constants", () => {
	describe("WHEEL_SEGMENTS", () => {
		it("should declare at least two segments so the wheel has variety", () => {
			expect(WHEEL_SEGMENTS.length).toBeGreaterThanOrEqual(2);
		});

		it("should give every segment a unique id", () => {
			const ids = WHEEL_SEGMENTS.map((s) => s.id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it("should give every segment a non-empty label", () => {
			for (const s of WHEEL_SEGMENTS) {
				expect(s.label.length).toBeGreaterThan(0);
			}
		});

		it("should use a positive integer weight for every segment", () => {
			for (const s of WHEEL_SEGMENTS) {
				expect(Number.isInteger(s.weight)).toBe(true);
				expect(s.weight).toBeGreaterThan(0);
			}
		});

		it("should use a non-negative multiplier for every segment", () => {
			for (const s of WHEEL_SEGMENTS) {
				expect(s.multiplier).toBeGreaterThanOrEqual(0);
			}
		});

		it("should include a losing (0x) segment so a wager can be lost", () => {
			expect(WHEEL_SEGMENTS.some((s) => s.multiplier === 0)).toBe(true);
		});

		it("should include a jackpot (>1x) segment so a wager can grow", () => {
			expect(WHEEL_SEGMENTS.some((s) => s.multiplier > 1)).toBe(true);
		});
	});

	describe("totalWeight", () => {
		it("should sum every segment weight", () => {
			const expected = WHEEL_SEGMENTS.reduce((sum, s) => sum + s.weight, 0);
			expect(totalWeight()).toBe(expected);
		});

		it("should be strictly positive", () => {
			expect(totalWeight()).toBeGreaterThan(0);
		});
	});

	describe("wheelRtp", () => {
		it("should declare a net-neutral target return of 1.0", () => {
			expect(TARGET_RTP).toBe(1);
		});

		it("should compute a weighted return equal to the target RTP", () => {
			expect(wheelRtp()).toBeCloseTo(TARGET_RTP, 10);
		});
	});

	describe("selectSegment", () => {
		it("should return the first segment for a roll of 0", () => {
			expect(selectSegment(0)).toBe(WHEEL_SEGMENTS[0]);
		});

		it("should return the last segment for a roll approaching 1", () => {
			expect(selectSegment(0.999999999)).toBe(
				WHEEL_SEGMENTS[WHEEL_SEGMENTS.length - 1],
			);
		});

		it("should map each weight band to its own segment", () => {
			const total = totalWeight();
			let cumulative = 0;
			for (const segment of WHEEL_SEGMENTS) {
				// Roll at the midpoint of this segment's band.
				const roll = (cumulative + segment.weight / 2) / total;
				expect(selectSegment(roll)).toBe(segment);
				cumulative += segment.weight;
			}
		});

		it("should clamp a roll at or beyond 1 to the last segment", () => {
			expect(selectSegment(1)).toBe(
				WHEEL_SEGMENTS[WHEEL_SEGMENTS.length - 1],
			);
			expect(selectSegment(5)).toBe(
				WHEEL_SEGMENTS[WHEEL_SEGMENTS.length - 1],
			);
		});

		it("should clamp a negative roll to the first segment", () => {
			expect(selectSegment(-1)).toBe(WHEEL_SEGMENTS[0]);
		});
	});

	describe("rollSegment", () => {
		it("should draw a single value from the rng and select that segment", () => {
			const rng = seq([0]);
			expect(rollSegment(rng)).toBe(WHEEL_SEGMENTS[0]);
		});

		it("should return a segment that belongs to the wheel", () => {
			const rng = seq([0.42]);
			expect(WHEEL_SEGMENTS).toContain(rollSegment(rng));
		});
	});

	describe("wager economy constants", () => {
		it("should set a positive free-spin stake (the daily faucet)", () => {
			expect(FREE_SPIN_STAKE_COINS).toBeGreaterThan(0);
			expect(Number.isInteger(FREE_SPIN_STAKE_COINS)).toBe(true);
		});

		it("should set positive whole-coin wager bounds with min below max", () => {
			expect(Number.isInteger(MIN_WAGER_COINS)).toBe(true);
			expect(Number.isInteger(MAX_WAGER_COINS)).toBe(true);
			expect(MIN_WAGER_COINS).toBeGreaterThan(0);
			expect(MAX_WAGER_COINS).toBeGreaterThan(MIN_WAGER_COINS);
		});
	});
});
