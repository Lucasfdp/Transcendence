import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "./casino.constants";
import { CasinoEngine } from "./casino.engine";
import { computeRoll } from "./casino.fair";
import { FLIP_MULTIPLIER, type FlipSide, flipSide } from "./flip.constants";
import { FlipService } from "./flip.service";
import { Wager } from "./entities/wager.entity";

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.coins = overrides.coins ?? 0;
	return user;
}

/** Find a server seed whose roll (nonce 0, empty client seed) lands `target`. */
function seedForSide(target: FlipSide): string {
	for (let i = 0; i < 200_000; i++) {
		const seed = `seed-${i}`;
		if (flipSide(computeRoll(seed, "", 0)) === target) return seed;
	}
	throw new Error(`no seed found for side ${target}`);
}

describe("FlipService", () => {
	let service: FlipService;
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
				FlipService,
				CasinoEngine,
				{ provide: DataSource, useValue: dataSource },
			],
		}).compile();

		service = moduleRef.get(FlipService);
	});

	describe("getFlipConfig", () => {
		it("should expose the multiplier, RTP, bounds and balance", () => {
			const config = service.getFlipConfig(makeUser({ coins: 321 }));

			expect(config.multiplier).toBe(FLIP_MULTIPLIER);
			expect(config.rtp).toBeCloseTo(1, 10);
			expect(config.minWager).toBe(MIN_WAGER_COINS);
			expect(config.maxWager).toBe(MAX_WAGER_COINS);
			expect(config.coins).toBe(321);
		});
	});

	describe("flip", () => {
		it("should pay 2× when the call matches the landed side", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForSide("heads");

			const result = await service.flip(
				makeUser({ coins: 500 }),
				"heads",
				100,
				{ serverSeed },
			);

			expect(result.game).toBe("flip");
			expect(result.outcomeId).toBe("heads");
			expect(result.multiplier).toBe(2);
			expect(result.payout).toBe(200);
			expect(result.net).toBe(100);
			expect(result.coins).toBe(600);
		});

		it("should pay nothing when the call misses", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForSide("tails");

			const result = await service.flip(
				makeUser({ coins: 500 }),
				"heads",
				100,
				{ serverSeed },
			);

			expect(result.outcomeId).toBe("tails");
			expect(result.multiplier).toBe(0);
			expect(result.payout).toBe(0);
			expect(result.net).toBe(-100);
			expect(result.coins).toBe(400);
		});

		it("should credit positive winnings to profile.totalCoinsEarned", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const profile = new Profile();
			profile.totalCoinsEarned = 1_000;
			profilesRepo.findOne.mockResolvedValue(profile);
			const serverSeed = seedForSide("heads");

			await service.flip(makeUser({ coins: 500 }), "heads", 100, {
				serverSeed,
			});

			expect(profilesRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ totalCoinsEarned: 1_100 }),
			);
		});

		it("should not change totalCoinsEarned on a losing call", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForSide("tails");

			await service.flip(makeUser({ coins: 500 }), "heads", 100, {
				serverSeed,
			});

			expect(profilesRepo.save).not.toHaveBeenCalled();
		});

		it("should write an audit row tagged with the flip game and side", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForSide("heads");

			await service.flip(makeUser({ coins: 500 }), "heads", 100, {
				serverSeed,
			});

			expect(wagersRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ game: "flip", segmentId: "heads" }),
			);
		});

		it("should reject an invalid pick", async () => {
			await expect(
				service.flip(
					makeUser({ coins: 500 }),
					"edge" as FlipSide,
					100,
					{},
				),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(dataSource.transaction).not.toHaveBeenCalled();
		});

		it("should reject a stake below the minimum", async () => {
			await expect(
				service.flip(
					makeUser({ coins: 500 }),
					"heads",
					MIN_WAGER_COINS - 1,
					{},
				),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a stake above the maximum", async () => {
			await expect(
				service.flip(
					makeUser({ coins: 99_999 }),
					"heads",
					MAX_WAGER_COINS + 1,
					{},
				),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a non-integer stake", async () => {
			await expect(
				service.flip(makeUser({ coins: 500 }), "heads", 10.5, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a call with insufficient coins", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 50 }));

			await expect(
				service.flip(makeUser({ coins: 50 }), "heads", 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});
	});
});
