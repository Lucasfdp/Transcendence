/**
 * Three-Shell Monte — catalogue & economy constants.
 *
 * A pearl hides under one of three shells; the player watches the reveal, the
 * shells cover it, then chooses a shell after the shuffle. A correct guess pays
 * 3× the stake, a wrong one loses it.
 *
 * Economy design: with N equally-likely shells, a correct guess has probability
 * 1/N and pays N×, so the expected return is exactly 1.0 for every N —
 * net-neutral, no house edge. The shared engine moves the coins; this module
 * owns only the shell maths.
 */

/** Three-Shell Monte is fixed to the classic three-shell layout. */
export const MONTE_SHELL_OPTIONS = [3] as const;

/** A chosen shell count. */
export type MonteShells = (typeof MONTE_SHELL_OPTIONS)[number];

/** Default shell count when the player does not pick a risk tier. */
export const DEFAULT_SHELLS: MonteShells = 3;

/**
 * Map a roll in [0, 1) to the winning shell index for `shells` equal bands. The
 * `Math.min` clamp guards the top of the range against floating-point drift so a
 * roll can never resolve to a non-existent shell.
 */
export function winningShell(roll: number, shells: number): number {
	return Math.min(Math.floor(roll * shells), shells - 1);
}

/**
 * Return-to-player for a single guess at `shells` shells: probability of a
 * correct guess (1/N) times the payout (N×). Enumerated over the equally-likely
 * shells so the net-neutral property is computed, not assumed.
 */
export function monteRtp(shells: number): number {
	const probability = 1 / shells;
	let expectedReturn = 0;
	for (let winning = 0; winning < shells; winning++) {
		// Take pick = 0 as representative: payout is N only on the matching shell.
		const payout = winning === 0 ? shells : 0;
		expectedReturn += probability * payout;
	}
	return expectedReturn;
}

/** Everything the frontend needs to render Three-Shell Monte. */
export interface MonteConfig {
	/** Selectable shell counts (risk tiers). */
	shellOptions: number[];
	/** Default shell count. */
	defaultShells: number;
	/** Return-to-player (1.0 = net-neutral) — identical for every tier. */
	rtp: number;
	/** Accepted wager bounds (shared with the wheel). */
	minWager: number;
	maxWager: number;
	/** The requesting player's current coin balance. */
	coins: number;
}
