import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "./casino.constants";
import {
	DEFAULT_SHELLS,
	MONTE_SHELL_OPTIONS,
	monteRtp,
	winningShell,
} from "./monte.constants";

describe("monte.constants", () => {
	describe("MONTE_SHELL_OPTIONS", () => {
		it("should offer the 3/4/5-shell risk tiers", () => {
			expect([...MONTE_SHELL_OPTIONS]).toEqual([3, 4, 5]);
		});

		it("should default to three shells", () => {
			expect(DEFAULT_SHELLS).toBe(3);
			expect(MONTE_SHELL_OPTIONS).toContain(DEFAULT_SHELLS);
		});
	});

	describe("winningShell", () => {
		it("should map each equal band of [0,1) to its own shell", () => {
			for (const shells of MONTE_SHELL_OPTIONS) {
				for (let index = 0; index < shells; index++) {
					// Roll at the midpoint of shell `index`'s band.
					const roll = (index + 0.5) / shells;
					expect(winningShell(roll, shells)).toBe(index);
				}
			}
		});

		it("should return shell 0 for a roll of 0", () => {
			for (const shells of MONTE_SHELL_OPTIONS) {
				expect(winningShell(0, shells)).toBe(0);
			}
		});

		it("should clamp a roll approaching 1 to the last shell", () => {
			for (const shells of MONTE_SHELL_OPTIONS) {
				expect(winningShell(0.999999999, shells)).toBe(shells - 1);
			}
		});
	});

	describe("monteRtp", () => {
		it("should be net-neutral (1.0) for every shell count", () => {
			for (const shells of MONTE_SHELL_OPTIONS) {
				expect(monteRtp(shells)).toBeCloseTo(1, 10);
			}
		});

		it("should match an independent EV enumeration for every shell count", () => {
			for (const shells of MONTE_SHELL_OPTIONS) {
				const probability = 1 / shells;
				// A fixed pick wins only when the pearl is under it (one band).
				const ev = probability * shells; // (1/N) × N
				expect(monteRtp(shells)).toBeCloseTo(ev, 10);
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
