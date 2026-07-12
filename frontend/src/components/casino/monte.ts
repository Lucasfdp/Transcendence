/**
 * Pure Three-Shell Monte logic — a faithful copy of the backend's
 * `winningShell`, kept free of React/DOM so the roll→shell maths can be verified
 * in isolation and the provably-fair panel can recompute a spin client-side.
 */

/** Map a roll in [0, 1) to the winning shell index (matches the server). */
export function winningShell(roll: number, shells: number): number {
	return Math.min(Math.floor(roll * shells), shells - 1);
}

/** The outcome id the server stores for a winning shell. */
export function monteOutcomeId(winning: number): string {
	return `shell-${winning}`;
}

export const MONTE_CUP_COUNT = 3;
export const MONTE_FIRST_SWAP_MS = 1000;
export const MONTE_FASTEST_SWAP_MS = 250;

const MONTE_SWAP_CHOICES: readonly [number, number][] = [
	[0, 1],
	[0, 2],
	[1, 2],
];

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

/** Duration for swap `index`, easing gradually from slow to fast. */
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

function randomUnit(): number {
	const crypto = globalThis.crypto;
	if (crypto?.getRandomValues) {
		const value = new Uint32Array(1);
		crypto.getRandomValues(value);
		return value[0] / 0x1_0000_0000;
	}
	return Math.random();
}

/** Random visible cup swaps for a three-cup shuffle. */
export function monteSwapPairs(
	total: number,
	rng: () => number = randomUnit,
): [number, number][] {
	return Array.from({ length: total }, () => {
		const index = Math.min(
			Math.floor(rng() * MONTE_SWAP_CHOICES.length),
			MONTE_SWAP_CHOICES.length - 1,
		);
		return [...MONTE_SWAP_CHOICES[index]];
	});
}
