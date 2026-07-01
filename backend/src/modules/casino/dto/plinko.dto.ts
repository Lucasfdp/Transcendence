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
import { PLINKO_ROWS_OPTIONS } from "../plinko.constants";

/** Largest client seed accepted, to bound the stored audit string. */
const CLIENT_SEED_MAX_LENGTH = 64;

/** Body for a Shell Drop: the stake, an optional risk tier and client seed. */
export class PlinkoDto {
	@IsInt()
	@Min(MIN_WAGER_COINS)
	@Max(MAX_WAGER_COINS)
	stake: number;

	@IsOptional()
	@IsIn(PLINKO_ROWS_OPTIONS)
	rows?: number;

	@IsOptional()
	@IsString()
	@MaxLength(CLIENT_SEED_MAX_LENGTH)
	clientSeed?: string;
}
