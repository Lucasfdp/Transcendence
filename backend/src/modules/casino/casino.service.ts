import {
	BadRequestException,
	ForbiddenException,
	HttpException,
	Injectable,
	InternalServerErrorException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, type EntityManager, MoreThanOrEqual, Repository } from "typeorm";
import { User } from "../users/entities/user.entity";
import {
	FREE_SPIN_STAKE_COINS,
	MAX_WAGER_COINS,
	MIN_WAGER_COINS,
	selectSegment,
	type SpinMode,
	type SpinOptions,
	type SpinResult,
	type WheelView,
	wheelRtp,
	wheelSegmentViews,
} from "./casino.constants";
import { computeRoll, generateServerSeed, hashSeed } from "./casino.fair";
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
		private readonly dataSource: DataSource,
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
		return this.runSpin(async (manager) => {
			const current = await this.lockUser(manager, user.id);
			const wagersRepo = manager.getRepository(Wager);
			if (await this.findTodaysFreeSpin(wagersRepo, current.id)) {
				throw new BadRequestException("Free spin already used today");
			}
			return this.resolve(
				manager,
				current,
				"free",
				FREE_SPIN_STAKE_COINS,
				0,
				options,
			);
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

		return this.runSpin(async (manager) => {
			const current = await this.lockUser(manager, user.id);
			if (current.coins < stake) {
				throw new BadRequestException("Not enough coins");
			}
			return this.resolve(
				manager,
				current,
				"wagered",
				stake,
				stake,
				options,
			);
		});
	}

	/** Run a spin callback in a transaction, normalising unexpected errors. */
	private async runSpin(
		work: (manager: EntityManager) => Promise<SpinResult>,
	): Promise<SpinResult> {
		try {
			return await this.dataSource.transaction(work);
		} catch (err: unknown) {
			if (err instanceof HttpException) throw err;
			throw new InternalServerErrorException("Failed to spin the wheel");
		}
	}

	/** Load the player's row under a pessimistic write-lock for safe balance edits. */
	private async lockUser(
		manager: EntityManager,
		userId: number,
	): Promise<User> {
		// loadEagerRelations:false is REQUIRED: User eager-loads Profile, which
		// makes findOne emit a LEFT JOIN. Postgres rejects `FOR UPDATE` on the
		// nullable side of an outer join ("FOR UPDATE cannot be applied to the
		// nullable side of an outer join"), so the lock must target users alone.
		const current = await manager.getRepository(User).findOne({
			where: { id: userId },
			lock: { mode: "pessimistic_write" },
			loadEagerRelations: false,
		});
		if (!current) throw new ForbiddenException("User not found");
		return current;
	}

	/** The player's free-spin row for the current UTC day, or null if none yet. */
	private async findTodaysFreeSpin(
		repo: Repository<Wager>,
		userId: number,
	): Promise<Wager | null> {
		return repo.findOne({
			where: {
				user: { id: userId },
				mode: "free",
				createdAt: MoreThanOrEqual(startOfUtcDay()),
			},
		});
	}

	/**
	 * Resolve a spin: roll provably-fair, apply the coin delta, and write the
	 * immutable audit row. Caller must already hold the user's write-lock.
	 */
	private async resolve(
		manager: EntityManager,
		current: User,
		mode: SpinMode,
		stake: number,
		paid: number,
		options: SpinOptions,
	): Promise<SpinResult> {
		const usersRepo = manager.getRepository(User);
		const wagersRepo = manager.getRepository(Wager);

		const clientSeed = options.clientSeed ?? "";
		const serverSeed = options.serverSeed ?? generateServerSeed();
		const serverSeedHash = hashSeed(serverSeed);
		const nonce = await wagersRepo.count({
			where: { user: { id: current.id } },
		});

		const roll = computeRoll(serverSeed, clientSeed, nonce);
		const segment = selectSegment(roll);
		const payout = Math.floor(stake * segment.multiplier);
		const net = payout - paid;

		current.coins = current.coins - paid + payout;
		await usersRepo.save(current);

		await wagersRepo.save(
			wagersRepo.create({
				user: { id: current.id } as User,
				mode,
				stake,
				paid,
				segmentId: segment.id,
				multiplier: segment.multiplier,
				payout,
				net,
				serverSeedHash,
				serverSeed,
				clientSeed,
				nonce,
			}),
		);

		return {
			mode,
			segment,
			stake,
			paid,
			payout,
			net,
			coins: current.coins,
			fairness: { serverSeed, serverSeedHash, clientSeed, nonce, roll },
		};
	}
}

/** Midnight (UTC) at the start of `now`'s day. */
function startOfUtcDay(now: Date = new Date()): Date {
	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
}
