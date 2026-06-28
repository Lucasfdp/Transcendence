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
	SLOT_REEL_COUNT,
	type SlotsView,
	evaluate,
	selectSymbol,
	slotSymbolViews,
	slotsRtp,
} from "./slots.constants";

/**
 * Shrine Slots service.
 *
 * Spins three reels from one provably-fair multi-roll (`SLOT_REEL_COUNT`
 * independent rolls), maps each roll to a symbol via {@link selectSymbol}, and
 * pays by {@link evaluate}. All coin movement and the audit row are handled by
 * the shared {@link CasinoEngine}; this service validates the stake and supplies
 * the per-spin decision.
 */
@Injectable()
export class SlotsService {
	constructor(private readonly engine: CasinoEngine) {}

	/** Layout the frontend needs: reel, paytable, RTP, bounds and balance. */
	getSlotsView(user: User): SlotsView {
		return {
			symbols: slotSymbolViews(),
			reelCount: SLOT_REEL_COUNT,
			rtp: slotsRtp(),
			minWager: MIN_WAGER_COINS,
			maxWager: MAX_WAGER_COINS,
			coins: user.coins,
		};
	}

	/**
	 * Resolve a Shrine Slots spin: validate the stake, then let the engine draw
	 * `SLOT_REEL_COUNT` rolls, pay and audit. `outcomeId` is the pipe-joined reel
	 * symbols; `multiplier` is the paytable value for three-of-a-kind, else 0.
	 */
	async slots(
		user: User,
		stake: number,
		options: SpinOptions = {},
	): Promise<SpinResolution> {
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
			{
				game: "slots",
				mode: "wagered",
				stake,
				paid: stake,
				options,
				rolls: SLOT_REEL_COUNT,
			},
			(rollAt) =>
				evaluate(
					Array.from({ length: SLOT_REEL_COUNT }, (_, reel) =>
						selectSymbol(rollAt(reel)).id,
					),
				),
		);
	}
}
