import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "./casino.constants";
import { CasinoEngine } from "./casino.engine";
import { computeRoll } from "./casino.fair";
import {
	type DiceDirection,
	diceMultiplier,
	diceValue,
} from "./dice.constants";
import { DiceService } from "./dice.service";
import { Wager } from "./entities/wager.entity";

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.coins = overrides.coins ?? 0;
	return user;
}

/** Find a server seed whose roll (nonce 0, empty client seed) lands `target` value. */
function seedForValue(target: number): string {
	for (let i = 0; i < 200_000; i++) {
		const seed = `seed-${i}`;
		if (diceValue(computeRoll(seed, "", 0)) === target) return seed;
	}
	throw new Error(`no seed found for value ${target}`);
}

describe("DiceService", () => {
	let service: DiceService;
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
				DiceService,
				CasinoEngine,
				{ provide: DataSource, useValue: dataSource },
			],
		}).compile();

		service = moduleRef.get(DiceService);
	});

	describe("getDiceConfig", () => {
		it("should expose the range, target bounds, wager bounds and balance", () => {
			const config = service.getDiceConfig(makeUser({ coins: 321 }));

			expect(config.range).toBe(100);
			expect(config.minTargetUnder).toBe(1);
			expect(config.maxTargetUnder).toBe(99);
			expect(config.minTargetOver).toBe(0);
			expect(config.maxTargetOver).toBe(98);
			expect(config.minWager).toBe(MIN_WAGER_COINS);
			expect(config.maxWager).toBe(MAX_WAGER_COINS);
			expect(config.coins).toBe(321);
		});
	});

	describe("dice", () => {
		it("should pay 100/target on a winning under bet", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForValue(10); // under 50 wins on any value < 50

			const result = await service.dice(
				makeUser({ coins: 500 }),
				"under",
				50,
				100,
				{ serverSeed },
			);

			expect(result.game).toBe("dice");
			expect(result.outcomeId).toBe("roll-10");
			expect(result.multiplier).toBeCloseTo(diceMultiplier("under", 50), 10);
			expect(result.payout).toBe(Math.floor(100 * diceMultiplier("under", 50)));
			expect(result.coins).toBe(500 - 100 + result.payout);
		});

		it("should pay nothing on a losing under bet", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForValue(80); // under 50 loses on value >= 50

			const result = await service.dice(
				makeUser({ coins: 500 }),
				"under",
				50,
				100,
				{ serverSeed },
			);

			expect(result.outcomeId).toBe("roll-80");
			expect(result.multiplier).toBe(0);
			expect(result.payout).toBe(0);
			expect(result.net).toBe(-100);
		});

		it("should pay 100/(99-target) on a winning over bet", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForValue(80); // over 50 wins on any value > 50

			const result = await service.dice(
				makeUser({ coins: 500 }),
				"over",
				50,
				100,
				{ serverSeed },
			);

			expect(result.outcomeId).toBe("roll-80");
			expect(result.multiplier).toBeCloseTo(diceMultiplier("over", 50), 10);
			expect(result.payout).toBe(Math.floor(100 * diceMultiplier("over", 50)));
		});

		it("should pay nothing on a losing over bet", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForValue(10); // over 50 loses on value <= 50

			const result = await service.dice(
				makeUser({ coins: 500 }),
				"over",
				50,
				100,
				{ serverSeed },
			);

			expect(result.multiplier).toBe(0);
			expect(result.payout).toBe(0);
			expect(result.net).toBe(-100);
		});

		it("should credit positive winnings to profile.totalCoinsEarned", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const profile = new Profile();
			profile.totalCoinsEarned = 1_000;
			profilesRepo.findOne.mockResolvedValue(profile);
			const serverSeed = seedForValue(10);

			const result = await service.dice(
				makeUser({ coins: 500 }),
				"under",
				50,
				100,
				{ serverSeed },
			);

			expect(profilesRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ totalCoinsEarned: 1_000 + result.net }),
			);
		});

		it("should not change totalCoinsEarned on a losing bet", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForValue(80);

			await service.dice(makeUser({ coins: 500 }), "under", 50, 100, {
				serverSeed,
			});

			expect(profilesRepo.save).not.toHaveBeenCalled();
		});

		it("should write an audit row tagged with the dice game and rolled value", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForValue(10);

			await service.dice(makeUser({ coins: 500 }), "under", 50, 100, {
				serverSeed,
			});

			expect(wagersRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ game: "dice", segmentId: "roll-10" }),
			);
		});

		it("should reject an invalid direction", async () => {
			await expect(
				service.dice(
					makeUser({ coins: 500 }),
					"sideways" as DiceDirection,
					50,
					100,
					{},
				),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(dataSource.transaction).not.toHaveBeenCalled();
		});

		it("should reject an out-of-range target for under (0 is invalid)", async () => {
			await expect(
				service.dice(makeUser({ coins: 500 }), "under", 0, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject an out-of-range target for under (100 is invalid)", async () => {
			await expect(
				service.dice(makeUser({ coins: 500 }), "under", 100, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject an out-of-range target for over (99 is invalid)", async () => {
			await expect(
				service.dice(makeUser({ coins: 500 }), "over", 99, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a non-integer target", async () => {
			await expect(
				service.dice(makeUser({ coins: 500 }), "under", 50.5, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a stake below the minimum", async () => {
			await expect(
				service.dice(
					makeUser({ coins: 500 }),
					"under",
					50,
					MIN_WAGER_COINS - 1,
					{},
				),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a stake above the maximum", async () => {
			await expect(
				service.dice(
					makeUser({ coins: 99_999 }),
					"under",
					50,
					MAX_WAGER_COINS + 1,
					{},
				),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a non-integer stake", async () => {
			await expect(
				service.dice(makeUser({ coins: 500 }), "under", 50, 10.5, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a bet with insufficient coins", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 50 }));

			await expect(
				service.dice(makeUser({ coins: 50 }), "under", 50, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});
	});
});
