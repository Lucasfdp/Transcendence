import { deriveTurnOrder } from "./turn-order.util";

describe("deriveTurnOrder (SPEC-038 — seed-derived deterministic turn order)", () => {
	it("returns a permutation of the input user ids", () => {
		const ids = [10, 42, 7, 99];
		const order = deriveTurnOrder("seed-a", ids);

		expect(order).toHaveLength(ids.length);
		expect([...order].sort((a, b) => a - b)).toEqual(
			[...ids].sort((a, b) => a - b),
		);
	});

	it("is deterministic: same seed + same players → same order", () => {
		const ids = [1, 2, 3, 4];

		expect(deriveTurnOrder("tournament-seed", ids)).toEqual(
			deriveTurnOrder("tournament-seed", ids),
		);
	});

	it("is independent of the input order of the ids (join order)", () => {
		expect(deriveTurnOrder("s", [4, 1, 3, 2])).toEqual(
			deriveTurnOrder("s", [1, 2, 3, 4]),
		);
	});

	it("different seeds produce different orders (for a fixed player set)", () => {
		const ids = [1, 2, 3, 4];
		// With 24 permutations of 4 players, at least one of a handful of
		// distinct seeds must diverge from the first — a collision across ALL
		// of them would mean the seed is being ignored.
		const orders = ["a", "b", "c", "d", "e"].map((seed) =>
			JSON.stringify(deriveTurnOrder(seed, ids)),
		);

		expect(new Set(orders).size).toBeGreaterThan(1);
	});

	it("does not mutate the input array", () => {
		const ids = [4, 3, 2, 1];
		deriveTurnOrder("seed", ids);

		expect(ids).toEqual([4, 3, 2, 1]);
	});

	it("handles degenerate sizes (empty and single player)", () => {
		expect(deriveTurnOrder("seed", [])).toEqual([]);
		expect(deriveTurnOrder("seed", [5])).toEqual([5]);
	});
});
