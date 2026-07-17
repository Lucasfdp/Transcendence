/**
 * seeded-rng.ts — the ONE deterministic PRNG for the whole Tournament (SPEC-000
 * "Determinismo", SPEC-028). Every seed-driven decision (turn order, dice rolls,
 * steal victim selection, …) folds the tournament seed through the SAME hash +
 * PRNG so "misma seed y mismas acciones producen el mismo resultado". Do NOT
 * reimplement a shuffle or roll anywhere else — build it on these helpers.
 *
 * Pure and self-contained: no clock, no `Math.random`. `Math.imul`/bit-ops are
 * deterministic integer arithmetic, not randomness.
 */

/** FNV-1a 32-bit hash — folds an arbitrary seed string into a PRNG seed. */
export function fnv1a32(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** mulberry32 — tiny deterministic PRNG over a 32-bit state, output [0, 1). */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Builds a deterministic PRNG (output [0, 1)) from a seed string. The same seed
 * always yields the same sequence — callers that need independent streams from
 * one tournament seed should namespace it (e.g. `createSeededRng(`${seed}:dice:${n}`)`).
 */
export function createSeededRng(seed: string): () => number {
	return mulberry32(fnv1a32(seed));
}
