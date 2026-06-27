import {
	CARD_RARITIES,
	FOIL_CHANCE,
	RARITY_ODDS,
	cardsByRarity,
	findCard,
} from "./cards.constants";
import { rollCard, rollRarity } from "./cards.roll";

/** A deterministic rng that returns each queued value in turn. */
function seq(values: number[]): () => number {
	let i = 0;
	return () => values[i++ % values.length];
}

/** mulberry32 — small seeded PRNG for repeatable distribution tests. */
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe("cards.roll", () => {
	describe("rollRarity", () => {
		it("should return stone at the bottom of the range", () => {
			expect(rollRarity(seq([0]))).toBe("stone");
			expect(rollRarity(seq([0.59]))).toBe("stone");
		});

		it("should return bronze just past the stone threshold", () => {
			expect(rollRarity(seq([0.6]))).toBe("bronze");
			expect(rollRarity(seq([0.86]))).toBe("bronze");
		});

		it("should return jade just past the bronze threshold", () => {
			expect(rollRarity(seq([0.87]))).toBe("jade");
			expect(rollRarity(seq([0.96]))).toBe("jade");
		});

		it("should return gold at the top of the range", () => {
			expect(rollRarity(seq([0.97]))).toBe("gold");
			expect(rollRarity(seq([0.999999]))).toBe("gold");
		});

		it("should produce rarity outcomes within published odds over a large sample", () => {
			const rng = mulberry32(12345);
			const samples = 200_000;
			const counts: Record<string, number> = {
				stone: 0,
				bronze: 0,
				jade: 0,
				gold: 0,
			};
			for (let i = 0; i < samples; i++) counts[rollRarity(rng)]++;

			for (const rarity of CARD_RARITIES) {
				const observed = counts[rarity] / samples;
				expect(observed).toBeCloseTo(RARITY_ODDS[rarity], 2);
			}
		});
	});

	describe("rollCard", () => {
		it("should return a card belonging to the rolled rarity", () => {
			// rarity draw → gold, index draw → 0, foil draw → no foil
			const result = rollCard(seq([0.99, 0, 0.99]));
			const card = findCard(result.cardId);

			expect(card).toBeDefined();
			expect(card?.rarity).toBe("gold");
		});

		it("should mark the pull as foil when the foil draw is below FOIL_CHANCE", () => {
			const result = rollCard(seq([0, 0, FOIL_CHANCE / 2]));
			expect(result.foil).toBe(true);
		});

		it("should not mark the pull as foil when the foil draw is at or above FOIL_CHANCE", () => {
			const result = rollCard(seq([0, 0, FOIL_CHANCE]));
			expect(result.foil).toBe(false);
		});

		it("should always pick a real catalog card across many seeded rolls", () => {
			const rng = mulberry32(99);
			for (let i = 0; i < 1000; i++) {
				const result = rollCard(rng);
				expect(findCard(result.cardId)).toBeDefined();
			}
		});

		it("should keep the index in range even when the index draw is near 1", () => {
			// foil draw last; index draw 0.999 must not overflow the pool
			const result = rollCard(seq([0, 0.999999, 0.99]));
			const card = findCard(result.cardId);
			expect(card).toBeDefined();
			expect(cardsByRarity(card!.rarity).map((c) => c.id)).toContain(
				result.cardId,
			);
		});
	});
});
