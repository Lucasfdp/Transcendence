import { Injectable } from "@nestjs/common";
import { User } from "../users/entities/user.entity";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "./casino.constants";
import {
	DEFAULT_SHELLS,
	MONTE_SHELL_OPTIONS,
	type MonteConfig,
	monteRtp,
} from "./monte.constants";

/**
 * Three-Shell Monte config provider.
 *
 * The playable round lives in {@link MonteRoundService} — a committed, two-step,
 * server-authoritative shuffle. This service only supplies the static layout the
 * frontend renders (shell tiers, RTP, wager bounds and the balance); the
 * controller attaches any in-progress round for resume.
 */
@Injectable()
export class MonteService {
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
}
