import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { MoreThanOrEqual, Repository } from "typeorm";
import { User } from "../users/entities/user.entity";
import {
	FREE_SPIN_STAKE_COINS,
	MAX_WAGER_COINS,
	MIN_WAGER_COINS,
	selectSegment,
	type SpinMode,
	type SpinOptions,
	type SpinResult,
	WHEEL_SEGMENTS,
	type WheelView,
	wheelRtp,
	wheelSegmentViews,
} from "./casino.constants";
import { CasinoEngine, type ResolveInput } from "./casino.engine";
import { Wager } from "./entities/wager.entity";

/**
 * Fortune Wheel service — the dojo's back-alley gambling den.
 *
 * Players spend the same cosmetic-only `coins` they earn from matches; nothing
 * here grants a gameplay advantage. Every spin resolves server-side inside a
 * single transaction with a pessimistic write-lock on the player's row, so a
 * client can never choose its own outcome or double-spend on concurrent
 * requests. Each spin writes one immutable provably-fair audit row.
 */
@Injectable()
export class CasinoService {
	constructor(
		@InjectRepository(Wager)
		private readonly wagersRepo: Repository<Wager>,
		private readonly engine: CasinoEngine,
	) {}

	/**
	 * Build the wheel view for a player: layout + odds + bounds + balance, plus
	 * whether their daily free spin is still available. Read-only.
	 */
	async getWheelView(user: User): Promise<WheelView> {
		const freeSpinAvailable = !(await this.findTodaysFreeSpin(
			this.wagersRepo,
			user.id,
		));
		return {
			segments: wheelSegmentViews(),
			rtp: wheelRtp(),
			freeStake: FREE_SPIN_STAKE_COINS,
			minWager: MIN_WAGER_COINS,
			maxWager: MAX_WAGER_COINS,
			coins: user.coins,
			freeSpinAvailable,
		};
	}

	/**
	 * Spin the daily free wheel. The house gifts a FREE_SPIN_STAKE_COINS stake;
	 * the player pays nothing and keeps any winnings. Allowed once per UTC day.
	 */
	async freeSpin(user: User, options: SpinOptions = {}): Promise<SpinResult> {
		return this.spinWheel(user, "free", FREE_SPIN_STAKE_COINS, 0, options, {
			// The daily-free-spin guard runs inside the engine's transaction,
			// after the user row is locked, so concurrent requests can't both pass.
			precheck: async (manager, current) => {
				if (await this.findTodaysFreeSpin(manager.getRepository(Wager), current.id)) {
					throw new BadRequestException("Free spin already used today");
				}
			},
		});
	}

	/**
	 * Spin the wagered wheel: debit `stake`, credit floor(stake × multiplier).
	 * The wheel is net-neutral (RTP 1.0) — no house edge, only variance.
	 */
	async wageredSpin(
		user: User,
		stake: number,
		options: SpinOptions = {},
	): Promise<SpinResult> {
		if (
			!Number.isInteger(stake) ||
			stake < MIN_WAGER_COINS ||
			stake > MAX_WAGER_COINS
		) {
			throw new BadRequestException(
				`Stake must be a whole number between ${MIN_WAGER_COINS} and ${MAX_WAGER_COINS} coins`,
			);
		}

		return this.spinWheel(user, "wagered", stake, stake, options);
	}

	/**
	 * Resolve a wheel spin through the shared engine, then enrich the generic
	 * resolution with the winning {@link WheelSegment} for the client.
	 */
	private async spinWheel(
		user: User,
		mode: SpinMode,
		stake: number,
		paid: number,
		options: SpinOptions,
		extra: { precheck?: ResolveInput["precheck"] } = {},
	): Promise<SpinResult> {
		const resolution = await this.engine.resolveSpin(
			user,
			{ game: "wheel", mode, stake, paid, options, precheck: extra.precheck },
			(rollAt) => {
				const segment = selectSegment(rollAt(0));
				return { outcomeId: segment.id, multiplier: segment.multiplier };
			},
		);
		const segment =
			WHEEL_SEGMENTS.find((candidate) => candidate.id === resolution.outcomeId) ??
			WHEEL_SEGMENTS[0];
		return { ...resolution, segment };
	}

	/**
	 * The player's free-spin row for the current UTC day, or null if none yet.
	 *
	 * Bug Audit 3.2: this used to match on `mode: "free"` alone, with no
	 * `game` filter. Only the wheel writes `mode: "free"` today, so it worked
	 * by accident — but `Wager` already carries a `game` discriminator
	 * precisely so per-game state like this doesn't collide, and the moment
	 * any other game grows a free mode, it would silently consume (or be
	 * consumed by) the wheel's daily spin. Scope explicitly to "wheel".
	 */
	private async findTodaysFreeSpin(
		repo: Repository<Wager>,
		userId: number,
	): Promise<Wager | null> {
		return repo.findOne({
			where: {
				user: { id: userId },
				game: "wheel",
				mode: "free",
				createdAt: MoreThanOrEqual(startOfUtcDay()),
			},
		});
	}

}

/** Midnight (UTC) at the start of `now`'s day. */
function startOfUtcDay(now: Date = new Date()): Date {
	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
}
