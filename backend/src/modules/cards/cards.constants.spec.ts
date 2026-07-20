import {
	CARDS,
	CARD_FAMILIES,
	CARD_RARITIES,
	DUPLICATE_COIN_REFUND,
	FOIL_CHANCE,
	PACK_PRICE_COINS,
	PACK_SIZE,
	PACK_TIERS,
	PACK_TIER_IDS,
	PRISMATIC_CHANCE_FRACTION,
	RARITY_ODDS,
	cardsByFamily,
	findCard,
	findPackTier,
	type CardRarity,
	type PackTierId,
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

	describe("CARDS catalogue", () => {
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

		it("should give every card a non-empty name, flavour and sourceRef", () => {
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

		it("should include the Santa Kame character card with static art", () => {
			const santa = findCard("char-santa");
			expect(santa).toBeDefined();
			expect(santa?.family).toBe("character");
			expect(santa?.rarity).toBe("gold");
			expect(santa?.imageUrl).toBe("/assets/character/santa-turtle.webp");
		});

		it("should include the Kagemusha assassin character card with static art", () => {
			const assassin = findCard("char-assassin");
			expect(assassin).toBeDefined();
			expect(assassin?.family).toBe("character");
			expect(assassin?.rarity).toBe("gold");
			expect(assassin?.imageUrl).toBe("/assets/character/assassin-turtle.webp");
		});

		it("should include the Yurei ghost character card with static art", () => {
			const ghost = findCard("char-ghost");
			expect(ghost).toBeDefined();
			expect(ghost?.family).toBe("character");
			expect(ghost?.rarity).toBe("gold");
			expect(ghost?.imageUrl).toBe("/assets/character/ghost-turtle.webp");
		});

		it("should include the Sumo character card with static art", () => {
			const sumo = findCard("char-sumo");
			expect(sumo).toBeDefined();
			expect(sumo?.family).toBe("character");
			expect(sumo?.rarity).toBe("gold");
			expect(sumo?.imageUrl).toBe("/assets/character/sumo-turtle.webp");
		});

		it("should include the Kamigame godly character card with static art", () => {
			const godly = findCard("char-godly");
			expect(godly).toBeDefined();
			expect(godly?.family).toBe("character");
			expect(godly?.rarity).toBe("gold");
			expect(godly?.imageUrl).toBe("/assets/character/godly-turtle.png");
		});

		it("should include the Akuma demon character card with static art", () => {
			const demon = findCard("char-demon");
			expect(demon).toBeDefined();
			expect(demon?.family).toBe("character");
			expect(demon?.rarity).toBe("gold");
			expect(demon?.imageUrl).toBe("/assets/character/demon-turtle.png");
		});

		it("should include the Kishi knight character card with static art", () => {
			const knight = findCard("char-knight");
			expect(knight).toBeDefined();
			expect(knight?.family).toBe("character");
			expect(knight?.rarity).toBe("gold");
			expect(knight?.imageUrl).toBe("/assets/character/knight-turtle.png");
		});

		it("should include the Irie Kame rasta character card with static art", () => {
			const rasta = findCard("char-rasta");
			expect(rasta).toBeDefined();
			expect(rasta?.family).toBe("character");
			expect(rasta?.rarity).toBe("gold");
			expect(rasta?.imageUrl).toBe("/assets/character/rasta-turtle.png");
		});

		it("should include the Shelly presenter character card with static art", () => {
			const presenter = findCard("char-presenter");
			expect(presenter).toBeDefined();
			expect(presenter?.family).toBe("character");
			expect(presenter?.rarity).toBe("gold");
			expect(presenter?.name).toBe("Shelly, El Conchudo");
			expect(presenter?.imageUrl).toBe(
				"/assets/character/presenter-turtle.png",
			);
		});

		// ── Power-shell cards with static art (public/assets/power-ups/) ────────
		// Only the power-shell cards with a matching image get one; the rest
		// keep the procedural frame + initial-letter fallback (see CardSlot).

		it.each([
			["power-heavy", "/assets/power-ups/heavyPower.png"],
			["power-tiny", "/assets/power-ups/tinyPower.png"],
			["power-giant", "/assets/power-ups/giantPower.png"],
			["power-splitter", "/assets/power-ups/splitterPower.png"],
			["power-rocket", "/assets/power-ups/rocketPower.png"],
			["power-spinning", "/assets/power-ups/spinningPower.png"],
			["power-phantom", "/assets/power-ups/phantomPower.png"],
			["power-clone", "/assets/power-ups/mirrorPower.png"],
		])("should give %s the static art at %s", (cardId, imageUrl) => {
			const card = findCard(cardId);
			expect(card).toBeDefined();
			expect(card?.family).toBe("power_shell");
			expect(card?.imageUrl).toBe(imageUrl);
		});

		it("should leave power-shell cards without matching art unset (procedural frame fallback)", () => {
			const bomb = findCard("power-bomb");
			expect(bomb).toBeDefined();
			expect(bomb?.imageUrl).toBeUndefined();
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

		it("should keep PRISMATIC_CHANCE_FRACTION within (0, 1)", () => {
			expect(PRISMATIC_CHANCE_FRACTION).toBeGreaterThan(0);
			expect(PRISMATIC_CHANCE_FRACTION).toBeLessThan(1);
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

	describe("PACK_TIERS", () => {
		it("should have rarity odds that sum to 1.0 for every pack tier", () => {
			for (const tier of PACK_TIERS) {
				const total = CARD_RARITIES.reduce(
					(sum, rarity) => sum + tier.rarityOdds[rarity],
					0,
				);
				expect(total).toBeCloseTo(1, 10);
			}
		});

		it("should declare a positive probability for every rarity in every tier", () => {
			for (const tier of PACK_TIERS) {
				for (const rarity of CARD_RARITIES) {
					expect(tier.rarityOdds[rarity]).toBeGreaterThan(0);
				}
			}
		});

		it("should price every tier above zero and in strictly ascending order", () => {
			const prices = PACK_TIERS.map((tier) => tier.priceCoins);
			for (const price of prices) {
				expect(price).toBeGreaterThan(0);
			}
			const sorted = [...prices].sort((a, b) => a - b);
			expect(prices).toEqual(sorted);
			expect(new Set(prices).size).toBe(prices.length);
		});

		it("should keep every tier's foil chance within (0, 1)", () => {
			for (const tier of PACK_TIERS) {
				expect(tier.foilChance).toBeGreaterThan(0);
				expect(tier.foilChance).toBeLessThan(1);
			}
		});

		it("should give every tier a unique id, matching PACK_TIER_IDS", () => {
			const ids = PACK_TIERS.map((tier) => tier.id);
			expect(new Set(ids).size).toBe(ids.length);
			expect(PACK_TIER_IDS).toEqual(ids);
		});

		it("should keep the basic tier's price and odds identical to the standalone legacy constants", () => {
			const basic = PACK_TIERS.find((tier) => tier.id === "basic");
			expect(basic?.priceCoins).toBe(PACK_PRICE_COINS);
			expect(basic?.rarityOdds).toBe(RARITY_ODDS);
			expect(basic?.foilChance).toBe(FOIL_CHANCE);
		});

		it("should only guarantee a gold-or-better slot on the legendary tier", () => {
			const legendary = PACK_TIERS.find((tier) => tier.id === "legendary");
			const basic = PACK_TIERS.find((tier) => tier.id === "basic");
			const deluxe = PACK_TIERS.find((tier) => tier.id === "deluxe");

			expect(legendary?.guaranteedMinRarity).toBe("gold");
			expect(basic?.guaranteedMinRarity).toBeUndefined();
			expect(deluxe?.guaranteedMinRarity).toBeUndefined();
		});
	});

	describe("findPackTier", () => {
		it("should return the matching tier definition when the id exists", () => {
			expect(findPackTier("deluxe")?.id).toBe("deluxe");
		});

		it("should return undefined when no tier matches the id", () => {
			expect(
				findPackTier("does-not-exist" as PackTierId),
			).toBeUndefined();
		});
	});
});
