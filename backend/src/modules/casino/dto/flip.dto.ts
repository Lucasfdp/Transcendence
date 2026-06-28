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
import { FLIP_SIDES, type FlipSide } from "../flip.constants";

/** Largest client seed accepted, to bound the stored audit string. */
const CLIENT_SEED_MAX_LENGTH = 64;

/** Body for a Shell Flip: the stake, the called side and an optional client seed. */
export class FlipDto {
	@IsInt()
	@Min(MIN_WAGER_COINS)
	@Max(MAX_WAGER_COINS)
	stake: number;

	@IsIn(FLIP_SIDES)
	pick: FlipSide;

	@IsOptional()
	@IsString()
	@MaxLength(CLIENT_SEED_MAX_LENGTH)
	clientSeed?: string;
}
