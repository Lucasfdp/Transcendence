import {
	BadRequestException,
	ForbiddenException,
	InternalServerErrorException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { User } from "../users/entities/user.entity";
import {
	FREE_SPIN_STAKE_COINS,
	MAX_WAGER_COINS,
	MIN_WAGER_COINS,
	WHEEL_SEGMENTS,
	selectSegment,
} from "./casino.constants";
import { computeRoll, hashSeed } from "./casino.fair";
import { CasinoService } from "./casino.service";
import { Wager } from "./entities/wager.entity";

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.coins = overrides.coins ?? 0;
	return user;
}

/**
 * Find a server seed that lands on a segment with the given multiplier (at
 * nonce 0, empty client seed). Lets tests express intent — "a spin that busts"
 * — without hardcoding opaque seed strings.
 */
function seedForMultiplier(target: number): string {
	for (let i = 0; i < 200_000; i++) {
		const seed = `seed-${i}`;
		if (selectSegment(computeRoll(seed, "", 0)).multiplier === target) {
			return seed;
		}
	}
	throw new Error(`no seed found for multiplier ${target}`);
}

describe("CasinoService", () => {
	let service: CasinoService;
	let wagersRepo: {
		findOne: jest.Mock;
		count: jest.Mock;
		create: jest.Mock;
		save: jest.Mock;
	};
	let usersRepo: { findOne: jest.Mock; save: jest.Mock };
	let dataSource: { transaction: jest.Mock };

	beforeEach(async () => {
		wagersRepo = {
			findOne: jest.fn().mockResolvedValue(null),
			count: jest.fn().mockResolvedValue(0),
			create: jest.fn((data: Partial<Wager>) => data as Wager),
			save: jest.fn(async (row: Wager) => row),
		};
		usersRepo = {
			findOne: jest.fn(),
			save: jest.fn(async (user: User) => user),
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
							if (entity === Wager) return wagersRepo;
							throw new Error("Unknown repository");
						},
					}),
			),
		};

		const moduleRef: TestingModule = await Test.createTestingModule({
			providers: [
				CasinoService,
				{ provide: getRepositoryToken(Wager), useValue: wagersRepo },
				{ provide: DataSource, useValue: dataSource },
			],
		}).compile();

		service = moduleRef.get(CasinoService);
	});

	describe("getWheelView", () => {
		it("should expose the layout, bounds, balance and odds summing to 1", async () => {
			const view = await service.getWheelView(makeUser({ coins: 123 }));

			expect(view.segments).toHaveLength(WHEEL_SEGMENTS.length);
			const totalProbability = view.segments.reduce(
				(sum, s) => sum + s.probability,
				0,
			);
			expect(totalProbability).toBeCloseTo(1, 10);
			expect(view.rtp).toBeCloseTo(1, 10);
			expect(view.freeStake).toBe(FREE_SPIN_STAKE_COINS);
			expect(view.minWager).toBe(MIN_WAGER_COINS);
			expect(view.maxWager).toBe(MAX_WAGER_COINS);
			expect(view.coins).toBe(123);
		});

		it("should report freeSpinAvailable=true when no free spin was taken today", async () => {
			wagersRepo.findOne.mockResolvedValue(null);

			const view = await service.getWheelView(makeUser());

			expect(view.freeSpinAvailable).toBe(true);
		});

		it("should report freeSpinAvailable=false when a free spin exists today", async () => {
			wagersRepo.findOne.mockResolvedValue({ id: 1 } as Wager);

			const view = await service.getWheelView(makeUser());

			expect(view.freeSpinAvailable).toBe(false);
		});
	});

	describe("freeSpin", () => {
		it("should pay FREE_SPIN_STAKE_COINS × multiplier and debit nothing", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 100 }));
			const serverSeed = seedForMultiplier(2);

			const result = await service.freeSpin(makeUser({ coins: 100 }), {
				serverSeed,
			});

			expect(result.mode).toBe("free");
			expect(result.paid).toBe(0);
			expect(result.payout).toBe(FREE_SPIN_STAKE_COINS * 2);
			expect(result.net).toBe(FREE_SPIN_STAKE_COINS * 2);
			expect(result.coins).toBe(100 + FREE_SPIN_STAKE_COINS * 2);
		});

		it("should throw BadRequestException when the free spin was already used today", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 100 }));
			wagersRepo.findOne.mockResolvedValue({ id: 99 } as Wager);

			await expect(service.freeSpin(makeUser())).rejects.toBeInstanceOf(
				BadRequestException,
			);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});

		it("should throw ForbiddenException when the user no longer exists", async () => {
			usersRepo.findOne.mockResolvedValue(null);

			await expect(service.freeSpin(makeUser())).rejects.toBeInstanceOf(
				ForbiddenException,
			);
		});
	});

	describe("wageredSpin", () => {
		it("should debit the stake and credit stake × multiplier on a win", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForMultiplier(2);

			const result = await service.wageredSpin(makeUser({ coins: 500 }), 100, {
				serverSeed,
			});

			expect(result.mode).toBe("wagered");
			expect(result.paid).toBe(100);
			expect(result.payout).toBe(200);
			expect(result.net).toBe(100);
			expect(result.coins).toBe(600);
		});

		it("should lose the stake when the wheel busts (0x)", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForMultiplier(0);

			const result = await service.wageredSpin(makeUser({ coins: 500 }), 100, {
				serverSeed,
			});

			expect(result.payout).toBe(0);
			expect(result.net).toBe(-100);
			expect(result.coins).toBe(400);
		});

		it("should throw BadRequestException when the stake is below the minimum", async () => {
			await expect(
				service.wageredSpin(makeUser({ coins: 500 }), MIN_WAGER_COINS - 1),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should throw BadRequestException when the stake exceeds the maximum", async () => {
			await expect(
				service.wageredSpin(makeUser({ coins: 99_999 }), MAX_WAGER_COINS + 1),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should throw BadRequestException when the stake is not a whole number", async () => {
			await expect(
				service.wageredSpin(makeUser({ coins: 500 }), 10.5),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should throw BadRequestException when the player has insufficient coins", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 50 }));

			await expect(
				service.wageredSpin(makeUser({ coins: 50 }), 100),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});
	});

	describe("audit & provable fairness", () => {
		it("should write one immutable Wager audit row matching the result", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForMultiplier(2);

			const result = await service.wageredSpin(makeUser({ coins: 500 }), 100, {
				serverSeed,
				clientSeed: "lucky",
			});

			expect(wagersRepo.save).toHaveBeenCalledTimes(1);
			expect(wagersRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({
					mode: "wagered",
					stake: 100,
					paid: 100,
					payout: result.payout,
					net: result.net,
					segmentId: result.segment.id,
					multiplier: result.segment.multiplier,
					serverSeed,
					serverSeedHash: hashSeed(serverSeed),
					clientSeed: "lucky",
					nonce: result.fairness.nonce,
				}),
			);
		});

		it("should echo verifiable fairness data the player can recompute", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForMultiplier(3);

			const { fairness, segment } = await service.wageredSpin(
				makeUser({ coins: 500 }),
				100,
				{ serverSeed, clientSeed: "c" },
			);

			expect(fairness.serverSeedHash).toBe(hashSeed(serverSeed));
			const roll = computeRoll(serverSeed, "c", fairness.nonce);
			expect(fairness.roll).toBe(roll);
			expect(selectSegment(roll).id).toBe(segment.id);
		});

		it("should use the user's prior wager count as the provably-fair nonce", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			wagersRepo.count.mockResolvedValue(5);

			const { fairness } = await service.wageredSpin(
				makeUser({ coins: 500 }),
				100,
				{ serverSeed: "fixed", clientSeed: "" },
			);

			expect(fairness.nonce).toBe(5);
			expect(fairness.roll).toBe(computeRoll("fixed", "", 5));
		});
	});

	describe("atomicity & locking", () => {
		it("should resolve the spin inside a single transaction", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			await service.wageredSpin(makeUser({ coins: 500 }), 100, {
				serverSeed: "fixed",
			});

			expect(dataSource.transaction).toHaveBeenCalledTimes(1);
		});

		it("should acquire a pessimistic write lock on the user row", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			await service.wageredSpin(makeUser({ coins: 500 }), 100, {
				serverSeed: "fixed",
			});

			expect(usersRepo.findOne).toHaveBeenCalledWith(
				expect.objectContaining({
					lock: { mode: "pessimistic_write" },
				}),
			);
		});

		it("should disable eager relations on the locked read (no FOR UPDATE on an outer join)", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			await service.wageredSpin(makeUser({ coins: 500 }), 100, {
				serverSeed: "fixed",
			});

			expect(usersRepo.findOne).toHaveBeenCalledWith(
				expect.objectContaining({ loadEagerRelations: false }),
			);
		});

		it("should wrap an unexpected transaction failure as InternalServerErrorException", async () => {
			dataSource.transaction.mockRejectedValue(new Error("db is down"));

			await expect(
				service.wageredSpin(makeUser({ coins: 500 }), 100),
			).rejects.toBeInstanceOf(InternalServerErrorException);
		});
	});
});
