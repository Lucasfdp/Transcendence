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
