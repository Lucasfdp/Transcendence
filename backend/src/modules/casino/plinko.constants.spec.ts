import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "./casino.constants";
import {
	DEFAULT_ROWS,
	PLINKO_RISK_BASE,
	PLINKO_ROWS_OPTIONS,
	binomial,
	bucketIndexFromRolls,
	bucketMultiplier,
	bucketProbability,
	evaluateDrop,
	plinkoRtp,
} from "./plinko.constants";

describe("plinko.constants", () => {
	describe("PLINKO_ROWS_OPTIONS", () => {
		it("should offer exactly the three risk tiers", () => {
			expect([...PLINKO_ROWS_OPTIONS]).toEqual([8, 12, 16]);
		});

		it("should default to the lowest-risk tier", () => {
			expect(DEFAULT_ROWS).toBe(8);
			expect(PLINKO_ROWS_OPTIONS).toContain(DEFAULT_ROWS);
		});
	});

	describe("PLINKO_RISK_BASE", () => {
		it("should be greater than 1 so edge buckets weigh more than center", () => {
			expect(PLINKO_RISK_BASE).toBeGreaterThan(1);
		});
	});

	describe("binomial", () => {
		it("should compute small binomial coefficients exactly", () => {
			expect(binomial(8, 0)).toBe(1);
			expect(binomial(8, 1)).toBe(8);
			expect(binomial(8, 4)).toBe(70);
			expect(binomial(8, 8)).toBe(1);
		});

		it("should be symmetric: C(n,k) === C(n,n-k)", () => {
			for (const rows of PLINKO_ROWS_OPTIONS) {
				for (let k = 0; k <= rows; k++) {
					expect(binomial(rows, k)).toBe(binomial(rows, rows - k));
				}
			}
		});

		it("should return 0 outside the valid range", () => {
			expect(binomial(8, -1)).toBe(0);
			expect(binomial(8, 9)).toBe(0);
		});
	});

	describe("bucketProbability", () => {
		it("should sum to 1 over all buckets for every row-count", () => {
			for (const rows of PLINKO_ROWS_OPTIONS) {
				let sum = 0;
				for (let k = 0; k <= rows; k++) sum += bucketProbability(rows, k);
				expect(sum).toBeCloseTo(1, 10);
			}
		});

		it("should be symmetric: p_k === p_(rows-k)", () => {
			for (const rows of PLINKO_ROWS_OPTIONS) {
				for (let k = 0; k <= rows; k++) {
					expect(bucketProbability(rows, k)).toBeCloseTo(
						bucketProbability(rows, rows - k),
						12,
					);
				}
			}
		});

		it("should match C(rows,k)/2^rows", () => {
			expect(bucketProbability(8, 4)).toBeCloseTo(70 / 256, 10);
		});
	});

	describe("bucketIndexFromRolls", () => {
		it("should return 0 when every roll lands left", () => {
			expect(bucketIndexFromRolls([0, 0.1, 0.49, 0, 0.2])).toBe(0);
		});

		it("should return rows when every roll lands right", () => {
			expect(bucketIndexFromRolls([0.5, 0.9, 0.51, 0.5, 0.99])).toBe(5);
		});

		it("should count rolls >= 0.5 as right moves in a mixed case", () => {
			expect(bucketIndexFromRolls([0.1, 0.5, 0.49, 0.7, 0.999])).toBe(3);
		});
	});

	describe("bucketMultiplier", () => {
		it("should pay more at the edges than the center for every row-count", () => {
			for (const rows of PLINKO_ROWS_OPTIONS) {
				const center = bucketMultiplier(rows, Math.floor(rows / 2));
				const edge = bucketMultiplier(rows, 0);
				expect(edge).toBeGreaterThan(center);
			}
		});

		it("should be symmetric: M_k === M_(rows-k)", () => {
			for (const rows of PLINKO_ROWS_OPTIONS) {
				for (let k = 0; k <= rows; k++) {
					expect(bucketMultiplier(rows, k)).toBeCloseTo(
						bucketMultiplier(rows, rows - k),
						10,
					);
				}
			}
		});

		it("should never pay zero — variance comes from center vs edge, not total loss", () => {
			for (const rows of PLINKO_ROWS_OPTIONS) {
				for (let k = 0; k <= rows; k++) {
					expect(bucketMultiplier(rows, k)).toBeGreaterThan(0);
				}
			}
		});
	});

	describe("evaluateDrop", () => {
		it("should return the bucket id and its multiplier for an all-left drop", () => {
			const rolls = Array.from({ length: 8 }, () => 0);
			const result = evaluateDrop(8, rolls);
			expect(result.outcomeId).toBe("bucket-0");
			expect(result.multiplier).toBeCloseTo(bucketMultiplier(8, 0), 10);
		});

		it("should return the bucket id and its multiplier for an all-right drop", () => {
			const rolls = Array.from({ length: 8 }, () => 0.99);
			const result = evaluateDrop(8, rolls);
			expect(result.outcomeId).toBe("bucket-8");
			expect(result.multiplier).toBeCloseTo(bucketMultiplier(8, 8), 10);
		});

		it("should resolve a mixed drop to the matching center bucket", () => {
			const rolls = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5]; // 4 right → bucket 4
			const result = evaluateDrop(8, rolls);
			expect(result.outcomeId).toBe("bucket-4");
			expect(result.multiplier).toBeCloseTo(bucketMultiplier(8, 4), 10);
		});
	});

	describe("plinkoRtp", () => {
		it("should be net-neutral by enumeration for every row-count", () => {
			for (const rows of PLINKO_ROWS_OPTIONS) {
				let rtp = 0;
				for (let k = 0; k <= rows; k++) {
					rtp += bucketProbability(rows, k) * bucketMultiplier(rows, k);
				}
				expect(rtp).toBeCloseTo(1, 9);
				expect(plinkoRtp(rows)).toBeCloseTo(rtp, 12);
			}
		});

		it("should land within the net-neutral band [0.99, 1.0] for every row-count", () => {
			for (const rows of PLINKO_ROWS_OPTIONS) {
				expect(plinkoRtp(rows)).toBeGreaterThanOrEqual(0.99);
				expect(plinkoRtp(rows)).toBeLessThanOrEqual(1 + 1e-9);
			}
		});

		it("should match the binomial distribution by enumerating all 2^8 paths for R=8", () => {
			const rows = 8;
			const bucketCounts = new Array<number>(rows + 1).fill(0);
			const totalPaths = 2 ** rows;
			for (let path = 0; path < totalPaths; path++) {
				let rightMoves = 0;
				for (let bit = 0; bit < rows; bit++) {
					if ((path >> bit) & 1) rightMoves++;
				}
				bucketCounts[rightMoves]++;
			}
			for (let k = 0; k <= rows; k++) {
				const empiricalProbability = bucketCounts[k] / totalPaths;
				expect(empiricalProbability).toBeCloseTo(bucketProbability(rows, k), 10);
			}
		});
	});

	describe("wager bounds", () => {
		it("should reuse the shared whole-coin wager bounds", () => {
			expect(Number.isInteger(MIN_WAGER_COINS)).toBe(true);
			expect(MAX_WAGER_COINS).toBeGreaterThan(MIN_WAGER_COINS);
		});
	});
});
