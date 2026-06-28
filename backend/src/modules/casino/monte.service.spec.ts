import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "./casino.constants";
import { CasinoEngine } from "./casino.engine";
import { computeRoll } from "./casino.fair";
import {
	DEFAULT_SHELLS,
	MONTE_SHELL_OPTIONS,
	winningShell,
} from "./monte.constants";
import { MonteService } from "./monte.service";
import { Wager } from "./entities/wager.entity";

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.coins = overrides.coins ?? 0;
	return user;
}

/** Find a server seed whose roll lands the pearl under `target` for `shells`. */
function seedForShell(target: number, shells: number): string {
	for (let i = 0; i < 200_000; i++) {
		const seed = `seed-${i}`;
		if (winningShell(computeRoll(seed, "", 0), shells) === target) return seed;
	}
	throw new Error(`no seed found for shell ${target}/${shells}`);
}

describe("MonteService", () => {
	let service: MonteService;
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
				MonteService,
				CasinoEngine,
				{ provide: DataSource, useValue: dataSource },
			],
		}).compile();

		service = moduleRef.get(MonteService);
	});

	describe("getMonteConfig", () => {
		it("should expose the shell options, default, RTP, bounds and balance", () => {
			const config = service.getMonteConfig(makeUser({ coins: 222 }));

			expect(config.shellOptions).toEqual([...MONTE_SHELL_OPTIONS]);
			expect(config.defaultShells).toBe(DEFAULT_SHELLS);
			expect(config.rtp).toBeCloseTo(1, 10);
			expect(config.minWager).toBe(MIN_WAGER_COINS);
			expect(config.maxWager).toBe(MAX_WAGER_COINS);
			expect(config.coins).toBe(222);
		});
	});

	describe("monte", () => {
		it("should pay N× for a correct guess at every shell count", async () => {
			for (const shells of MONTE_SHELL_OPTIONS) {
				usersRepo.findOne.mockResolvedValue(makeUser({ coins: 5_000 }));
				const serverSeed = seedForShell(1, shells);

				const result = await service.monte(
					makeUser({ coins: 5_000 }),
					1,
					shells,
					100,
					{ serverSeed },
				);

				expect(result.game).toBe("monte");
				expect(result.outcomeId).toBe("shell-1");
				expect(result.multiplier).toBe(shells);
				expect(result.payout).toBe(100 * shells);
				expect(result.net).toBe(100 * shells - 100);
			}
		});

		it("should pay nothing when the guess misses", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForShell(2, 3); // pearl under shell 2

			const result = await service.monte(
				makeUser({ coins: 500 }),
				0, // guessed shell 0
				3,
				100,
				{ serverSeed },
			);

			expect(result.outcomeId).toBe("shell-2");
			expect(result.multiplier).toBe(0);
			expect(result.payout).toBe(0);
			expect(result.net).toBe(-100);
		});

		it("should default to three shells when none is supplied", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForShell(0, DEFAULT_SHELLS);

			const result = await service.monte(
				makeUser({ coins: 500 }),
				0,
				undefined,
				100,
				{ serverSeed },
			);

			expect(result.multiplier).toBe(DEFAULT_SHELLS);
		});

		it("should credit positive winnings to profile.totalCoinsEarned", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const profile = new Profile();
			profile.totalCoinsEarned = 1_000;
			profilesRepo.findOne.mockResolvedValue(profile);
			const serverSeed = seedForShell(1, 3); // net = +200

			await service.monte(makeUser({ coins: 500 }), 1, 3, 100, {
				serverSeed,
			});

			expect(profilesRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ totalCoinsEarned: 1_200 }),
			);
		});

		it("should write an audit row tagged with the monte game and shell", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const serverSeed = seedForShell(1, 3);

			await service.monte(makeUser({ coins: 500 }), 1, 3, 100, {
				serverSeed,
			});

			expect(wagersRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ game: "monte", segmentId: "shell-1" }),
			);
		});

		it("should reject an unsupported shell count", async () => {
			await expect(
				service.monte(makeUser({ coins: 500 }), 0, 6, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(dataSource.transaction).not.toHaveBeenCalled();
		});

		it("should reject a pick at or beyond the shell count", async () => {
			await expect(
				service.monte(makeUser({ coins: 500 }), 3, 3, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a negative pick", async () => {
			await expect(
				service.monte(makeUser({ coins: 500 }), -1, 3, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a non-integer pick", async () => {
			await expect(
				service.monte(makeUser({ coins: 500 }), 1.5, 3, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject an out-of-bounds stake", async () => {
			await expect(
				service.monte(
					makeUser({ coins: 99_999 }),
					0,
					3,
					MAX_WAGER_COINS + 1,
					{},
				),
			).rejects.toBeInstanceOf(BadRequestException);
		});

		it("should reject a guess with insufficient coins", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 50 }));

			await expect(
				service.monte(makeUser({ coins: 50 }), 0, 3, 100, {}),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});
	});
});
