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
	let dataSource: { transaction: jest.Mock };

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
		dataSource = {
			transaction: jest.fn(
				async (
					callback: (manager: {
						getRepository: (entity: unknown) => unknown;
					}) => unknown,
				) =>
					callback({
						getRepository: (entity: unknown) => {
							if (entity === User) return usersRepo;
							if (entity === MonteRound) return roundsRepo;
							if (entity === Wager) return wagersRepo;
							if (entity === Profile) return profilesRepo;
							throw new Error("Unknown repository");
						},
					}),
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

	it("starts a round by debiting once and returning the commitment", async () => {
		const result = await service.startRound(user, 100, "client");

		expect(result.roundId).toBe("round-1");
		expect(result.cupIds).toHaveLength(3);
		expect(result.cupIds).toContain(result.ballCupId);
		expect(result.serverSeedHash).toHaveLength(64);
		expect(result.winningCupHash).toHaveLength(64);
		expect(result.clientSeed).toBe("client");
		expect(result.nonce).toBe(0);
		expect(result.coins).toBe(400);
		expect(user.coins).toBe(400);
		expect(user.wagerCount).toBe(1);
	});

	it("reuses an active pending round without double-debiting", async () => {
		const first = await service.startRound(user, 100, "client");
		const second = await service.startRound(user, 100, "client");

		expect(second.roundId).toBe(first.roundId);
		expect(user.coins).toBe(400);
		expect(user.wagerCount).toBe(1);
		expect(rounds).toHaveLength(1);
	});

	it("pays 3x and writes a wager row for the correct cup", async () => {
		const started = await service.startRound(user, 100, "");
		const result = await service.resolveRound(user, started.roundId, started.ballCupId);

		expect(result.won).toBe(true);
		expect(result.payout).toBe(300);
		expect(result.net).toBe(200);
		expect(result.coins).toBe(700);
		expect(wagers).toHaveLength(1);
		expect(wagers[0]).toEqual(
			expect.objectContaining({
				game: "monte",
				segmentId: started.ballCupId,
				payout: 300,
				net: 200,
				nonce: 0,
			}),
		);
		expect(profile.totalCoinsEarned).toBe(200);
	});

	it("loses the debited stake for the wrong cup", async () => {
		const started = await service.startRound(user, 100, "");
		const wrongCup = started.cupIds.find((cupId) => cupId !== started.ballCupId);
		const result = await service.resolveRound(user, started.roundId, wrongCup!);

		expect(result.won).toBe(false);
		expect(result.payout).toBe(0);
		expect(result.net).toBe(-100);
		expect(result.coins).toBe(400);
		expect(wagers[0]).toEqual(expect.objectContaining({ payout: 0, net: -100 }));
	});

	it("rejects invalid cup ids", async () => {
		const started = await service.startRound(user, 100, "");

		await expect(
			service.resolveRound(user, started.roundId, "not-a-round-cup"),
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
