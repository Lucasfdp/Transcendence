import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import { MonteRoundService } from "./monte-round.service";
import { MonteRound } from "./entities/monte-round.entity";
import { Wager } from "./entities/wager.entity";

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.coins = overrides.coins ?? 500;
	user.wagerCount = overrides.wagerCount ?? 0;
	return user;
}

describe("MonteRoundService", () => {
	let service: MonteRoundService;
	let user: User;
	let rounds: MonteRound[];
	let wagers: Wager[];
	let profile: Profile;
	let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };

	beforeEach(async () => {
		user = makeUser();
		rounds = [];
		wagers = [];
		profile = new Profile();
		profile.totalCoinsEarned = 0;

		const usersRepo = {
			findOne: jest.fn(async () => user),
			save: jest.fn(async (saved: User) => {
				user = saved;
				return user;
			}),
		};
		const roundsRepo = {
			find: jest.fn(async ({ where }: { where: { status: string } }) =>
				rounds.filter((round) => round.status === where.status),
			),
			findOne: jest.fn(
				async ({ where }: { where: { id?: string; status?: string } }) => {
					if (where.id) {
						const round = rounds.find((item) => item.id === where.id);
						if (!round) return null;
						const withoutRelation = Object.assign(new MonteRound(), round);
						withoutRelation.user = undefined as unknown as User;
						return withoutRelation;
					}
				if (where.status) {
					return (
						rounds.find((round) => round.status === where.status) ?? null
					);
				}
				return null;
				},
			),
			create: jest.fn((data: Partial<MonteRound>) => {
				const round = Object.assign(new MonteRound(), data);
				round.id = `round-${rounds.length + 1}`;
				round.userId = user.id;
				round.user = user;
				round.createdAt = new Date();
				round.updatedAt = new Date();
				return round;
			}),
			save: jest.fn(async (round: MonteRound) => {
				const index = rounds.findIndex((item) => item.id === round.id);
				if (index === -1) rounds.push(round);
				else rounds[index] = round;
				return round;
			}),
		};
		const wagersRepo = {
			create: jest.fn((data: Partial<Wager>) => data as Wager),
			save: jest.fn(async (wager: Wager) => {
				wagers.push(wager);
				return wager;
			}),
		};
		const profilesRepo = {
			findOne: jest.fn(async () => profile),
			save: jest.fn(async (saved: Profile) => {
				profile = saved;
				return profile;
			}),
		};
		const getRepository = (entity: unknown): unknown => {
			if (entity === User) return usersRepo;
			if (entity === MonteRound) return roundsRepo;
			if (entity === Wager) return wagersRepo;
			if (entity === Profile) return profilesRepo;
			throw new Error("Unknown repository");
		};
		dataSource = {
			getRepository: jest.fn(getRepository),
			transaction: jest.fn(
				async (
					callback: (manager: {
						getRepository: (entity: unknown) => unknown;
					}) => unknown,
				) => callback({ getRepository }),
			),
		};

		const moduleRef: TestingModule = await Test.createTestingModule({
			providers: [
				MonteRoundService,
				{ provide: DataSource, useValue: dataSource },
			],
		}).compile();

		service = moduleRef.get(MonteRoundService);
	});

	/** Push a round's creation time back so its shuffle gate has elapsed. */
	function openGate(index = 0): void {
		rounds[index].createdAt = new Date(Date.now() - 60_000);
	}

	it("starts a round by debiting once and returning the commitment", async () => {
		const result = await service.startRound(user, 100, "client");

		expect(result.roundId).toBe("round-1");
		expect(result.cupIds).toHaveLength(3);
		expect(result.ballStartSlot).toBeGreaterThanOrEqual(0);
		expect(result.ballStartSlot).toBeLessThan(3);
		expect(result.stepCount).toBeGreaterThan(0);
		expect(result.stepDurations).toHaveLength(result.stepCount);
		expect(result.serverSeedHash).toHaveLength(64);
		expect(result.commitHash).toHaveLength(64);
		expect(result.clientSeed).toBe("client");
		expect(result.nonce).toBe(0);
		expect(result.coins).toBe(400);
		expect(user.coins).toBe(400);
		expect(user.wagerCount).toBe(1);
		// The winning slot must never be part of the start payload.
		expect(result).not.toHaveProperty("winningSlot");
		expect(result).not.toHaveProperty("ballCupId");
		expect(result).not.toHaveProperty("shuffle");
	});

	it("reuses an active pending round without double-debiting", async () => {
		const first = await service.startRound(user, 100, "client");
		const second = await service.startRound(user, 100, "client");

		expect(second.roundId).toBe(first.roundId);
		expect(user.coins).toBe(400);
		expect(user.wagerCount).toBe(1);
		expect(rounds).toHaveLength(1);
	});

	it("returns the active round for resume, or null when none is open", async () => {
		expect(await service.getActiveRound(user)).toBeNull();

		const started = await service.startRound(user, 100, "seed");
		const active = await service.getActiveRound(user);

		expect(active?.roundId).toBe(started.roundId);
		expect(active).not.toHaveProperty("winningSlot");
		expect(active).not.toHaveProperty("ballCupId");
	});

	it("expires a stale pending round instead of resuming it", async () => {
		await service.startRound(user, 100, "");
		rounds[0].expiresAt = new Date(Date.now() - 1);

		expect(await service.getActiveRound(user)).toBeNull();
		expect(rounds[0].status).toBe("expired");
	});

	it("expireStaleRounds settles only rounds past their TTL", async () => {
		await service.startRound(user, 100, "");
		// Fresh round is not stale — nothing to sweep.
		expect(await service.expireStaleRounds()).toBe(0);
		expect(rounds[0].status).toBe("pending");

		rounds[0].expiresAt = new Date(Date.now() - 1);
		const swept = await service.expireStaleRounds();

		expect(swept).toBe(1);
		expect(rounds[0].status).toBe("expired");
		expect(wagers.at(-1)).toEqual(
			expect.objectContaining({ payout: 0, net: -100 }),
		);
		// Idempotent: a second pass finds nothing left to settle.
		expect(await service.expireStaleRounds()).toBe(0);
	});

	it("streams no swaps immediately, then all once the gate opens", async () => {
		const started = await service.startRound(user, 100, "");

		const early = await service.getSteps(user, started.roundId);
		expect(early.steps).toHaveLength(0);
		expect(early.ready).toBe(false);

		openGate();
		const late = await service.getSteps(user, started.roundId);
		expect(late.steps).toHaveLength(late.stepCount);
		expect(late.ready).toBe(true);
	});

	it("pays 3x and writes a wager row for the winning slot", async () => {
		const started = await service.startRound(user, 100, "");
		openGate();
		const winningSlot = rounds[0].winningSlot;
		const result = await service.resolveRound(user, started.roundId, winningSlot);

		expect(result.won).toBe(true);
		expect(result.selectedSlot).toBe(winningSlot);
		expect(result.payout).toBe(300);
		expect(result.net).toBe(200);
		expect(result.coins).toBe(700);
		expect(result.shuffle).toHaveLength(started.stepCount);
		expect(wagers).toHaveLength(1);
		expect(wagers[0]).toEqual(
			expect.objectContaining({
				game: "monte",
				payout: 300,
				net: 200,
				nonce: 0,
			}),
		);
		expect(profile.totalCoinsEarned).toBe(200);
	});

	it("loses the debited stake for a wrong slot", async () => {
		const started = await service.startRound(user, 100, "");
		openGate();
		const wrongSlot = (rounds[0].winningSlot + 1) % 3;
		const result = await service.resolveRound(user, started.roundId, wrongSlot);

		expect(result.won).toBe(false);
		expect(result.payout).toBe(0);
		expect(result.net).toBe(-100);
		expect(result.coins).toBe(400);
		expect(wagers[0]).toEqual(expect.objectContaining({ payout: 0, net: -100 }));
	});

	it("rejects a resolve before the shuffle could have finished", async () => {
		const started = await service.startRound(user, 100, "");
		// Gate NOT opened: the round was just created.
		await expect(
			service.resolveRound(user, started.roundId, rounds[0].winningSlot),
		).rejects.toBeInstanceOf(BadRequestException);
		// Stake must not have been settled.
		expect(rounds[0].status).toBe("pending");
	});

	it("rejects an out-of-range slot", async () => {
		const started = await service.startRound(user, 100, "");
		openGate();

		await expect(
			service.resolveRound(user, started.roundId, 7),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("expires old pending rounds as losses before starting a new one", async () => {
		const first = await service.startRound(user, 100, "");
		rounds[0].expiresAt = new Date(Date.now() - 1);

		const second = await service.startRound(user, 100, "");

		expect(second.roundId).not.toBe(first.roundId);
		expect(rounds[0].status).toBe("expired");
		expect(wagers[0]).toEqual(expect.objectContaining({ payout: 0, net: -100 }));
		expect(user.coins).toBe(300);
		expect(user.wagerCount).toBe(2);
	});
});
