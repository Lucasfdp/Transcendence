import {
	CARDS,
	CARD_FAMILIES,
	CARD_RARITIES,
	DUPLICATE_COIN_REFUND,
	FOIL_CHANCE,
	PACK_PRICE_COINS,
	PACK_SIZE,
	RARITY_ODDS,
	cardsByFamily,
	findCard,
	type CardRarity,
} from "./cards.constants";

describe("cards.constants", () => {
	describe("RARITY_ODDS", () => {
		it("should have rarity odds that sum to 1.0", () => {
			const total = CARD_RARITIES.reduce(
				(sum, rarity) => sum + RARITY_ODDS[rarity],
				0,
			);
			expect(total).toBeCloseTo(1, 10);
		});

		it("should declare a positive probability for every rarity tier", () => {
			for (const rarity of CARD_RARITIES) {
				expect(RARITY_ODDS[rarity]).toBeGreaterThan(0);
			}
		});
	});

	describe("CARDS catalog", () => {
		it("should contain at least one card", () => {
			expect(CARDS.length).toBeGreaterThan(0);
		});

		it("should have a unique id for every card", () => {
			const ids = CARDS.map((card) => card.id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it("should only use declared rarities and families", () => {
			for (const card of CARDS) {
				expect(CARD_RARITIES).toContain(card.rarity);
				expect(CARD_FAMILIES).toContain(card.family);
			}
		});

		it("should give every card a non-empty name, flavor and sourceRef", () => {
			for (const card of CARDS) {
				expect(card.name.length).toBeGreaterThan(0);
				expect(card.flavor.length).toBeGreaterThan(0);
				expect(card.sourceRef.length).toBeGreaterThan(0);
			}
		});

		it("should provide at least one card for every rarity so any roll is fillable", () => {
			for (const rarity of CARD_RARITIES) {
				const count = CARDS.filter((card) => card.rarity === rarity).length;
				expect(count).toBeGreaterThan(0);
			}
		});

		it("should include a card for every declared family", () => {
			for (const family of CARD_FAMILIES) {
				expect(cardsByFamily(family).length).toBeGreaterThan(0);
			}
		});

		it("should include the legendary Shell Reaper character card with static art", () => {
			const reaper = findCard("char-reaper");
			expect(reaper).toBeDefined();
			expect(reaper?.family).toBe("character");
			expect(reaper?.rarity).toBe("gold");
			expect(reaper?.imageUrl).toBe("/assets/character/reaper-turtle.jpg");
		});

		it("should include the Corsair Shell pirate character card with static art", () => {
			const pirate = findCard("char-pirate");
			expect(pirate).toBeDefined();
			expect(pirate?.family).toBe("character");
			expect(pirate?.rarity).toBe("gold");
			expect(pirate?.imageUrl).toBe("/assets/character/pirate-turtle.webp");
		});
	});

	describe("pack & duplicate economy constants", () => {
		it("should price a pack at a positive coin cost", () => {
			expect(PACK_PRICE_COINS).toBeGreaterThan(0);
		});

		it("should yield a positive whole number of cards per pack", () => {
			expect(PACK_SIZE).toBeGreaterThan(0);
			expect(Number.isInteger(PACK_SIZE)).toBe(true);
		});

		it("should keep the foil chance within (0, 1)", () => {
			expect(FOIL_CHANCE).toBeGreaterThan(0);
			expect(FOIL_CHANCE).toBeLessThan(1);
		});

		it("should define a non-negative duplicate refund for every rarity", () => {
			for (const rarity of CARD_RARITIES) {
				const refund = DUPLICATE_COIN_REFUND[rarity as CardRarity];
				expect(refund).toBeGreaterThanOrEqual(0);
			}
		});
	});

	describe("findCard", () => {
		it("should return the matching card when the id exists", () => {
			const first = CARDS[0];
			expect(findCard(first.id)).toEqual(first);
		});

		it("should return undefined when no card matches the id", () => {
			expect(findCard("does-not-exist")).toBeUndefined();
		});
	});
});
