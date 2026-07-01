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
	DEFAULT_ROWS,
	PLINKO_ROWS_OPTIONS,
	type PlinkoRows,
	type PlinkoView,
	evaluateDrop,
	plinkoTierView,
} from "./plinko.constants";

/**
 * Shell Drop (Plinko) service.
 *
 * The player picks a risk tier (row-count); the engine draws one independent
 * roll per row and {@link evaluateDrop} resolves the binomial bucket the shell
 * lands in. Center buckets pay less than the stake, edges pay big — the shared
 * {@link CasinoEngine} handles all coin movement and the audit row; this
 * service validates the row-count and stake and supplies the per-spin decision.
 */
@Injectable()
export class PlinkoService {
	constructor(private readonly engine: CasinoEngine) {}

	/** Layout the frontend needs: row tiers, paytables, RTP, bounds and balance. */
	getPlinkoView(user: User): PlinkoView {
		return {
			rowOptions: [...PLINKO_ROWS_OPTIONS],
			defaultRows: DEFAULT_ROWS,
			tiers: PLINKO_ROWS_OPTIONS.map((rows) => plinkoTierView(rows)),
			minWager: MIN_WAGER_COINS,
			maxWager: MAX_WAGER_COINS,
			coins: user.coins,
		};
	}

	/**
	 * Resolve a Shell Drop: validate the row-count and stake, then let the
	 * engine draw `rows` rolls, pay and audit. `outcomeId` is the landed bucket
	 * ("bucket-<k>") and `multiplier` is that bucket's net-neutral payout.
	 */
	async drop(
		user: User,
		rows: number | undefined,
		stake: number,
		options: SpinOptions = {},
	): Promise<SpinResolution> {
		const rowCount = rows ?? DEFAULT_ROWS;
		if (!PLINKO_ROWS_OPTIONS.includes(rowCount as PlinkoRows)) {
			throw new BadRequestException(
				`Rows must be one of: ${PLINKO_ROWS_OPTIONS.join(", ")}`,
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
			{
				game: "drop",
				mode: "wagered",
				stake,
				paid: stake,
				options,
				rolls: rowCount,
			},
			(rollAt) =>
				evaluateDrop(
					rowCount,
					Array.from({ length: rowCount }, (_, row) => rollAt(row)),
				),
		);
	}
}
