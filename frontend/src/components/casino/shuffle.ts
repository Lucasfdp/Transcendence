/**
 * Cosmetic shuffle choreography for Three-Shell Monte's reveal.
 *
 * Context: the player picks a shell *slot* (0..count-1) before clicking
 * Guess; the server then resolves — synchronously, like every other casino
 * game — which slot has the pearl. There is no backend concept of a shell
 * "identity" independent of its slot, and no server data describing a
 * shuffle path. A real shell-game shuffle is therefore, necessarily, a
 * purely cosmetic flourish played *after* the server has already resolved
 * the guess and *before* the reveal — not a pre-pick "watch the dealer
 * shuffle, then guess" mechanic. Changing *when* the player picks would be a
 * game-mechanics change, out of scope for a presentation-only pass.
 *
 * The choreography: assign each of the `count` shells a stable "identity"
 * equal to its starting slot (identity `i` starts at position `i`). The
 * pearl's identity is the server-resolved winning slot index (since at
 * pick/resolve time, slot === identity — nothing has moved yet). The
 * player's pick is likewise an identity. A sequence of purely cosmetic,
 * non-seeded position swaps is generated (this does NOT need to be
 * provably-fair — it has no bearing on the outcome, only on how the already
 * -decided outcome is presented), and every shell visually animates through
 * whatever position it occupies after each swap. At the end, whichever
 * position the pearl's identity landed on is where the pearl is revealed —
 * which may or may not be the same position the player originally clicked,
 * exactly like a real shell game.
 */

/** One cosmetic swap: the two board positions that trade places. */
export interface SwapStep {
	positions: readonly [number, number];
}

/**
 * Generates a purely cosmetic, non-seeded sequence of position swaps for the
 * shuffle animation. Not provably-fair and not meant to be — the outcome is
 * already fixed before this is ever called. `random` is injectable for
 * deterministic tests; defaults to `Math.random`.
 */
export function generateSwapSequence(
	count: number,
	swapCount: number,
	random: () => number = Math.random,
): SwapStep[] {
	if (count < 2) return [];
	const steps: SwapStep[] = [];
	for (let i = 0; i < swapCount; i++) {
		const a = Math.floor(random() * count);
		let b = Math.floor(random() * count);
		while (b === a) {
			b = Math.floor(random() * count);
		}
		steps.push({ positions: [a, b] });
	}
	return steps;
}

/**
 * A snapshot of "which identity occupies which position" after each step,
 * starting with the initial identity-equals-position state at index 0. Use
 * this to progressively animate every shell to its position after each swap.
 */
export function swapSnapshots(
	count: number,
	steps: readonly SwapStep[],
): number[][] {
	const snapshots: number[][] = [];
	let current = Array.from({ length: count }, (_, index) => index);
	snapshots.push([...current]);
	for (const step of steps) {
		const [a, b] = step.positions;
		const next = [...current];
		const temp = next[a];
		next[a] = next[b];
		next[b] = temp;
		snapshots.push(next);
		current = next;
	}
	return snapshots;
}

/** The final position-to-identity mapping after applying every swap in order. */
export function positionsAfterSwaps(
	count: number,
	steps: readonly SwapStep[],
): number[] {
	const snapshots = swapSnapshots(count, steps);
	return snapshots[snapshots.length - 1];
}

/** The position a given starting `identity` ends up in after a swap sequence. */
export function finalPositionOfIdentity(
	count: number,
	steps: readonly SwapStep[],
	identity: number,
): number {
	return positionsAfterSwaps(count, steps).indexOf(identity);
}
