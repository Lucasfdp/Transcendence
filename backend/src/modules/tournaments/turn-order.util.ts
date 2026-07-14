/**
 * deriveTurnOrder — seed-derived deterministic first-round turn order
 * (SPEC-038 "visible play order" / architect ruling #2 of the entry-lobby
 * brief).
 *
 * PURE and deterministic: the same (seed, set of userIds) always yields the
 * same order, regardless of the order the ids are passed in (input is
 * normalized by sorting before shuffling). The lobby uses it to assign
 * `tournament_participants.seat` when the lobby completes, and the game
 * Runtime (Phase 1+) MUST reuse this exact function to regenerate the turn
 * order from the persisted tournament seed — do not reimplement the shuffle
 * anywhere else.
 *
 * Returns the userIds in play order: index in the returned array == seat.
 */

/** FNV-1a 32-bit hash — folds an arbitrary seed string into a PRNG seed. */
function fnv1a32(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** mulberry32 — tiny deterministic PRNG over a 32-bit state, output [0, 1). */
function mulberry32(seed: number): () => number {
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
 * Derive the first-round turn order for a tournament.
 *
 * @param seed    The tournament seed persisted at lobby creation.
 * @param userIds Participant user ids (any order; normalized internally).
 * @returns       The same ids, in play order (index == seat).
 */
export function deriveTurnOrder(seed: string, userIds: number[]): number[] {
	const order = [...userIds].sort((a, b) => a - b);
	const rand = mulberry32(fnv1a32(seed));
	// Fisher–Yates shuffle driven exclusively by the seeded PRNG.
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	return order;
}
