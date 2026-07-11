import {
	IsInt,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min,
} from "class-validator";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "../casino.constants";

/** Largest client seed accepted, matching the legacy Monte DTO. */
const CLIENT_SEED_MAX_LENGTH = 64;

/** Body for starting a committed Three-Shell Monte round. */
export class StartMonteRoundDto {
	@IsInt()
	@Min(MIN_WAGER_COINS)
	@Max(MAX_WAGER_COINS)
	stake: number;

	@IsOptional()
	@IsString()
	@MaxLength(CLIENT_SEED_MAX_LENGTH)
	clientSeed?: string;
}

/** Body for resolving a pending Three-Shell Monte round. */
export class ResolveMonteRoundDto {
	@IsString()
	selectedCupId: string;
}
