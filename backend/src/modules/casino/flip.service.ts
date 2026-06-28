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
	FLIP_MULTIPLIER,
	FLIP_SIDES,
	type FlipConfig,
	type FlipSide,
	flipRtp,
	flipSide,
} from "./flip.constants";

/**
 * Shell Flip service — the gambling den's coin-toss.
 *
 * The player calls a shell side; one provably-fair roll decides the landed side
 * via {@link flipSide}. A correct call pays {@link FLIP_MULTIPLIER}×, a wrong
 * one loses the stake. All money movement and the audit row are handled by the
 * shared {@link CasinoEngine}; this service only validates input and supplies
 * the per-roll decision.
 */
@Injectable()
export class FlipService {
	constructor(private readonly engine: CasinoEngine) {}

	/** Layout the frontend needs: multiplier, RTP, bounds and the player's balance. */
	getFlipConfig(user: User): FlipConfig {
		return {
			multiplier: FLIP_MULTIPLIER,
			rtp: flipRtp(),
			minWager: MIN_WAGER_COINS,
			maxWager: MAX_WAGER_COINS,
			coins: user.coins,
		};
	}

	/**
	 * Resolve a Shell Flip: validate the call and stake, then let the engine roll,
	 * pay and audit. Returns the generic resolution (`outcomeId` is the landed
	 * side, `multiplier` is 2 on a win and 0 on a miss).
	 */
	async flip(
		user: User,
		pick: FlipSide,
		stake: number,
		options: SpinOptions = {},
	): Promise<SpinResolution> {
		if (!FLIP_SIDES.includes(pick)) {
			throw new BadRequestException(
				`Pick must be one of: ${FLIP_SIDES.join(", ")}`,
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
			{ game: "flip", mode: "wagered", stake, paid: stake, options },
			(rollAt) => {
				const side = flipSide(rollAt(0));
				return {
					outcomeId: side,
					multiplier: side === pick ? FLIP_MULTIPLIER : 0,
				};
			},
		);
	}
}
