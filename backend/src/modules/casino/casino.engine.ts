import {
	BadRequestException,
	ForbiddenException,
	HttpException,
	Injectable,
	InternalServerErrorException,
} from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import type {
	CasinoGame,
	SpinMode,
	SpinOptions,
	SpinResolution,
} from "./casino.constants";
import { computeRoll, computeRolls, generateServerSeed, hashSeed } from "./casino.fair";
import { Wager } from "./entities/wager.entity";

export type { CasinoGame } from "./casino.constants";

/** Number of rolls drawn for a spin when a game does not ask for more. */
const DEFAULT_ROLL_COUNT = 1;

/**
 * A game's decision function. It receives a `rollAt` accessor (each call returns
 * one independent roll in [0, 1) for the spin) and returns the resolved outcome.
 * Single-roll games read `rollAt(0)`; Shrine Slots reads `rollAt(0..2)`.
 */
export type Decide = (rollAt: (index: number) => number) => {
	outcomeId: string;
	multiplier: number;
};

/** Everything the engine needs to resolve one spin for any game. */
export interface ResolveInput {
	/** Which game is spinning — written to the audit row. */
	game: CasinoGame;
	mode: SpinMode;
	/** Coins the payout scales from. */
	stake: number;
	/** Coins actually debited (0 for a free spin). */
	paid: number;
	/** Player-supplied client seed and optional server-seed override (tests). */
	options: SpinOptions;
	/** How many independent rolls to draw. Defaults to 1. */
	rolls?: number;
	/**
	 * Optional game-specific guard, run inside the transaction *after* the user
	 * row is locked (e.g. the daily-free-spin check). Throw an HttpException to
	 * abort the spin; the engine surfaces it unchanged.
	 */
	precheck?: (manager: EntityManager, user: User) => Promise<void>;
}

/**
 * Shared wager engine for the gambling den.
 *
 * Owns the locked, atomic, provably-fair core every game reuses: it locks the
 * player's row, draws the provably-fair roll(s), hands them to the game's
 * `decide` function, applies the coin delta, credits positive winnings to the
 * lifetime stat, and writes one immutable audit row — all inside a single
 * transaction. Games supply only a constants table and a `decide` function; the
 * money movement and fairness guarantees live here once.
 */
@Injectable()
export class CasinoEngine {
	constructor(private readonly dataSource: DataSource) {}

	/**
	 * Resolve one spin for any game. Runs the whole flow under a pessimistic
	 * write-lock inside a single transaction; unexpected failures are normalised
	 * to a 500 while validation errors (HttpException) pass through untouched.
	 */
	async resolveSpin(
		user: User,
		resolveInput: ResolveInput,
		decide: Decide,
	): Promise<SpinResolution> {
		try {
			return await this.dataSource.transaction(async (manager) => {
				const current = await this.lockUser(manager, user.id);
				if (resolveInput.precheck) {
					await resolveInput.precheck(manager, current);
				}
				if (current.coins < resolveInput.paid) {
					throw new BadRequestException("Not enough coins");
				}
				return this.apply(manager, current, resolveInput, decide);
			});
		} catch (err: unknown) {
			if (err instanceof HttpException) throw err;
			throw new InternalServerErrorException("Failed to resolve the spin");
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

	/**
	 * Roll provably-fair, run the game's `decide`, apply the coin delta, credit
	 * winnings, and write the audit row. Caller already holds the write-lock.
	 */
	private async apply(
		manager: EntityManager,
		current: User,
		resolveInput: ResolveInput,
		decide: Decide,
	): Promise<SpinResolution> {
		const usersRepo = manager.getRepository(User);
		const wagersRepo = manager.getRepository(Wager);

		const clientSeed = resolveInput.options.clientSeed ?? "";
		const serverSeed = resolveInput.options.serverSeed ?? generateServerSeed();
		const serverSeedHash = hashSeed(serverSeed);
		const nonce = await wagersRepo.count({
			where: { user: { id: current.id } },
		});

		const count = resolveInput.rolls ?? DEFAULT_ROLL_COUNT;
		// Single-roll games keep the legacy "<clientSeed>:<nonce>" scheme so their
		// rolls stay byte-identical; multi-roll games append ":<i>" per reel.
		const rolls =
			count === DEFAULT_ROLL_COUNT
				? [computeRoll(serverSeed, clientSeed, nonce)]
				: computeRolls(serverSeed, clientSeed, nonce, count);
		const rollAt = (index: number): number => {
			const roll = rolls[index];
			if (roll === undefined) {
				throw new RangeError(`roll index ${index} out of range`);
			}
			return roll;
		};

		const { outcomeId, multiplier } = decide(rollAt);
		const payout = Math.floor(resolveInput.stake * multiplier);
		const net = payout - resolveInput.paid;

		current.coins = current.coins - resolveInput.paid + payout;
		await usersRepo.save(current);

		// Count positive net winnings towards the player's lifetime earnings.
		// Losses and pushes (net ≤ 0) never reduce the stat.
		const earned = Math.max(0, net);
		if (earned > 0) {
			const profilesRepo = manager.getRepository(Profile);
			const profile = await profilesRepo.findOne({
				where: { user: { id: current.id } },
			});
			if (profile) {
				profile.totalCoinsEarned = (profile.totalCoinsEarned ?? 0) + earned;
				await profilesRepo.save(profile);
			}
		}

		await wagersRepo.save(
			wagersRepo.create({
				user: { id: current.id } as User,
				game: resolveInput.game,
				mode: resolveInput.mode,
				stake: resolveInput.stake,
				paid: resolveInput.paid,
				segmentId: outcomeId,
				multiplier,
				payout,
				net,
				serverSeedHash,
				serverSeed,
				clientSeed,
				nonce,
			}),
		);

		return {
			game: resolveInput.game,
			mode: resolveInput.mode,
			outcomeId,
			multiplier,
			stake: resolveInput.stake,
			paid: resolveInput.paid,
			payout,
			net,
			coins: current.coins,
			fairness: {
				serverSeed,
				serverSeedHash,
				clientSeed,
				nonce,
				roll: rolls[0],
				rolls,
			},
		};
	}
}
