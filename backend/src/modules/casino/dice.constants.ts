/**
 * Koi Dice — catalog & economy constants.
 *
 * A clean provably-fair dice game where the player sets their own odds: they
 * pick a target line 0–99 and bet the single roll lands "under" or "over" it.
 * The payout scales with how unlikely the bet is, so the expected return is
 * always exactly 1.0 regardless of the chosen target or direction.
 *
 * Economy design: with a uniform roll over {@link DICE_RANGE} equally-likely
 * values, a bet with W winning outcomes has win probability W/DICE_RANGE and
 * pays DICE_RANGE/W, so EV = (W/DICE_RANGE) × (DICE_RANGE/W) = 1.0 for every
 * valid (direction, target) pair — net-neutral, no house edge. The shared
 * engine moves the coins; this module owns only the roll→value maths and the
 * payout derivation so it is auditable in one place.
 */

/** Number of equally-likely dice values: 0..DICE_RANGE-1. */
export const DICE_RANGE = 100;

/** Smallest dice value the roll can land on. */
export const DICE_MIN_VALUE = 0;

/** Largest dice value the roll can land on. */
export const DICE_MAX_VALUE = DICE_RANGE - 1;

/** The two betting directions a player can call. */
export const DICE_DIRECTIONS = ["under", "over"] as const;

/** A called betting direction. */
export type DiceDirection = (typeof DICE_DIRECTIONS)[number];

/**
 * Map a roll in [0, 1) to a dice value in `0..DICE_MAX_VALUE`. The `Math.min`
 * clamp guards the top of the range against floating-point drift so a roll
 * can never resolve to a non-existent value.
 */
export function diceValue(roll: number): number {
	return Math.min(Math.floor(roll * DICE_RANGE), DICE_MAX_VALUE);
}

/** The valid target range for a betting direction (inclusive bounds). */
export function targetBounds(direction: DiceDirection): {
	min: number;
	max: number;
} {
	return direction === "under"
		? { min: 1, max: DICE_MAX_VALUE }
		: { min: DICE_MIN_VALUE, max: DICE_MAX_VALUE - 1 };
}

/**
 * Count of dice values that win a bet on `direction` at `target`.
 * Under T wins on values `0..T-1` (T outcomes); over T wins on values
 * `T+1..DICE_MAX_VALUE` (DICE_MAX_VALUE - T outcomes).
 */
export function diceWinningOutcomes(
	direction: DiceDirection,
	target: number,
): number {
	return direction === "under" ? target : DICE_MAX_VALUE - target;
}

/** Whether a rolled `value` wins a bet on `direction` at `target`. */
export function diceWin(
	direction: DiceDirection,
	target: number,
	value: number,
): boolean {
	return direction === "under" ? value < target : value > target;
}

/**
 * Net-neutral payout multiplier for a bet on `direction` at `target`:
 * DICE_RANGE divided by the number of winning outcomes. EV = 1.0 by
 * construction (asserted in the spec for every valid target/direction).
 */
export function diceMultiplier(
	direction: DiceDirection,
	target: number,
): number {
	return DICE_RANGE / diceWinningOutcomes(direction, target);
}

/**
 * Return-to-player for a bet on `direction` at `target`: probability of a
 * win (winningOutcomes/DICE_RANGE) times the payout (DICE_RANGE/winningOutcomes).
 * Always exactly 1.0 — computed, not assumed.
 */
export function diceRtp(direction: DiceDirection, target: number): number {
	const winningOutcomes = diceWinningOutcomes(direction, target);
	const probability = winningOutcomes / DICE_RANGE;
	return probability * diceMultiplier(direction, target);
}

/** Everything the frontend needs to render Koi Dice and its live odds. */
export interface DiceConfig {
	/** Number of equally-likely dice values (0..range-1). */
	range: number;
	/** Smallest valid target for an "under" bet. */
	minTargetUnder: number;
	/** Largest valid target for an "under" bet. */
	maxTargetUnder: number;
	/** Smallest valid target for an "over" bet. */
	minTargetOver: number;
	/** Largest valid target for an "over" bet. */
	maxTargetOver: number;
	/** Accepted wager bounds (shared with the wheel). */
	minWager: number;
	maxWager: number;
	/** The requesting player's current coin balance. */
	coins: number;
}
