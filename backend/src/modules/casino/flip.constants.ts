/**
 * Shell Flip — catalogue & economy constants.
 *
 * The simplest attraction in the gambling den: the player calls a shell side —
 * gold ("heads") or jade ("tails") — and one provably-fair roll decides which
 * way the shell lands. A correct call pays {@link FLIP_MULTIPLIER}×; a wrong one
 * loses the stake.
 *
 * Economy design: a fair coin (each side exactly half the unit interval) paying
 * 2× has an expected return of exactly 1.0 — net-neutral, no house edge. The
 * shared engine moves the coins; this module owns only the layout and the pure
 * roll→side maths so the payout is auditable in one place.
 */

/** The two shell sides a player can call. */
export const FLIP_SIDES = ["heads", "tails"] as const;

/** A called/landed shell side. */
export type FlipSide = (typeof FLIP_SIDES)[number];

/** Payout multiplier for a correct call (0 = lose the stake). */
export const FLIP_MULTIPLIER = 2;

/** Rolls strictly below this land "heads"; the rest land "tails". */
export const FLIP_HEADS_THRESHOLD = 0.5;

/** Map a roll in [0, 1) to a shell side. */
export function flipSide(roll: number): FlipSide {
	return roll < FLIP_HEADS_THRESHOLD ? "heads" : "tails";
}

/**
 * Return-to-player for a single call: the probability the called side lands
 * times the payout. With a fair coin (threshold 0.5) paying 2× this is exactly
 * 1.0. Asserted in the spec.
 */
export function flipRtp(): number {
	const probabilityOfWin = FLIP_HEADS_THRESHOLD;
	return probabilityOfWin * FLIP_MULTIPLIER;
}

/** Everything the frontend needs to render Shell Flip. */
export interface FlipConfig {
	/** Payout multiplier for a correct call. */
	multiplier: number;
	/** Return-to-player (1.0 = net-neutral). */
	rtp: number;
	/** Accepted wager bounds (shared with the wheel). */
	minWager: number;
	maxWager: number;
	/** The requesting player's current coin balance. */
	coins: number;
}
