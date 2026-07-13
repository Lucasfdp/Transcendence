import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "../casino.constants";
import { MONTE_CUP_COUNT } from "../monte-round.constants";

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

/**
 * Body for resolving a pending Three-Shell Monte round. The player picks a
 * visible slot position (0..N-1); the server recomputes the winning slot from
 * its own stored shuffle and compares. It never trusts a client-sent cup id.
 */
export class ResolveMonteRoundDto {
	@IsInt()
	@Min(0)
	@Max(MONTE_CUP_COUNT - 1)
	selectedSlot: number;
}
