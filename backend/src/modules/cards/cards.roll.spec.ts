import {
	CARD_RARITIES,
	FOIL_CHANCE,
	PRISMATIC_CHANCE_FRACTION,
	RARITY_ODDS,
	cardsByRarity,
	findCard,
	findPackTier,
} from "./cards.constants";
import { rollCard, rollGuaranteedCard, rollRarity } from "./cards.roll";

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
		const basic = findPackTier("basic")!;

		it("should return a card belonging to the rolled rarity", () => {
			// rarity draw → gold, index draw → 0, foil draw → no foil
			const result = rollCard(seq([0.99, 0, 0.99]), basic);
			const card = findCard(result.cardId);

			expect(card).toBeDefined();
			expect(card?.rarity).toBe("gold");
		});

		it("should mark the pull as foil when the foil draw is below FOIL_CHANCE", () => {
			const result = rollCard(seq([0, 0, FOIL_CHANCE / 2]), basic);
			expect(result.foil).toBe(true);
		});

		it("should not mark the pull as foil when the foil draw is at or above FOIL_CHANCE", () => {
			const result = rollCard(seq([0, 0, FOIL_CHANCE]), basic);
			expect(result.foil).toBe(false);
		});

		it("should always pick a real catalogue card across many seeded rolls", () => {
			const rng = mulberry32(99);
			for (let i = 0; i < 1000; i++) {
				const result = rollCard(rng, basic);
				expect(findCard(result.cardId)).toBeDefined();
			}
		});

		it("should keep the index in range even when the index draw is near 1", () => {
			// foil draw last; index draw 0.999 must not overflow the pool
			const result = rollCard(seq([0, 0.999999, 0.99]), basic);
			const card = findCard(result.cardId);
			expect(card).toBeDefined();
			expect(cardsByRarity(card!.rarity).map((c) => c.id)).toContain(
				result.cardId,
			);
		});
	});

	describe("rollRarity with a custom odds table", () => {
		const deluxe = findPackTier("deluxe")!;

		it("should roll against the given tier's odds table, not the default", () => {
			// 0.5 is "stone" under the basic RARITY_ODDS (cum .6) but "bronze"
			// under deluxe's odds (stone cum .35, bronze cum .70).
			expect(rollRarity(seq([0.5]))).toBe("stone");
			expect(rollRarity(seq([0.5]), deluxe.rarityOdds)).toBe("bronze");
		});
	});

	describe("rollCard with a tier", () => {
		const basic = findPackTier("basic")!;
		const legendary = findPackTier("legendary")!;

		it("should roll rarity against the given tier's odds table", () => {
			// legendary odds: stone .15 (cum .15), bronze .30 (cum .45),
			// jade .35 (cum .80), gold .20 (cum 1) — 0.5 lands in the jade band.
			const result = rollCard(seq([0.5, 0, 0.99]), legendary);
			const card = findCard(result.cardId);
			expect(card?.rarity).toBe("jade");
		});

		it("should check foil against the given tier's own foil chance, not another tier's", () => {
			const midDraw = (FOIL_CHANCE + legendary.foilChance) / 2;
			const basicResult = rollCard(seq([0, 0, midDraw]), basic);
			const legendaryResult = rollCard(seq([0, 0, midDraw]), legendary);

			expect(basicResult.foil).toBe(false);
			expect(legendaryResult.foil).toBe(true);
		});
	});

	describe("rollGuaranteedCard", () => {
		const legendary = findPackTier("legendary")!;

		it("should roll a card at or above the guaranteed rarity even from a draw that would otherwise roll the lowest rarity", () => {
			// rng() = 0 would roll "stone" via an unrestricted rollCard, but the
			// guaranteed slot must still land gold-or-better.
			const result = rollGuaranteedCard(seq([0, 0, 0.99]), legendary, "gold");
			const card = findCard(result.cardId);
			expect(card?.rarity).toBe("gold");
		});

		it("should never return a rarity below minRarity across many seeded rng draws", () => {
			const rng = mulberry32(2024);
			for (let i = 0; i < 500; i++) {
				const result = rollGuaranteedCard(rng, legendary, "jade");
				const card = findCard(result.cardId);
				expect(["jade", "gold"]).toContain(card?.rarity);
			}
		});

		it("should still check foil against the tier's own foil chance on the guaranteed slot", () => {
			const result = rollGuaranteedCard(
				seq([0.99, 0, legendary.foilChance / 2]),
				legendary,
				"gold",
			);
			expect(result.foil).toBe(true);
		});
	});

	describe("prismatic — rollCard", () => {
		const basic = findPackTier("basic")!;

		it("should never mark a non-gold card as prismatic, even when foil is true", () => {
			// rarity draw 0 → stone (basic cum .6); foil draw 0 < FOIL_CHANCE → foil.
			const result = rollCard(seq([0, 0, 0]), basic);
			const card = findCard(result.cardId);
			expect(card?.rarity).toBe("stone");
			expect(result.foil).toBe(true);
			expect(result.prismatic).toBe(false);
		});

		it("should never mark a gold card as prismatic when the foil check itself failed", () => {
			// rarity draw 0.99 → gold; foil draw at FOIL_CHANCE → not foil.
			const result = rollCard(seq([0.99, 0, FOIL_CHANCE]), basic);
			const card = findCard(result.cardId);
			expect(card?.rarity).toBe("gold");
			expect(result.foil).toBe(false);
			expect(result.prismatic).toBe(false);
		});

		it("should mark a gold+foil pull as prismatic when the prismatic draw is below PRISMATIC_CHANCE_FRACTION", () => {
			const result = rollCard(
				seq([0.99, 0, 0, PRISMATIC_CHANCE_FRACTION / 2]),
				basic,
			);
			expect(result.foil).toBe(true);
			expect(result.prismatic).toBe(true);
		});

		it("should not mark a gold+foil pull as prismatic when the prismatic draw is at or above PRISMATIC_CHANCE_FRACTION", () => {
			const result = rollCard(
				seq([0.99, 0, 0, PRISMATIC_CHANCE_FRACTION]),
				basic,
			);
			expect(result.foil).toBe(true);
			expect(result.prismatic).toBe(false);
		});

		it("should not consume an extra rng draw for a non-gold or non-foil roll", () => {
			// rarity=stone (0), index draw=0.5, foil draw=0.99 (no foil) — only 3
			// draws should be consumed, so a second call against the same
			// period-3 rng sequence must reproduce an identical result.
			const rng = seq([0, 0.5, 0.99]);
			const first = rollCard(rng, basic);
			const second = rollCard(rng, basic);
			expect(second).toEqual(first);
		});
	});

	describe("prismatic — rollGuaranteedCard", () => {
		const legendary = findPackTier("legendary")!;

		it("should never mark a non-gold guaranteed roll as prismatic, even when foil passes", () => {
			// eligible = [jade, gold] under minRarity "jade"; r=0 lands jade.
			const rng = seq([0, 0, 0]);
			const first = rollGuaranteedCard(rng, legendary, "jade");
			const card = findCard(first.cardId);
			expect(card?.rarity).toBe("jade");
			expect(first.foil).toBe(true);
			expect(first.prismatic).toBe(false);

			// No extra draw should have been consumed for a non-gold roll.
			const second = rollGuaranteedCard(rng, legendary, "jade");
			expect(second).toEqual(first);
		});

		it("should never mark a gold guaranteed roll as prismatic when the foil check itself failed", () => {
			const rng = seq([0, 0, legendary.foilChance]);
			const first = rollGuaranteedCard(rng, legendary, "gold");
			expect(first.foil).toBe(false);
			expect(first.prismatic).toBe(false);

			// No extra draw consumed when the foil check fails.
			const second = rollGuaranteedCard(rng, legendary, "gold");
			expect(second).toEqual(first);
		});

		it("should mark a gold+foil guaranteed pull as prismatic when the prismatic draw is below PRISMATIC_CHANCE_FRACTION", () => {
			const result = rollGuaranteedCard(
				seq([0, 0, 0, PRISMATIC_CHANCE_FRACTION / 2]),
				legendary,
				"gold",
			);
			expect(result.foil).toBe(true);
			expect(result.prismatic).toBe(true);
		});

		it("should not mark a gold+foil guaranteed pull as prismatic when the prismatic draw is at or above PRISMATIC_CHANCE_FRACTION", () => {
			const result = rollGuaranteedCard(
				seq([0, 0, 0, PRISMATIC_CHANCE_FRACTION]),
				legendary,
				"gold",
			);
			expect(result.foil).toBe(true);
			expect(result.prismatic).toBe(false);
		});
	});
});
