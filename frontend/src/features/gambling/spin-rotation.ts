/**
 * Shared rotation-angle maths for any casino game that spins a dial and has
 * to land it on a known target angle: Fortune Wheel's wheel face today, and
 * (per the casino UI/UX pass) Shell Flip's coin next. Both are the same
 * underlying problem — "spin forward from wherever the dial currently rests,
 * at least N full turns, and land exactly on this target angle" — so the
 * angle maths lives here once instead of being re-derived per game. No
 * React/DOM; pure numbers, safe to unit-check in isolation.
 */

/** Normalise any angle to the [0, 360) range. */
export function mod360(angle: number): number {
	return ((angle % 360) + 360) % 360;
}

/**
 * The absolute rotation (degrees) that lands exactly on `targetDeg` (mod
 * 360), always advancing *forward* from `previous` by at least `turns` full
 * spins. Guarantees the result is always `> previous`, so a CSS transition
 * or a JS-driven rotation always turns the same direction and never has to
 * snap backward to reach its target.
 */
export function spinToAngle(
	previous: number,
	targetDeg: number,
	turns: number,
): number {
	const targetMod = mod360(targetDeg);
	const previousMod = mod360(previous);
	const delta = mod360(targetMod - previousMod);
	return previous + turns * 360 + delta;
}
