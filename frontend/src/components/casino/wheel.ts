/**
 * Pure geometry helpers for the Fortune Wheel.
 *
 * The wheel is drawn as `count` equal-angle slices, slice 0 starting at the top
 * (12 o'clock) and running clockwise. A fixed pointer sits at the top; spinning
 * rotates the wheel clockwise by some number of degrees. These helpers convert
 * between "rotation applied" and "which slice is under the pointer" and are kept
 * free of React/DOM so the maths can be verified in isolation.
 */

/** Full turns added on top of the landing offset, for a satisfying spin. */
export const SPIN_TURNS = 5;

/** Normalise any angle to the [0, 360) range. */
function mod360(angle: number): number {
	return ((angle % 360) + 360) % 360;
}

/**
 * The slice index currently under the top pointer for a wheel rotated clockwise
 * by `rotation` degrees. Inverse of {@link nextRotation}.
 */
export function segmentAtTop(rotation: number, count: number): number {
	const sliceDeg = 360 / count;
	const atPointer = mod360(-rotation);
	return Math.floor(atPointer / sliceDeg) % count;
}

/**
 * Absolute rotation (degrees) that lands `segmentIndex` centred under the top
 * pointer, always advancing clockwise from `previous` by at least `turns` full
 * spins so a CSS transition animates forward.
 */
export function nextRotation(
	previous: number,
	segmentIndex: number,
	count: number,
	turns: number = SPIN_TURNS,
): number {
	const sliceDeg = 360 / count;
	const centerFromTop = (segmentIndex + 0.5) * sliceDeg;
	const targetMod = mod360(-centerFromTop);
	const previousMod = mod360(previous);
	const delta = mod360(targetMod - previousMod);
	return previous + turns * 360 + delta;
}

/** Minimal shape needed to resolve a roll to a segment. */
export interface WeightedSegment {
	id: string;
	weight: number;
}

/**
 * Resolve a roll in [0, 1) to a segment by cumulative weight — a faithful copy
 * of the backend's `selectSegment`, used to verify a spin client-side.
 */
export function selectSegmentFrom<T extends WeightedSegment>(
	segments: readonly T[],
	roll: number,
): T {
	if (roll <= 0) return segments[0];
	const total = segments.reduce((sum, segment) => sum + segment.weight, 0);
	const target = roll * total;
	let cumulative = 0;
	for (const segment of segments) {
		cumulative += segment.weight;
		if (target < cumulative) return segment;
	}
	return segments[segments.length - 1];
}

/** Accent colour for a segment, keyed by payout multiplier (dojo palette). */
export function segmentColor(multiplier: number): string {
	if (multiplier === 0) return "#5b4a36"; // bust — muted bronze
	if (multiplier < 1) return "#9c7b46"; // partial loss
	if (multiplier === 1) return "#c9a25a"; // push
	if (multiplier < 3) return "#e6a23c"; // modest win
	if (multiplier < 10) return "#f0d27a"; // big win
	return "#ff9f43"; // jackpot
}
