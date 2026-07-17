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
 *
 * The seeded PRNG itself lives in `infra/seeded-rng.ts` (the ONE shared RNG for
 * the whole Tournament) — this file only composes it into a Fisher–Yates shuffle.
 */

import { fnv1a32, mulberry32 } from "./infra/seeded-rng";

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
