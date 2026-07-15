import {
	PAYTABLE,
	SLOT_REEL_COUNT,
	SLOT_SYMBOLS,
	evaluate,
	selectSymbol,
	slotTotalWeight,
	slotsRtp,
} from "./slots.constants";

describe("slots.constants", () => {
	describe("SLOT_SYMBOLS", () => {
		it("should declare a non-trivial reel of symbols", () => {
			expect(SLOT_SYMBOLS.length).toBeGreaterThanOrEqual(3);
		});

		it("should give every symbol a unique id and a positive weight", () => {
			const ids = SLOT_SYMBOLS.map((s) => s.id);
			expect(new Set(ids).size).toBe(ids.length);
			for (const symbol of SLOT_SYMBOLS) {
				expect(symbol.weight).toBeGreaterThan(0);
				expect(Number.isInteger(symbol.weight)).toBe(true);
			}
		});

		it("should use uniform weights so the RTP is closed-form", () => {
			const first = SLOT_SYMBOLS[0].weight;
			for (const symbol of SLOT_SYMBOLS) {
				expect(symbol.weight).toBe(first);
			}
		});

		it("should spin three reels", () => {
			expect(SLOT_REEL_COUNT).toBe(3);
		});
	});

	describe("PAYTABLE", () => {
		it("should list a three-of-a-kind payout for every symbol", () => {
			for (const symbol of SLOT_SYMBOLS) {
				expect(PAYTABLE[symbol.id]).toBeGreaterThan(0);
			}
		});

		it("should sum to the reel-space size so uniform reels give RTP 1.0", () => {
			// With uniform weights, RTP = (1/N^reels) · Σ payouts. For RTP = 1 the
			// payouts must sum to N^reels = 6^3 / 6 ... see slotsRtp; here Σ = 216.
			const sum = SLOT_SYMBOLS.reduce((acc, s) => acc + PAYTABLE[s.id], 0);
			expect(sum).toBe(216);
		});
	});

	describe("selectSymbol", () => {
		it("should return the first symbol for a roll of 0", () => {
			expect(selectSymbol(0)).toBe(SLOT_SYMBOLS[0]);
		});

		it("should map each weight band to its own symbol", () => {
			const total = slotTotalWeight();
			let cumulative = 0;
			for (const symbol of SLOT_SYMBOLS) {
				const roll = (cumulative + symbol.weight / 2) / total;
				expect(selectSymbol(roll)).toBe(symbol);
				cumulative += symbol.weight;
			}
		});

		it("should clamp a roll at or beyond 1 to the last symbol", () => {
			const last = SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1];
			expect(selectSymbol(1)).toBe(last);
			expect(selectSymbol(5)).toBe(last);
		});

		it("should clamp a negative roll to the first symbol", () => {
			expect(selectSymbol(-1)).toBe(SLOT_SYMBOLS[0]);
		});
	});

	describe("evaluate", () => {
		it("should pay the symbol's multiplier for three of a kind", () => {
			for (const symbol of SLOT_SYMBOLS) {
				const result = evaluate([symbol.id, symbol.id, symbol.id]);
				expect(result.outcomeId).toBe(
					`${symbol.id}|${symbol.id}|${symbol.id}`,
				);
				expect(result.multiplier).toBe(PAYTABLE[symbol.id]);
			}
		});

		it("should pay nothing when the three reels differ", () => {
			const [a, b, c] = SLOT_SYMBOLS;
			expect(evaluate([a.id, b.id, c.id]).multiplier).toBe(0);
			expect(evaluate([a.id, a.id, b.id]).multiplier).toBe(0);
		});

		it("should join the symbols into a stable outcome id", () => {
			const [a, b, c] = SLOT_SYMBOLS;
			expect(evaluate([a.id, b.id, c.id]).outcomeId).toBe(
				`${a.id}|${b.id}|${c.id}`,
			);
		});
	});

	describe("slotsRtp", () => {
		it("should be net-neutral by full enumeration of the reel space", () => {
			// Independently enumerate all SLOT_SYMBOLS^3 weighted combinations.
			const total = slotTotalWeight();
			let rtp = 0;
			for (const a of SLOT_SYMBOLS) {
				for (const b of SLOT_SYMBOLS) {
					for (const c of SLOT_SYMBOLS) {
						const probability =
							(a.weight / total) *
							(b.weight / total) *
							(c.weight / total);
						rtp += probability * evaluate([a.id, b.id, c.id]).multiplier;
					}
				}
			}
			expect(rtp).toBeCloseTo(1, 10);
			expect(slotsRtp()).toBeCloseTo(rtp, 12);
		});

		it("should land within the net-neutral band [0.99, 1.0]", () => {
			expect(slotsRtp()).toBeGreaterThanOrEqual(0.99);
			expect(slotsRtp()).toBeLessThanOrEqual(1 + 1e-9);
		});
	});
});
