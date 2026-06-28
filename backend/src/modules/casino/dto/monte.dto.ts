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
import { MONTE_SHELL_OPTIONS } from "../monte.constants";

/** Largest client seed accepted, to bound the stored audit string. */
const CLIENT_SEED_MAX_LENGTH = 64;

/**
 * Body for a Three-Shell Monte guess. `pick` is bounded below here; the
 * cross-field `pick < shells` rule is enforced in {@link MonteService} because
 * `shells` defaults server-side.
 */
export class MonteDto {
	@IsInt()
	@Min(MIN_WAGER_COINS)
	@Max(MAX_WAGER_COINS)
	stake: number;

	@IsInt()
	@Min(0)
	pick: number;

	@IsOptional()
	@IsIn(MONTE_SHELL_OPTIONS)
	shells?: number;

	@IsOptional()
	@IsString()
	@MaxLength(CLIENT_SEED_MAX_LENGTH)
	clientSeed?: string;
}
