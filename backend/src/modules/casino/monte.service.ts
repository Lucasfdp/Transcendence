import { BadRequestException, Injectable } from "@nestjs/common";
import { User } from "../users/entities/user.entity";
import {
	MAX_WAGER_COINS,
	MIN_WAGER_COINS,
	type SpinOptions,
	type SpinResolution,
} from "./casino.constants";
import { CasinoEngine } from "./casino.engine";
import {
	DEFAULT_SHELLS,
	MONTE_SHELL_OPTIONS,
	type MonteConfig,
	type MonteShells,
	monteRtp,
	winningShell,
} from "./monte.constants";

/**
 * Three-Shell Monte service.
 *
 * The player points at a shell among N (the risk tier); one provably-fair roll
 * reveals the pearl's shell via {@link winningShell}. A correct guess pays N×,
 * a wrong one loses the stake. The shared {@link CasinoEngine} handles all coin
 * movement and the audit row; this service validates input (including the
 * cross-field `pick < shells` rule) and supplies the per-roll decision.
 */
@Injectable()
export class MonteService {
	constructor(private readonly engine: CasinoEngine) {}

	/** Layout the frontend needs: shell tiers, default, RTP, bounds and balance. */
	getMonteConfig(user: User): MonteConfig {
		return {
			shellOptions: [...MONTE_SHELL_OPTIONS],
			defaultShells: DEFAULT_SHELLS,
			rtp: monteRtp(DEFAULT_SHELLS),
			minWager: MIN_WAGER_COINS,
			maxWager: MAX_WAGER_COINS,
			coins: user.coins,
		};
	}

	/**
	 * Resolve a Monte guess: validate the shell count, pick and stake, then let
	 * the engine roll, pay and audit. `outcomeId` is the pearl's shell
	 * ("shell-<n>") and `multiplier` is N on a win, 0 on a miss.
	 */
	async monte(
		user: User,
		pick: number,
		shells: number | undefined,
		stake: number,
		options: SpinOptions = {},
	): Promise<SpinResolution> {
		const shellCount = shells ?? DEFAULT_SHELLS;
		if (!MONTE_SHELL_OPTIONS.includes(shellCount as MonteShells)) {
			throw new BadRequestException(
				`Shells must be one of: ${MONTE_SHELL_OPTIONS.join(", ")}`,
			);
		}
		if (!Number.isInteger(pick) || pick < 0 || pick >= shellCount) {
			throw new BadRequestException(
				`Pick must be a whole number between 0 and ${shellCount - 1}`,
			);
		}
		if (
			!Number.isInteger(stake) ||
			stake < MIN_WAGER_COINS ||
			stake > MAX_WAGER_COINS
		) {
			throw new BadRequestException(
				`Stake must be a whole number between ${MIN_WAGER_COINS} and ${MAX_WAGER_COINS} coins`,
			);
		}

		return this.engine.resolveSpin(
			user,
			{ game: "monte", mode: "wagered", stake, paid: stake, options },
			(rollAt) => {
				const winning = winningShell(rollAt(0), shellCount);
				return {
					outcomeId: `shell-${winning}`,
					multiplier: winning === pick ? shellCount : 0,
				};
			},
		);
	}
}
