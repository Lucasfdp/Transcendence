import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { DataSource, type EntityManager } from "typeorm";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import { lockUserForUpdate } from "../users/user-lock.util";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "./casino.constants";
import { computeRoll, generateServerSeed, hashSeed } from "./casino.fair";
import {
	MONTE_COVER_MS,
	MONTE_CUP_COUNT,
	MONTE_PREVIEW_MS,
	MONTE_RESOLVE_GRACE_MS,
	MONTE_ROUND_TTL_MS,
	MONTE_SHUFFLE_STEPS,
	type MonteRoundResolveResult,
	type MonteRoundStartResult,
	type MonteRoundStepsResult,
	type MonteSwap,
} from "./monte-round.constants";
import {
	applyShuffle,
	deriveBallStartSlot,
	deriveShuffle,
	monteStepDurations,
} from "./monte-shuffle";
import { MonteRound } from "./entities/monte-round.entity";
import { Wager } from "./entities/wager.entity";

/**
 * Commitment binding the seed, nonce, start slot and winning slot. Published
 * (as its hash) at round start and verifiable once the seed is revealed, so a
 * player can confirm the server didn't move the ball after they committed.
 */
function commit(
	serverSeed: string,
	clientSeed: string,
	nonce: number,
	ballStartSlot: number,
	winningSlot: number,
): string {
	return createHash("sha256")
		.update(`${serverSeed}:${clientSeed}:${nonce}:${ballStartSlot}:${winningSlot}`)
		.digest("hex");
}

function makeCupIds(): string[] {
	return Array.from({ length: MONTE_CUP_COUNT }, () => `cup-${randomUUID()}`);
}

/** Lead-in (preview + cover) before the first swap is due, in ms. */
const SHUFFLE_LEAD_MS = MONTE_PREVIEW_MS + MONTE_COVER_MS;

@Injectable()
export class MonteRoundService {
	constructor(private readonly dataSource: DataSource) {}

	async startRound(
		user: User,
		stake: number,
		clientSeed = "",
	): Promise<MonteRoundStartResult> {
		this.assertStake(stake);
		return this.dataSource.transaction(async (manager) => {
			const current = await lockUserForUpdate(manager, user.id);
			await this.expireOldPendingRounds(manager, current);

			const active = await manager.getRepository(MonteRound).findOne({
				where: { userId: current.id, status: "pending" },
				order: { createdAt: "DESC" },
				lock: { mode: "pessimistic_write" },
				loadEagerRelations: false,
			});
			if (active) return this.startResult(active, current.coins);

			if (current.coins < stake) {
				throw new BadRequestException("Not enough coins");
			}

			const round = await this.createRound(manager, current, stake, clientSeed);
			return this.startResult(round, current.coins);
		});
	}

	/**
	 * The player's still-open round, if any — so a client that reloaded mid-round
	 * can resume instead of leaving its already-debited stake to expire. Expires
	 * any stale pending rounds first, so a returned round is always live. Carries
	 * no winning information (same shape as {@link startRound}).
	 */
	async getActiveRound(user: User): Promise<MonteRoundStartResult | null> {
		return this.dataSource.transaction(async (manager) => {
			const current = await lockUserForUpdate(manager, user.id);
			await this.expireOldPendingRounds(manager, current);
			const active = await manager.getRepository(MonteRound).findOne({
				where: { userId: current.id, status: "pending" },
				order: { createdAt: "DESC" },
				loadEagerRelations: false,
			});
			return active ? this.startResult(active, current.coins) : null;
		});
	}

	/**
	 * Just-in-time swap delivery. Returns only the swaps whose scheduled time
	 * has already elapsed, so the full sequence — and therefore the winning slot
	 * — cannot be precomputed at round start. The client polls this while it
	 * animates, receiving the final swap right as the choice opens.
	 */
	async getSteps(
		user: User,
		roundId: string,
	): Promise<MonteRoundStepsResult> {
		const round = await this.dataSource.getRepository(MonteRound).findOne({
			where: { id: roundId },
			loadEagerRelations: false,
		});
		if (!round) throw new NotFoundException("Monte round not found");
		if (round.userId !== user.id) {
			throw new ForbiddenException("Monte round belongs to another user");
		}

		const shuffle = round.shuffle ?? [];
		const durations = monteStepDurations(shuffle.length);
		const elapsed = Date.now() - round.createdAt.getTime();

		const steps: { index: number; pair: MonteSwap }[] = [];
		let dueAt = SHUFFLE_LEAD_MS;
		for (let index = 0; index < shuffle.length; index++) {
			dueAt += durations[index];
			if (elapsed >= dueAt) steps.push({ index, pair: shuffle[index] });
		}

		return {
			roundId: round.id,
			steps,
			stepCount: shuffle.length,
			ready:
				steps.length === shuffle.length &&
				elapsed >= this.resolveGateMs(round.stepCount ?? shuffle.length),
		};
	}

