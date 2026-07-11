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
	MONTE_CUP_COUNT,
	MONTE_ROUND_TTL_MS,
	type MonteRoundResolveResult,
	type MonteRoundStartResult,
} from "./monte-round.constants";
import { winningShell } from "./monte.constants";
import { MonteRound } from "./entities/monte-round.entity";
import { Wager } from "./entities/wager.entity";

/** Hash committed before reveal to bind the seed, nonce and winning cup. */
function hashWinningCup(
	serverSeed: string,
	clientSeed: string,
	nonce: number,
	ballCupId: string,
): string {
	return createHash("sha256")
		.update(`${serverSeed}:${clientSeed}:${nonce}:${ballCupId}`)
		.digest("hex");
}

function makeCupIds(): string[] {
	return Array.from({ length: MONTE_CUP_COUNT }, () => `cup-${randomUUID()}`);
}

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

	async resolveRound(
		user: User,
		roundId: string,
		selectedCupId: string,
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
			if (!round.cupIds.includes(selectedCupId)) {
				throw new BadRequestException("Selected cup is not in this round");
			}

			const won = selectedCupId === round.ballCupId;
			const multiplier = won ? MONTE_CUP_COUNT : 0;
			const payout = won ? round.stake * MONTE_CUP_COUNT : 0;
			const net = payout - round.stake;

			round.status = "resolved";
			round.selectedCupId = selectedCupId;
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
				ballCupId: round.ballCupId,
				selectedCupId,
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
					winningCupHash: round.winningCupHash,
				},
			};
		});
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
		const ballCupId =
			cupIds[
				winningShell(
					computeRoll(serverSeed, clientSeed, nonce),
					MONTE_CUP_COUNT,
				)
			];
		const round = manager.getRepository(MonteRound).create({
			user: { id: current.id } as User,
			userId: current.id,
			stake,
			cupIds,
			ballCupId,
			serverSeed,
			serverSeedHash: hashSeed(serverSeed),
			clientSeed,
			nonce,
			winningCupHash: hashWinningCup(serverSeed, clientSeed, nonce, ballCupId),
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

	private startResult(round: MonteRound, coins: number): MonteRoundStartResult {
		return {
			roundId: round.id,
			cupIds: round.cupIds,
			ballCupId: round.ballCupId,
			serverSeedHash: round.serverSeedHash,
			winningCupHash: round.winningCupHash,
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
