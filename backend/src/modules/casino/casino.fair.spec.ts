import {
	computeRoll,
	generateServerSeed,
	hashSeed,
} from "./casino.fair";

describe("casino.fair", () => {
	describe("hashSeed", () => {
		it("should return the SHA-256 hex digest of the seed", () => {
			// Known vector: sha256("abc").
			expect(hashSeed("abc")).toBe(
				"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
			);
		});

		it("should return a 64-character lowercase hex string", () => {
			expect(hashSeed("any-seed")).toMatch(/^[0-9a-f]{64}$/);
		});

		it("should be deterministic for the same seed", () => {
			expect(hashSeed("seed")).toBe(hashSeed("seed"));
		});
	});

	describe("generateServerSeed", () => {
		it("should return a non-empty hex string", () => {
			expect(generateServerSeed()).toMatch(/^[0-9a-f]+$/);
		});

		it("should return a different seed on each call", () => {
			expect(generateServerSeed()).not.toBe(generateServerSeed());
		});
	});

	describe("computeRoll", () => {
		it("should return a value in [0, 1)", () => {
			for (let nonce = 0; nonce < 50; nonce++) {
				const roll = computeRoll("server", "client", nonce);
				expect(roll).toBeGreaterThanOrEqual(0);
				expect(roll).toBeLessThan(1);
			}
		});

		it("should be deterministic for identical inputs", () => {
			expect(computeRoll("s", "c", 7)).toBe(computeRoll("s", "c", 7));
		});

		it("should change when the nonce changes", () => {
			expect(computeRoll("s", "c", 1)).not.toBe(computeRoll("s", "c", 2));
		});

		it("should change when the client seed changes", () => {
			expect(computeRoll("s", "a", 1)).not.toBe(computeRoll("s", "b", 1));
		});

		it("should change when the server seed changes", () => {
			expect(computeRoll("a", "c", 1)).not.toBe(computeRoll("b", "c", 1));
		});
	});
});
