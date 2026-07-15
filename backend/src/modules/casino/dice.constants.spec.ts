import {
	DICE_DIRECTIONS,
	DICE_MAX_VALUE,
	DICE_MIN_VALUE,
	DICE_RANGE,
	diceMultiplier,
	diceRtp,
	diceValue,
	diceWin,
	diceWinningOutcomes,
	targetBounds,
} from "./dice.constants";

describe("dice.constants", () => {
	describe("DICE_DIRECTIONS", () => {
		it("should offer exactly the two betting directions", () => {
			expect([...DICE_DIRECTIONS]).toEqual(["under", "over"]);
		});
	});

	describe("DICE_RANGE", () => {
		it("should span exactly 100 equally-likely values (0..99)", () => {
			expect(DICE_RANGE).toBe(100);
			expect(DICE_MIN_VALUE).toBe(0);
			expect(DICE_MAX_VALUE).toBe(99);
		});
	});

	describe("diceValue", () => {
		it("should map a roll of 0 to value 0", () => {
			expect(diceValue(0)).toBe(0);
		});

		it("should map a roll just under 1 to value 99", () => {
			expect(diceValue(0.999999)).toBe(99);
		});

		it("should clamp a roll at or beyond 1 to the maximum value", () => {
			expect(diceValue(1)).toBe(99);
			expect(diceValue(5)).toBe(99);
		});

		it("should map each 1/100 band to its own integer value", () => {
			for (let value = 0; value < DICE_RANGE; value++) {
				const roll = (value + 0.5) / DICE_RANGE;
				expect(diceValue(roll)).toBe(value);
			}
		});
	});

	describe("targetBounds", () => {
		it("should allow under targets 1..99", () => {
			expect(targetBounds("under")).toEqual({ min: 1, max: 99 });
		});

		it("should allow over targets 0..98", () => {
			expect(targetBounds("over")).toEqual({ min: 0, max: 98 });
		});
	});

	describe("diceWinningOutcomes", () => {
		it("should count winning outcomes for under as the target itself", () => {
			expect(diceWinningOutcomes("under", 1)).toBe(1);
			expect(diceWinningOutcomes("under", 50)).toBe(50);
			expect(diceWinningOutcomes("under", 99)).toBe(99);
		});

		it("should count winning outcomes for over as the remaining space", () => {
			expect(diceWinningOutcomes("over", 0)).toBe(99);
			expect(diceWinningOutcomes("over", 50)).toBe(49);
			expect(diceWinningOutcomes("over", 98)).toBe(1);
		});
	});

	describe("diceWin", () => {
		it("should win under when the value is strictly less than the target", () => {
			expect(diceWin("under", 50, 49)).toBe(true);
			expect(diceWin("under", 50, 50)).toBe(false);
			expect(diceWin("under", 50, 51)).toBe(false);
		});

		it("should win over when the value is strictly greater than the target", () => {
			expect(diceWin("over", 50, 51)).toBe(true);
			expect(diceWin("over", 50, 50)).toBe(false);
			expect(diceWin("over", 50, 49)).toBe(false);
		});
	});

	describe("diceMultiplier", () => {
		it("should pay 100/target for an under bet", () => {
			expect(diceMultiplier("under", 50)).toBeCloseTo(2, 10);
			expect(diceMultiplier("under", 25)).toBeCloseTo(4, 10);
			expect(diceMultiplier("under", 1)).toBeCloseTo(100, 10);
		});

		it("should pay 100/(99-target) for an over bet", () => {
			expect(diceMultiplier("over", 49)).toBeCloseTo(2, 10);
			expect(diceMultiplier("over", 74)).toBeCloseTo(4, 10);
			expect(diceMultiplier("over", 98)).toBeCloseTo(100, 10);
		});
	});

	describe("diceRtp", () => {
		it("should be net-neutral (1.0) for every valid under target", () => {
			for (let target = 1; target <= 99; target++) {
				expect(diceRtp("under", target)).toBeCloseTo(1, 10);
			}
		});

		it("should be net-neutral (1.0) for every valid over target", () => {
			for (let target = 0; target <= 98; target++) {
				expect(diceRtp("over", target)).toBeCloseTo(1, 10);
			}
		});
	});
});