	async resolveRound(
		user: User,
		roundId: string,
		selectedSlot: number,
	): Promise<MonteRoundResolveResult> {
		return this.dataSource.transaction(async (manager) => {
			const current = await lockUserForUpdate(manager, user.id);
			const round = await manager.getRepository(MonteRound).findOne({
				where: { id: roundId },
				lock: { mode: "pessimistic_write" },
				loadEagerRelations: false,
			});
			if (!round) throw new NotFoundException("Monte round not found");
			if (round.userId !== current.id) {
				throw new ForbiddenException("Monte round belongs to another user");
			}
			if (round.status !== "pending") {
				throw new BadRequestException("Monte round is already settled");
			}
			if (round.expiresAt.getTime() <= Date.now()) {
				await this.expireRound(manager, round);
				throw new BadRequestException("Monte round has expired");
			}
			if (!Number.isInteger(selectedSlot) || selectedSlot < 0 || selectedSlot >= MONTE_CUP_COUNT) {
				throw new BadRequestException("Selected slot is out of range");
			}
			// Timing gate: reject a pick that lands before the shuffle could have
			// finished on screen. Stops a bot from start → instant-resolve.
			const elapsed = Date.now() - round.createdAt.getTime();
			if (elapsed < this.resolveGateMs(round.stepCount ?? MONTE_SHUFFLE_STEPS)) {
				throw new BadRequestException("Round is still shuffling");
			}

			const won = selectedSlot === round.winningSlot;
			const multiplier = won ? MONTE_CUP_COUNT : 0;
			const payout = won ? round.stake * MONTE_CUP_COUNT : 0;
			const net = payout - round.stake;

			round.status = "resolved";
			round.selectedCupId = round.cupIds[selectedSlot] ?? null;
			round.payout = payout;
			round.net = net;
			await manager.getRepository(MonteRound).save(round);

			current.coins += payout;
			await manager.getRepository(User).save(current);

			if (net > 0) {
				const profile = await manager.getRepository(Profile).findOne({
					where: { user: { id: current.id } },
				});
				if (profile) {
					profile.totalCoinsEarned = (profile.totalCoinsEarned ?? 0) + net;
					await manager.getRepository(Profile).save(profile);
				}
			}

			await this.writeWager(manager, round, multiplier, payout, net);
			const roll = computeRoll(round.serverSeed, round.clientSeed, round.nonce);

			return {
				roundId: round.id,
				game: "monte",
				mode: "wagered",
				cupIds: round.cupIds,
				ballStartSlot: round.ballStartSlot,
				winningSlot: round.winningSlot,
				selectedSlot,
				shuffle: round.shuffle ?? [],
				won,
				multiplier,
				stake: round.stake,
				paid: round.stake,
				payout,
				net,
				coins: current.coins,
				fairness: {
					serverSeed: round.serverSeed,
					serverSeedHash: round.serverSeedHash,
					clientSeed: round.clientSeed,
					nonce: round.nonce,
					roll,
					rolls: [roll],
					commitHash: round.commitHash,
				},
			};
		});
	}

	/**
	 * Settle every round whose TTL has passed, regardless of owner — the
	 * background sweeper's entry point. Each round is expired in its own
	 * transaction under the owner's row lock (the same lock a resolve takes), so
	 * this is race-safe against a concurrent resolve and idempotent across
	 * multiple backend replicas: whoever gets the lock first wins, and everyone
	 * else sees the round is no longer pending. Returns how many it settled.
	 */
	async expireStaleRounds(): Promise<number> {
		const pending = await this.dataSource.getRepository(MonteRound).find({
			where: { status: "pending" },
			loadEagerRelations: false,
		});
		let expired = 0;
		for (const round of pending) {
			if (round.expiresAt.getTime() > Date.now()) continue;
			const didExpire = await this.dataSource.transaction(async (manager) => {
				await lockUserForUpdate(manager, round.userId);
				const locked = await manager.getRepository(MonteRound).findOne({
					where: { id: round.id },
					lock: { mode: "pessimistic_write" },
					loadEagerRelations: false,
				});
				if (!locked || locked.status !== "pending") return false;
				if (locked.expiresAt.getTime() > Date.now()) return false;
				locked.user = { id: round.userId } as User;
				await this.expireRound(manager, locked);
				return true;
			});
			if (didExpire) expired++;
		}
		return expired;
	}

