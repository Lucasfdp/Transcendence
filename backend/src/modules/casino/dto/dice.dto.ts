import {
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min,
} from "class-validator";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "../casino.constants";
import { DICE_DIRECTIONS, DICE_MAX_VALUE, type DiceDirection } from "../dice.constants";

/** Largest client seed accepted, to bound the stored audit string. */
const CLIENT_SEED_MAX_LENGTH = 64;

/**
 * Body for a Koi Dice bet. `target` is bounded to the overall dice range here;
 * the direction-specific cross-field range (under 1..99, over 0..98) is
 * enforced in {@link DiceService} because it depends on `direction`.
 */
export class DiceDto {
	@IsInt()
	@Min(MIN_WAGER_COINS)
	@Max(MAX_WAGER_COINS)
	stake: number;

	@IsIn(DICE_DIRECTIONS)
	direction: DiceDirection;

	@IsInt()
	@Min(0)
	@Max(DICE_MAX_VALUE)
	target: number;

	@IsOptional()
	@IsString()
	@MaxLength(CLIENT_SEED_MAX_LENGTH)
	clientSeed?: string;
}
