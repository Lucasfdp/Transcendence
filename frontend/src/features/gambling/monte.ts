/**
 * Pure Three-Shell Monte logic — mirrors the backend so the roll→slot maths and
 * the shuffle can be verified in isolation and the provably-fair panel can
 * recompute a round client-side.
 *
 * The shuffle is now authored by the server and streamed swap-by-swap; the
 * client only *applies* swaps, it no longer invents them. That's what keeps the
 * winning slot off the wire until the round resolves.
 */
import type { MonteSwap } from "./contracts";

/** Map a roll in [0, 1) to a slot index (matches the server). */
export function winningShell(roll: number, shells: number): number {
	return Math.min(Math.floor(roll * shells), shells - 1);
}

/** The outcome id the server stores for a winning slot. */
export function monteOutcomeId(winning: number): string {
	return `shell-${winning}`;
}

export const MONTE_CUP_COUNT = 3;
export const MONTE_FIRST_SWAP_MS = 1000;
export const MONTE_FASTEST_SWAP_MS = 250;

/** Swap exactly two positions in a cup-id row without mutating the input. */
export function swapTwoCupPositions(
	cupIds: readonly string[],
	first: number,
	second: number,
): string[] {
	const next = [...cupIds];
	[next[first], next[second]] = [next[second], next[first]];
	return next;
}

/** Follow the ball from its start slot through the swaps to its final slot. */
export function applyShuffle(startSlot: number, shuffle: MonteSwap[]): number {
	let slot = startSlot;
	for (const [a, b] of shuffle) {
		if (slot === a) slot = b;
		else if (slot === b) slot = a;
	}
	return slot;
}

/**
 * Duration for swap `index`, easing from slow to fast. Identical to the
 * backend's `monteSwapDuration` so the client's animation timeline matches the
 * server's resolve gate exactly.
 */
export function monteSwapDuration(index: number, total: number): number {
	if (total <= 1) return MONTE_FIRST_SWAP_MS;
	const progress = Math.min(Math.max(index / (total - 1), 0), 1);
	const eased = 1 - Math.pow(1 - progress, 2);
	return Math.round(
		MONTE_FIRST_SWAP_MS -
			(MONTE_FIRST_SWAP_MS - MONTE_FASTEST_SWAP_MS) * eased,
	);
}

/** All swap durations for a shuffle run. */
export function monteSwapDurations(total: number): number[] {
	return Array.from({ length: total }, (_, index) =>
		monteSwapDuration(index, total),
	);
}
