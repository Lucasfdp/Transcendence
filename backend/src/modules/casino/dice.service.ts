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
	DICE_DIRECTIONS,
	DICE_RANGE,
	type DiceConfig,
	type DiceDirection,
	diceMultiplier,
	diceValue,
	diceWin,
	targetBounds,
} from "./dice.constants";

/**
 * Koi Dice service.
 *
 * The player calls a direction ("under"/"over") and a target line 0–99; one
 * provably-fair roll decides the dice value via {@link diceValue}. A winning
 * bet pays {@link diceMultiplier} for the chosen target, a losing one loses
 * the stake. The shared {@link CasinoEngine} handles all coin movement and the
 * audit row; this service validates input — including the cross-field target
 * range, which depends on the chosen direction — and supplies the per-roll
 * decision.
 */
@Injectable()
export class DiceService {
	constructor(private readonly engine: CasinoEngine) {}

	/** Layout the frontend needs: range, target bounds, wager bounds and balance. */
	getDiceConfig(user: User): DiceConfig {
		const under = targetBounds("under");
		const over = targetBounds("over");
		return {
			range: DICE_RANGE,
			minTargetUnder: under.min,
			maxTargetUnder: under.max,
			minTargetOver: over.min,
			maxTargetOver: over.max,
			minWager: MIN_WAGER_COINS,
			maxWager: MAX_WAGER_COINS,
			coins: user.coins,
		};
	}

	/**
	 * Resolve a Koi Dice bet: validate the direction, target and stake, then let
	 * the engine roll, pay and audit. `outcomeId` is the rolled value
	 * ("roll-<value>") and `multiplier` is `diceMultiplier(direction, target)`
	 * on a win, 0 on a loss.
	 */
	async dice(
		user: User,
		direction: DiceDirection,
		target: number,
		stake: number,
		options: SpinOptions = {},
	): Promise<SpinResolution> {
		if (!DICE_DIRECTIONS.includes(direction)) {
			throw new BadRequestException(
				`Direction must be one of: ${DICE_DIRECTIONS.join(", ")}`,
			);
		}
		const bounds = targetBounds(direction);
		if (
			!Number.isInteger(target) ||
			target < bounds.min ||
			target > bounds.max
		) {
			throw new BadRequestException(
				`Target must be a whole number between ${bounds.min} and ${bounds.max} for ${direction}`,
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
			{ game: "dice", mode: "wagered", stake, paid: stake, options },
			(rollAt) => {
				const value = diceValue(rollAt(0));
				const win = diceWin(direction, target, value);
				return {
					outcomeId: `roll-${value}`,
					multiplier: win ? diceMultiplier(direction, target) : 0,
				};
			},
		);
	}
}
