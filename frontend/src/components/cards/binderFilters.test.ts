import { describe, expect, it } from "vitest";
import { filterAndSortCards, RARITY_ORDER } from "./binderFilters";
import type { CardView } from "../../features/hub/api";

function makeCard(overrides: Partial<CardView> = {}): CardView {
	return {
		id: "id",
		family: "power_shell",
		rarity: "stone",
		name: "Card",
		flavor: "",
		sourceRef: "ref",
		owned: true,
		count: 1,
		foilCount: 0,
		...overrides,
	};
}

describe("filterAndSortCards", () => {
	it("should keep the original collection order when sort is 'collection' and no filters are active", () => {
		const cards = [
			makeCard({ id: "a", rarity: "gold" }),
			makeCard({ id: "b", rarity: "stone" }),
		];
		const result = filterAndSortCards(cards, {
			rarity: "all",
			missingOnly: false,
			sort: "collection",
		});
		expect(result.map((c) => c.id)).toEqual(["a", "b"]);
	});

	it("should keep only cards matching the selected rarity", () => {
		const cards = [
			makeCard({ id: "a", rarity: "gold" }),
			makeCard({ id: "b", rarity: "stone" }),
			makeCard({ id: "c", rarity: "gold" }),
		];
		const result = filterAndSortCards(cards, {
			rarity: "gold",
			missingOnly: false,
			sort: "collection",
		});
		expect(result.map((c) => c.id)).toEqual(["a", "c"]);
	});

	it("should keep only unowned cards when missingOnly is set", () => {
		const cards = [
			makeCard({ id: "a", owned: true }),
			makeCard({ id: "b", owned: false }),
			makeCard({ id: "c", owned: false }),
		];
		const result = filterAndSortCards(cards, {
			rarity: "all",
			missingOnly: true,
			sort: "collection",
		});
		expect(result.map((c) => c.id)).toEqual(["b", "c"]);
	});

	it("should return an empty array when missingOnly is set and everything is owned", () => {
		const cards = [makeCard({ id: "a", owned: true })];
		const result = filterAndSortCards(cards, {
			rarity: "all",
			missingOnly: true,
			sort: "collection",
		});
		expect(result).toEqual([]);
	});

	it("should sort ascending by rarity (stone before gold) when sort is 'rarity-asc'", () => {
		const cards = [
			makeCard({ id: "a", rarity: "gold" }),
			makeCard({ id: "b", rarity: "stone" }),
			makeCard({ id: "c", rarity: "jade" }),
			makeCard({ id: "d", rarity: "bronze" }),
		];
		const result = filterAndSortCards(cards, {
			rarity: "all",
			missingOnly: false,
			sort: "rarity-asc",
		});
		expect(result.map((c) => c.rarity)).toEqual(RARITY_ORDER as CardView["rarity"][]);
	});

	it("should sort descending by rarity (gold before stone) when sort is 'rarity-desc'", () => {
		const cards = [
			makeCard({ id: "a", rarity: "stone" }),
			makeCard({ id: "b", rarity: "gold" }),
		];
		const result = filterAndSortCards(cards, {
			rarity: "all",
			missingOnly: false,
			sort: "rarity-desc",
		});
		expect(result.map((c) => c.id)).toEqual(["b", "a"]);
	});

	it("should combine rarity filter, missing-only, and sort together", () => {
		const cards = [
			makeCard({ id: "a", rarity: "gold", owned: false }),
			makeCard({ id: "b", rarity: "gold", owned: true }),
			makeCard({ id: "c", rarity: "stone", owned: false }),
		];
		const result = filterAndSortCards(cards, {
			rarity: "gold",
			missingOnly: true,
			sort: "rarity-asc",
		});
		expect(result.map((c) => c.id)).toEqual(["a"]);
	});

	it("should not mutate the array it was given", () => {
		const cards = [
			makeCard({ id: "a", rarity: "gold" }),
			makeCard({ id: "b", rarity: "stone" }),
		];
		const original = [...cards];
		filterAndSortCards(cards, {
			rarity: "all",
			missingOnly: false,
			sort: "rarity-asc",
		});
		expect(cards).toEqual(original);
	});

	it("should preserve relative order for cards that share the same rarity (stable sort)", () => {
		const cards = [
			makeCard({ id: "a", rarity: "jade" }),
			makeCard({ id: "b", rarity: "jade" }),
			makeCard({ id: "c", rarity: "jade" }),
		];
		const result = filterAndSortCards(cards, {
			rarity: "all",
			missingOnly: false,
			sort: "rarity-asc",
		});
		expect(result.map((c) => c.id)).toEqual(["a", "b", "c"]);
	});

	it("should return an empty array when given no cards", () => {
		const result = filterAndSortCards([], {
			rarity: "all",
			missingOnly: false,
			sort: "collection",
		});
		expect(result).toEqual([]);
	});
});
