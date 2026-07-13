/**
 * Server-authored Three-Shell Monte shuffle.
 *
 * Every visible swap, the ball's start slot and the winning slot are derived
 * deterministically from the same (serverSeed, clientSeed, nonce) triple that
 * powers the provably-fair roll — so the whole round can be recomputed and
 * audited from the revealed seed, exactly like every other casino game.
 *
 * The security property this file buys (over the previous client-generated
 * shuffle): the winning slot is NEVER a field the client is handed up front.
 * A player only ever sees the ball's START slot (as in real monte) plus the
 * swaps, streamed just-in-time; to know where the ball ends they must actually
 * replay the swaps. The server recomputes {@link applyShuffle} itself and
 * compares it to the slot the player clicked — it never trusts a client value.
 */
import { createHmac } from "node:crypto";
import { computeRoll } from "./casino.fair";
import {
	MONTE_CUP_COUNT,
	MONTE_FASTEST_SWAP_MS,
	MONTE_FIRST_SWAP_MS,
	type MonteSwap,
} from "./monte-round.constants";
import { winningShell } from "./monte.constants";

/** 2^32 — divisor mapping a 32-bit integer into [0, 1). */
const UINT32_RANGE = 0x1_0000_0000;

/**
 * The three distinct two-slot swaps possible with three cups. A shuffle is a
 * sequence drawn from these; each keeps every cup on the board (no cup ever
 * leaves), so tracking is always theoretically possible for an honest player.
 */
const SWAP_CHOICES: readonly MonteSwap[] = [
	[0, 1],
	[0, 2],
	[1, 2],
];

/** The slot the ball starts under (shown to the player during the preview). */
export function deriveBallStartSlot(
	serverSeed: string,
	clientSeed: string,
	nonce: number,
): number {
	return winningShell(
		computeRoll(serverSeed, clientSeed, nonce),
		MONTE_CUP_COUNT,
	);
}

/** One roll per shuffle step, namespaced so it never collides with the main roll. */
function shuffleRoll(
	serverSeed: string,
	clientSeed: string,
	nonce: number,
	step: number,
): number {
	const digest = createHmac("sha256", serverSeed)
		.update(`${clientSeed}:${nonce}:shuffle:${step}`)
		.digest("hex");
	return parseInt(digest.slice(0, 8), 16) / UINT32_RANGE;
}

/** The full, deterministic swap sequence for a round. */
export function deriveShuffle(
	serverSeed: string,
	clientSeed: string,
	nonce: number,
	steps: number,
): MonteSwap[] {
	const shuffle: MonteSwap[] = [];
	for (let step = 0; step < steps; step++) {
		const roll = shuffleRoll(serverSeed, clientSeed, nonce, step);
		const index = Math.min(
			Math.floor(roll * SWAP_CHOICES.length),
			SWAP_CHOICES.length - 1,
		);
		shuffle.push([...SWAP_CHOICES[index]] as MonteSwap);
	}
	return shuffle;
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
 * Duration of swap `index`, easing from a slow first swap to a fast last one.
 * Pure and deterministic from the step count, so the client can reproduce the
 * exact same timeline the server uses for its resolve gate without any seed.
 */
export function monteSwapDuration(index: number, total: number): number {
	if (total <= 1) return MONTE_FIRST_SWAP_MS;
	const progress = Math.min(Math.max(index / (total - 1), 0), 1);
	const eased = 1 - Math.pow(1 - progress, 2);
	return Math.round(
		MONTE_FIRST_SWAP_MS - (MONTE_FIRST_SWAP_MS - MONTE_FASTEST_SWAP_MS) * eased,
	);
}

/** Every swap duration for a shuffle of `total` steps. */
export function monteStepDurations(total: number): number[] {
	return Array.from({ length: total }, (_, index) =>
		monteSwapDuration(index, total),
	);
}

/** Total time the swaps themselves take (excludes preview/cover lead-in). */
export function monteShuffleMs(total: number): number {
	return monteStepDurations(total).reduce((sum, ms) => sum + ms, 0);
}
