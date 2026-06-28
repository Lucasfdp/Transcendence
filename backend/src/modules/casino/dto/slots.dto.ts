import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "../casino.constants";

/** Largest client seed accepted, to bound the stored audit string. */
const CLIENT_SEED_MAX_LENGTH = 64;

/** Body for a Shrine Slots spin: the coin stake plus an optional client seed. */
export class SlotsSpinDto {
	@IsInt()
	@Min(MIN_WAGER_COINS)
	@Max(MAX_WAGER_COINS)
	stake: number;

	@IsOptional()
	@IsString()
	@MaxLength(CLIENT_SEED_MAX_LENGTH)
	clientSeed?: string;
}
