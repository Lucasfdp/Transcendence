import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "./casino.constants";
import {
	FLIP_HEADS_THRESHOLD,
	FLIP_MULTIPLIER,
	FLIP_SIDES,
	flipRtp,
	flipSide,
} from "./flip.constants";

describe("flip.constants", () => {
	describe("FLIP_SIDES", () => {
		it("should offer exactly the two shell sides", () => {
			expect([...FLIP_SIDES]).toEqual(["heads", "tails"]);
		});
	});

	describe("flipSide", () => {
		it("should land heads below the threshold", () => {
			expect(flipSide(0)).toBe("heads");
			expect(flipSide(FLIP_HEADS_THRESHOLD - 1e-9)).toBe("heads");
		});

		it("should land tails at and above the threshold", () => {
			expect(flipSide(FLIP_HEADS_THRESHOLD)).toBe("tails");
			expect(flipSide(0.999999)).toBe("tails");
		});

		it("should split the unit interval evenly between the two sides", () => {
			expect(FLIP_HEADS_THRESHOLD).toBe(0.5);
		});
	});

	describe("flipRtp", () => {
		it("should pay 2× so a fair coin is net-neutral", () => {
			expect(FLIP_MULTIPLIER).toBe(2);
		});

		it("should compute a return-to-player of exactly 1.0", () => {
			// EV for a correct pick = p(win) × multiplier + p(lose) × 0.
			expect(flipRtp()).toBeCloseTo(1, 10);
		});

		it("should be net-neutral for either pick", () => {
			for (const pick of FLIP_SIDES) {
				const pWin =
					pick === "heads"
						? FLIP_HEADS_THRESHOLD
						: 1 - FLIP_HEADS_THRESHOLD;
				expect(pWin * FLIP_MULTIPLIER).toBeCloseTo(1, 10);
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
