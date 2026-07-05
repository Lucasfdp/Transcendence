/**
 * Pure Shell Drop *animation* geometry — separate from `plinko.ts`'s
 * roll→bucket maths, but built strictly on top of it so the two can never
 * disagree about where the shell lands. No React/DOM here so this can be
 * sanity-checked in isolation (see the throwaway node check run alongside
 * this file) the same way `plinko.ts` was checked against the backend.
 *
 * Geometry: a standard Galton/Plinko board. The shell starts centred above
 * `rows` peg rows and `rows + 1` buckets of equal width. At each peg row it
 * steps left or right by exactly half a bucket-width. Since a bucket's
 * centre is offset from the board's centre by exactly
 * `(bucketIndex - rows / 2) * bucketWidth`, and the shell's total drift after
 * `rows` half-bucket-width steps is `(rightCount - leftCount) * (bucketWidth
 * / 2)` — which is algebraically the same expression once `bucketIndex` is
 * substituted for `rightCount` — the shell always arrives, without any
 * special-casing, at the exact centre of `bucketIndexFromRolls(rolls)`.
 */
import { RIGHT_THRESHOLD } from "./plinko";

/** A peg's position on the board, normalised to [0, 1] on both axes. */
export interface PegPosition {
	/** 1-indexed peg row (1..rows), top to bottom. */
	row: number;
	/** Horizontal position, normalised to the board width. */
	x: number;
	/** Vertical position, normalised to the board height (0 = top). */
	y: number;
}

/** The shell's position after passing peg row `row`. */
export interface DropStep {
	row: number;
	x: number;
	y: number;
	direction: "left" | "right";
}

/** Every peg's normalised position for a `rows`-row board, row by row. */
export function pegLattice(rows: number): PegPosition[] {
	const buckets = rows + 1;
	const bucketWidth = 1 / buckets;
	const pegs: PegPosition[] = [];
	for (let row = 1; row <= rows; row++) {
		const y = row / (rows + 1);
		for (let slot = 0; slot <= row; slot++) {
			const x = 0.5 + (slot - row / 2) * bucketWidth;
			pegs.push({ row, x, y });
		}
	}
	return pegs;
}

/**
 * The shell's row-by-row path through the board, derived from the same
 * per-row rolls the server used. `steps.length === rows`; the final step's
 * `x` is exactly the landed bucket's centre (see the module doc for why).
 */
export function computeDropPath(
	rows: number,
	rolls: readonly number[],
): DropStep[] {
	const buckets = rows + 1;
	const bucketWidth = 1 / buckets;
	const halfSlot = bucketWidth / 2;
	let x = 0.5;
	const steps: DropStep[] = [];
	for (let row = 1; row <= rows; row++) {
		const roll = rolls[row - 1] ?? 0;
		const direction: "left" | "right" =
			roll >= RIGHT_THRESHOLD ? "right" : "left";
		x += direction === "right" ? halfSlot : -halfSlot;
		steps.push({ row, x, y: row / (rows + 1), direction });
	}
	return steps;
}

/** The bucket index a completed path lands on (count of rightward steps). */
export function bucketFromPath(steps: readonly DropStep[]): number {
	return steps.filter((step) => step.direction === "right").length;
}
