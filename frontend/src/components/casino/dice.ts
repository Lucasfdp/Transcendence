/**
 * Pure Koi Dice logic — faithful copies of the backend's `diceValue`,
 * `diceWin` and `diceMultiplier`, kept free of React/DOM so the roll→value
 * maths can be verified in isolation, the modal can show a live win-chance and
 * payout as the player drags the target slider, and the provably-fair panel
 * can recompute a spin client-side.
 */
import type { DiceDirection } from "../../features/hub/api";

/** Number of equally-likely dice values: 0..DICE_RANGE-1. */
export const DICE_RANGE = 100;

/** Largest dice value the roll can land on. */
export const DICE_MAX_VALUE = DICE_RANGE - 1;

/** Map a roll in [0, 1) to a dice value (matches the server byte-for-byte). */
export function diceValue(roll: number): number {
	return Math.min(Math.floor(roll * DICE_RANGE), DICE_MAX_VALUE);
}

/** The outcome id the server stores for a rolled value. */
export function diceOutcomeId(value: number): string {
	return `roll-${value}`;
}

/** Count of dice values that win a bet on `direction` at `target`. */
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

/** Net-neutral payout multiplier for a bet on `direction` at `target`. */
export function diceMultiplier(
	direction: DiceDirection,
	target: number,
): number {
	return DICE_RANGE / diceWinningOutcomes(direction, target);
}

/** Win probability (0–1) for a bet on `direction` at `target`. */
export function diceWinChance(
	direction: DiceDirection,
	target: number,
): number {
	return diceWinningOutcomes(direction, target) / DICE_RANGE;
}
