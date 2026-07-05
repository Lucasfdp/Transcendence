import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "./casino.constants";
import { CasinoEngine } from "./casino.engine";
import { computeRolls } from "./casino.fair";
import {
	DEFAULT_ROWS,
	PLINKO_ROWS_OPTIONS,
	bucketIndexFromRolls,
	bucketMultiplier,
	plinkoRtp,
} from "./plinko.constants";
import { PlinkoService } from "./plinko.service";
import { Wager } from "./entities/wager.entity";

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.coins = overrides.coins ?? 0;
	return user;
}

/** Find a server seed whose `rows`-row drop (nonce 0, empty client seed) lands `bucket`. */
function seedForBucket(rows: number, bucket: number): string {
	for (let i = 0; i < 500_000; i++) {
		const seed = `seed-${i}`;
		const rolls = computeRolls(seed, "", 0, rows);
		if (bucketIndexFromRolls(rolls) === bucket) return seed;
	}
	throw new Error(`no seed found for bucket ${bucket} at ${rows} rows`);
}

describe("PlinkoService", () => {
	let service: PlinkoService;
	let wagersRepo: {
		findOne: jest.Mock;
		count: jest.Mock;
		create: jest.Mock;
		save: jest.Mock;
	};
	let usersRepo: { findOne: jest.Mock; save: jest.Mock };
	let profilesRepo: { findOne: jest.Mock; save: jest.Mock };
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
		profilesRepo = {
			findOne: jest.fn(async () => {
				const profile = new Profile();
				profile.totalCoinsEarned = 0;
				return profile;
			}),
			save: jest.fn(async (profile: Profile) => profile),
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
							if (entity === Profile) return profilesRepo;
							throw new Error("Unknown repository");
						},
					}),
			),
		};

		const moduleRef: TestingModule = await Test.createTestingModule({
			providers: [
				PlinkoService,
				CasinoEngine,
				{ provide: DataSource, useValue: dataSource },
			],
		}).compile();

		service = moduleRef.get(PlinkoService);
	});

	describe("getPlinkoView", () => {
		it("should expose row tiers, paytables, RTP, bounds and balance", () => {
			const view = service.getPlinkoView(makeUser({ coins: 777 }));

			expect(view.rowOptions).toEqual([...PLINKO_ROWS_OPTIONS]);
			expect(view.defaultRows).toBe(DEFAULT_ROWS);
			expect(view.tiers).toHaveLength(PLINKO_ROWS_OPTIONS.length);
			for (const tier of view.tiers) {
				expect(tier.buckets).toHaveLength(tier.rows + 1);
				expect(tier.rtp).toBeCloseTo(plinkoRtp(tier.rows), 10);
				const probability = tier.buckets.reduce(
					(sum, bucket) => sum + bucket.probability,
					0,
				);
				expect(probability).toBeCloseTo(1, 9);
			}
			expect(view.minWager).toBe(MIN_WAGER_COINS);
			expect(view.maxWager).toBe(MAX_WAGER_COINS);
			expect(view.coins).toBe(777);
		});
	});

	describe("drop", () => {
		it("should default to DEFAULT_ROWS when rows is omitted", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 100_000 }));
			const serverSeed = seedForBucket(DEFAULT_ROWS, 0);

			const result = await service.drop(
				makeUser({ coins: 100_000 }),
				undefined,
				100,
				{ serverSeed },
			);

			expect(result.fairness.rolls).toHaveLength(DEFAULT_ROWS);
		});

		it("should pay the edge bucket's multiplier (> stake) on an all-left drop", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 100_000 }));
			const serverSeed = seedForBucket(8, 0);

			const result = await service.drop(
				makeUser({ coins: 100_000 }),
				8,
				100,
				{ serverSeed },
			);

			expect(result.game).toBe("drop");
			expect(result.outcomeId).toBe("bucket-0");
			expect(result.multiplier).toBeCloseTo(bucketMultiplier(8, 0), 10);
			expect(result.payout).toBe(Math.floor(100 * bucketMultiplier(8, 0)));
			expect(result.multiplier).toBeGreaterThan(1);
			expect(result.net).toBeGreaterThan(0);
		});

		it("should pay the centre bucket's multiplier (< stake) on a balanced drop", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 100_000 }));
			const serverSeed = seedForBucket(8, 4);

			const result = await service.drop(
				makeUser({ coins: 100_000 }),
				8,
				100,
				{ serverSeed },
			);

			expect(result.outcomeId).toBe("bucket-4");
			expect(result.multiplier).toBeCloseTo(bucketMultiplier(8, 4), 10);
			expect(result.multiplier).toBeLessThan(1);
			expect(result.payout).toBe(Math.floor(100 * bucketMultiplier(8, 4)));
			expect(result.net).toBeLessThan(0);
		});

		it("should credit positive winnings to profile.totalCoinsEarned on an edge bucket", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 100_000 }));
			const profile = new Profile();
			profile.totalCoinsEarned = 1_000;
			profilesRepo.findOne.mockResolvedValue(profile);
			const serverSeed = seedForBucket(8, 0);

			const result = await service.drop(
				makeUser({ coins: 100_000 }),
				8,
				100,
				{ serverSeed },
			);

			expect(profilesRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ totalCoinsEarned: 1_000 + result.net }),
			);
		});

		it("should not change totalCoinsEarned on a centre-bucket loss", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 100_000 }));
			const serverSeed = seedForBucket(8, 4);

			await service.drop(makeUser({ coins: 100_000 }), 8, 100, {
				serverSeed,
			});

			expect(profilesRepo.save).not.toHaveBeenCalled();
		});

		it("should write an audit row tagged with the drop game and bucket", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 100_000 }));
			const serverSeed = seedForBucket(8, 0);

			await service.drop(makeUser({ coins: 100_000 }), 8, 100, {
				serverSeed,
			});

			expect(wagersRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ game: "drop", segmentId: "bucket-0" }),
			);
		});

		it("should draw one independent roll per row", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			const result = await service.drop(makeUser({ coins: 500 }), 12, 100, {
				serverSeed: "fixed",
				clientSeed: "c",
			});

			expect(result.fairness.rolls).toEqual(
				computeRolls("fixed", "c", 0, 12),
			);
		});

		it("should reject an unsupported row count", async () => {
			await expect(
				service.drop(makeUser({ coins: 500 }), 10, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(dataSource.transaction).not.toHaveBeenCalled();
		});

		it("should reject an out-of-bounds stake", async () => {
			await expect(
				service.drop(makeUser({ coins: 99_999 }), 8, MAX_WAGER_COINS + 1, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a non-integer stake", async () => {
			await expect(
				service.drop(makeUser({ coins: 500 }), 8, 10.5, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a drop with insufficient coins", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 50 }));

			await expect(
				service.drop(makeUser({ coins: 50 }), 8, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});
	});
});