	private async createRound(
		manager: EntityManager,
		current: User,
		stake: number,
		clientSeed: string,
	): Promise<MonteRound> {
		const nonce = current.wagerCount ?? 0;
		const serverSeed = generateServerSeed();
		const cupIds = makeCupIds();
		const ballStartSlot = deriveBallStartSlot(serverSeed, clientSeed, nonce);
		const shuffle = deriveShuffle(
			serverSeed,
			clientSeed,
			nonce,
			MONTE_SHUFFLE_STEPS,
		);
		const winningSlot = applyShuffle(ballStartSlot, shuffle);

		const round = manager.getRepository(MonteRound).create({
			user: { id: current.id } as User,
			userId: current.id,
			stake,
			cupIds,
			// Kept for the wager audit's segmentId; not exposed before resolve.
			ballCupId: cupIds[winningSlot],
			ballStartSlot,
			winningSlot,
			shuffle,
			stepCount: MONTE_SHUFFLE_STEPS,
			serverSeed,
			serverSeedHash: hashSeed(serverSeed),
			clientSeed,
			nonce,
			commitHash: commit(serverSeed, clientSeed, nonce, ballStartSlot, winningSlot),
			// Legacy NOT NULL column: bind the same commitment so the constraint holds.
			winningCupHash: commit(
				serverSeed,
				clientSeed,
				nonce,
				ballStartSlot,
				winningSlot,
			),
			status: "pending",
			expiresAt: new Date(Date.now() + MONTE_ROUND_TTL_MS),
		});

		current.coins -= stake;
		current.wagerCount = nonce + 1;
		await manager.getRepository(User).save(current);
		return manager.getRepository(MonteRound).save(round);
	}

	private async expireOldPendingRounds(
		manager: EntityManager,
		user: User,
	): Promise<void> {
		const pending = await manager.getRepository(MonteRound).find({
			where: { userId: user.id, status: "pending" },
			lock: { mode: "pessimistic_write" },
			loadEagerRelations: false,
		});
		for (const round of pending) {
			if (round.expiresAt.getTime() <= Date.now()) {
				round.user = { id: user.id } as User;
				await this.expireRound(manager, round);
			}
		}
	}

	private async expireRound(
		manager: EntityManager,
		round: MonteRound,
	): Promise<void> {
		round.status = "expired";
		round.payout = 0;
		round.net = -round.stake;
		await manager.getRepository(MonteRound).save(round);
		await this.writeWager(manager, round, 0, 0, -round.stake);
	}

	private async writeWager(
		manager: EntityManager,
		round: MonteRound,
		multiplier: number,
		payout: number,
		net: number,
	): Promise<void> {
		const userId = round.user?.id ?? round.userId;
		const wagersRepo = manager.getRepository(Wager);
		await wagersRepo.save(
			wagersRepo.create({
				user: { id: userId } as User,
				game: "monte",
				mode: "wagered",
				stake: round.stake,
				paid: round.stake,
				segmentId: round.ballCupId,
				multiplier,
				payout,
				net,
				serverSeedHash: round.serverSeedHash,
				serverSeed: round.serverSeed,
				clientSeed: round.clientSeed,
				nonce: round.nonce,
			}),
		);
	}

	/** Earliest elapsed time (ms since createdAt) at which a resolve is allowed. */
	private resolveGateMs(stepCount: number): number {
		const shuffleMs = monteStepDurations(stepCount).reduce(
			(sum, ms) => sum + ms,
			0,
		);
		return Math.max(0, SHUFFLE_LEAD_MS + shuffleMs - MONTE_RESOLVE_GRACE_MS);
	}

	private startResult(round: MonteRound, coins: number): MonteRoundStartResult {
		const stepCount = round.stepCount ?? MONTE_SHUFFLE_STEPS;
		const stepDurations = monteStepDurations(stepCount);
		return {
			roundId: round.id,
			cupIds: round.cupIds,
			ballStartSlot: round.ballStartSlot,
			stepCount,
			stepDurations,
			shuffleLeadMs: SHUFFLE_LEAD_MS,
			totalShuffleMs: stepDurations.reduce((sum, ms) => sum + ms, 0),
			serverSeedHash: round.serverSeedHash,
			commitHash: round.commitHash,
			clientSeed: round.clientSeed,
			nonce: round.nonce,
			stake: round.stake,
			expiresAt: round.expiresAt.toISOString(),
			coins,
		};
	}

	private assertStake(stake: number): void {
		if (
			!Number.isInteger(stake) ||
			stake < MIN_WAGER_COINS ||
			stake > MAX_WAGER_COINS
		) {
			throw new BadRequestException(
				`Stake must be a whole number between ${MIN_WAGER_COINS} and ${MAX_WAGER_COINS} coins`,
			);
		}
	}
}
