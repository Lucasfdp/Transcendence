import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "./casino.constants";
import { CasinoEngine } from "./casino.engine";
import { computeRolls } from "./casino.fair";
import {
	PAYTABLE,
	SLOT_REEL_COUNT,
	SLOT_SYMBOLS,
	selectSymbol,
	slotsRtp,
} from "./slots.constants";
import { SlotsService } from "./slots.service";
import { Wager } from "./entities/wager.entity";

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.coins = overrides.coins ?? 0;
	return user;
}

/** The three reel symbols a seed produces (nonce 0, empty client seed). */
function reelsFor(seed: string): string[] {
	return computeRolls(seed, "", 0, SLOT_REEL_COUNT).map(
		(roll) => selectSymbol(roll).id,
	);
}

/** Find a seed whose three reels are all `symbolId` (a three-of-a-kind win). */
function seedForJackpot(symbolId: string): string {
	for (let i = 0; i < 500_000; i++) {
		const seed = `seed-${i}`;
		const reels = reelsFor(seed);
		if (reels.every((id) => id === symbolId)) return seed;
	}
	throw new Error(`no jackpot seed found for ${symbolId}`);
}

/** Find a seed whose three reels are NOT all equal (a losing spin). */
function seedForMiss(): string {
	for (let i = 0; i < 500_000; i++) {
		const seed = `miss-${i}`;
		const reels = reelsFor(seed);
		if (!reels.every((id) => id === reels[0])) return seed;
	}
	throw new Error("no losing seed found");
}

describe("SlotsService", () => {
	let service: SlotsService;
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
				SlotsService,
				CasinoEngine,
				{ provide: DataSource, useValue: dataSource },
			],
		}).compile();

		service = moduleRef.get(SlotsService);
	});

	describe("getSlotsView", () => {
		it("should expose the reel, paytable, RTP, bounds and balance", () => {
			const view = service.getSlotsView(makeUser({ coins: 777 }));

			expect(view.symbols).toHaveLength(SLOT_SYMBOLS.length);
			expect(view.reelCount).toBe(SLOT_REEL_COUNT);
			expect(view.rtp).toBeCloseTo(slotsRtp(), 12);
			expect(view.minWager).toBe(MIN_WAGER_COINS);
			expect(view.maxWager).toBe(MAX_WAGER_COINS);
			expect(view.coins).toBe(777);
			const probability = view.symbols.reduce(
				(sum, s) => sum + s.probability,
				0,
			);
			expect(probability).toBeCloseTo(1, 10);
			for (const symbol of view.symbols) {
				expect(symbol.payout).toBe(PAYTABLE[symbol.id]);
			}
		});
	});

	describe("slots", () => {
		it("should pay the paytable multiplier on three of a kind", async () => {
			const symbolId = SLOT_SYMBOLS[0].id; // richest symbol
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 100_000 }));
			const serverSeed = seedForJackpot(symbolId);

			const result = await service.slots(makeUser({ coins: 100_000 }), 100, {
				serverSeed,
			});

			expect(result.game).toBe("slots");
			expect(result.outcomeId).toBe(`${symbolId}|${symbolId}|${symbolId}`);
			expect(result.multiplier).toBe(PAYTABLE[symbolId]);
			expect(result.payout).toBe(100 * PAYTABLE[symbolId]);
			expect(result.fairness.rolls).toHaveLength(SLOT_REEL_COUNT);
		});

		it("should pay nothing when the reels do not match", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForMiss();

			const result = await service.slots(makeUser({ coins: 500 }), 100, {
				serverSeed,
			});

			expect(result.multiplier).toBe(0);
			expect(result.payout).toBe(0);
			expect(result.net).toBe(-100);
			expect(result.outcomeId).toBe(reelsFor(serverSeed).join("|"));
		});

		it("should credit positive winnings to profile.totalCoinsEarned", async () => {
			const symbolId = SLOT_SYMBOLS[0].id;
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 100_000 }));
			const profile = new Profile();
			profile.totalCoinsEarned = 1_000;
			profilesRepo.findOne.mockResolvedValue(profile);
			const serverSeed = seedForJackpot(symbolId);
			const net = 100 * PAYTABLE[symbolId] - 100;

			await service.slots(makeUser({ coins: 100_000 }), 100, { serverSeed });

			expect(profilesRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ totalCoinsEarned: 1_000 + net }),
			);
		});

		it("should not change totalCoinsEarned on a losing spin", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForMiss();

			await service.slots(makeUser({ coins: 500 }), 100, { serverSeed });

			expect(profilesRepo.save).not.toHaveBeenCalled();
		});

		it("should write an audit row tagged with the slots game and combination", async () => {
			const symbolId = SLOT_SYMBOLS[0].id;
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 100_000 }));
			const serverSeed = seedForJackpot(symbolId);

			await service.slots(makeUser({ coins: 100_000 }), 100, { serverSeed });

			expect(wagersRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({
					game: "slots",
					segmentId: `${symbolId}|${symbolId}|${symbolId}`,
				}),
			);
		});

		it("should draw one independent roll per reel", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			const result = await service.slots(makeUser({ coins: 500 }), 100, {
				serverSeed: "fixed",
				clientSeed: "c",
			});

			expect(result.fairness.rolls).toEqual(
				computeRolls("fixed", "c", 0, SLOT_REEL_COUNT),
			);
			expect(result.outcomeId).toBe(
				computeRolls("fixed", "c", 0, SLOT_REEL_COUNT)
					.map((roll) => selectSymbol(roll).id)
					.join("|"),
			);
		});

		it("should reject an out-of-bounds stake", async () => {
			await expect(
				service.slots(makeUser({ coins: 99_999 }), MAX_WAGER_COINS + 1, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a non-integer stake", async () => {
			await expect(
				service.slots(makeUser({ coins: 500 }), 10.5, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a spin with insufficient coins", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 50 }));

			await expect(
				service.slots(makeUser({ coins: 50 }), 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});
	});
});
