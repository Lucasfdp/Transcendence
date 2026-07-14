import { TournamentRng } from "./tournament-rng";

describe("TournamentRng (SPEC-000/028)", () => {
	it("is reproducible: same seed ⇒ same sequence", () => {
		const a = new TournamentRng("seed-a");
		const b = new TournamentRng("seed-a");
		const seqA = Array.from({ length: 20 }, () => a.next());
		const seqB = Array.from({ length: 20 }, () => b.next());
		expect(seqA).toEqual(seqB);
	});

	it("different seeds ⇒ different sequences", () => {
		const a = new TournamentRng("seed-a");
		const b = new TournamentRng("seed-z");
		const seqA = Array.from({ length: 20 }, () => a.next());
		const seqB = Array.from({ length: 20 }, () => b.next());
		expect(seqA).not.toEqual(seqB);
	});

	it("pickIndex stays within [0, count) and is 0 for a non-positive count", () => {
		const rng = new TournamentRng("seed-a");
		for (let i = 0; i < 100; i++) {
			const idx = rng.pickIndex(5);
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(idx).toBeLessThan(5);
		}
		expect(rng.pickIndex(0)).toBe(0);
	});

	it("never calls Math.random", () => {
		const spy = jest.spyOn(Math, "random");
		const rng = new TournamentRng("seed-a");
		rng.next();
		rng.pickIndex(3);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("serialize/restore replays the stream from the same draw position", () => {
		const original = new TournamentRng("seed-a");
		original.next();
		original.next();
		const nextOriginal = original.next();

		const restored = new TournamentRng("seed-a");
		restored.restoreFrom({ seed: "seed-a", drawCount: 2 });
		expect(restored.next()).toBe(nextOriginal);
		expect(original.serialize().drawCount).toBe(3);
	});
});
