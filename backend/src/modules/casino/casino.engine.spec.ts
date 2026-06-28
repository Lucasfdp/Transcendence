import {
	BadRequestException,
	ForbiddenException,
	InternalServerErrorException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import type { CasinoGame, Decide, ResolveInput } from "./casino.engine";
import { CasinoEngine } from "./casino.engine";
import { computeRoll, computeRolls, hashSeed } from "./casino.fair";
import { Wager } from "./entities/wager.entity";

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.coins = overrides.coins ?? 0;
	return user;
}

/** A decide() that always returns a fixed outcome — handy for deterministic tests. */
function fixedDecide(multiplier: number, outcomeId = "out"): Decide {
	return () => ({ outcomeId, multiplier });
}

function input(overrides: Partial<ResolveInput> = {}): ResolveInput {
	return {
		game: "flip" as CasinoGame,
		mode: "wagered",
		stake: 100,
		paid: 100,
		options: { serverSeed: "fixed", clientSeed: "" },
		...overrides,
	};
}

describe("CasinoEngine", () => {
	let engine: CasinoEngine;
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
				CasinoEngine,
				{ provide: DataSource, useValue: dataSource },
			],
		}).compile();

		engine = moduleRef.get(CasinoEngine);
	});

	describe("resolveSpin", () => {
		it("should debit `paid`, credit floor(stake × multiplier) and return the balance", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			const result = await engine.resolveSpin(
				makeUser({ coins: 500 }),
				input({ stake: 100, paid: 100 }),
				fixedDecide(2, "heads"),
			);

			expect(result.payout).toBe(200);
			expect(result.net).toBe(100);
			expect(result.coins).toBe(600);
			expect(result.outcomeId).toBe("heads");
			expect(result.multiplier).toBe(2);
			expect(result.game).toBe("flip");
		});

		it("should floor a fractional payout", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			const result = await engine.resolveSpin(
				makeUser({ coins: 500 }),
				input({ stake: 101, paid: 101 }),
				fixedDecide(0.5),
			);

			expect(result.payout).toBe(50); // floor(101 × 0.5)
			expect(result.net).toBe(-51);
		});

		it("should lose the full stake when the multiplier is 0", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			const result = await engine.resolveSpin(
				makeUser({ coins: 500 }),
				input({ stake: 100, paid: 100 }),
				fixedDecide(0),
			);

			expect(result.payout).toBe(0);
			expect(result.net).toBe(-100);
			expect(result.coins).toBe(400);
		});

		it("should credit positive net winnings to profile.totalCoinsEarned", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const profile = new Profile();
			profile.totalCoinsEarned = 1_000;
			profilesRepo.findOne.mockResolvedValue(profile);

			await engine.resolveSpin(
				makeUser({ coins: 500 }),
				input({ stake: 100, paid: 100 }),
				fixedDecide(2),
			);

			expect(profilesRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ totalCoinsEarned: 1_100 }),
			);
		});

		it("should not touch totalCoinsEarned on a losing spin", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			await engine.resolveSpin(
				makeUser({ coins: 500 }),
				input({ stake: 100, paid: 100 }),
				fixedDecide(0),
			);

			expect(profilesRepo.save).not.toHaveBeenCalled();
		});

		it("should reject a wager when the player has insufficient coins", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 50 }));

			await expect(
				engine.resolveSpin(
					makeUser({ coins: 50 }),
					input({ stake: 100, paid: 100 }),
					fixedDecide(2),
				),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});

		it("should allow a free spin (paid 0) even at a zero balance", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 0 }));

			const result = await engine.resolveSpin(
				makeUser({ coins: 0 }),
				input({ mode: "free", stake: 50, paid: 0 }),
				fixedDecide(2),
			);

			expect(result.payout).toBe(100);
			expect(result.coins).toBe(100);
		});

		it("should throw ForbiddenException when the locked user no longer exists", async () => {
			usersRepo.findOne.mockResolvedValue(null);

			await expect(
				engine.resolveSpin(makeUser(), input(), fixedDecide(2)),
			).rejects.toBeInstanceOf(ForbiddenException);
		});

		it("should run a precheck inside the transaction and surface its rejection", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const precheck = jest
				.fn()
				.mockRejectedValue(new BadRequestException("blocked"));

			await expect(
				engine.resolveSpin(
					makeUser({ coins: 500 }),
					input({ precheck }),
					fixedDecide(2),
				),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(precheck).toHaveBeenCalledTimes(1);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});

		it("should wrap an unexpected transaction failure as InternalServerErrorException", async () => {
			dataSource.transaction.mockRejectedValue(new Error("db is down"));

			await expect(
				engine.resolveSpin(makeUser({ coins: 500 }), input(), fixedDecide(2)),
			).rejects.toBeInstanceOf(InternalServerErrorException);
		});
	});

	describe("audit & fairness", () => {
		it("should write one immutable Wager row carrying the game discriminator", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			const result = await engine.resolveSpin(
				makeUser({ coins: 500 }),
				input({
					game: "flip" as CasinoGame,
					options: { serverSeed: "fixed", clientSeed: "lucky" },
				}),
				fixedDecide(2, "heads"),
			);

			expect(wagersRepo.save).toHaveBeenCalledTimes(1);
			expect(wagersRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({
					game: "flip",
					mode: "wagered",
					stake: 100,
					paid: 100,
					segmentId: "heads",
					multiplier: 2,
					payout: result.payout,
					net: result.net,
					serverSeed: "fixed",
					serverSeedHash: hashSeed("fixed"),
					clientSeed: "lucky",
					nonce: result.fairness.nonce,
				}),
			);
		});

		it("should use the prior wager count as the nonce and expose a recomputable roll", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			wagersRepo.count.mockResolvedValue(5);

			const { fairness } = await engine.resolveSpin(
				makeUser({ coins: 500 }),
				input({ options: { serverSeed: "fixed", clientSeed: "c" } }),
				fixedDecide(2),
			);

			expect(fairness.nonce).toBe(5);
			expect(fairness.roll).toBe(computeRoll("fixed", "c", 5));
			expect(fairness.rolls).toEqual([computeRoll("fixed", "c", 5)]);
		});

		it("should expose `rolls` per reel for a multi-roll spin and pass them to decide", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const seen: number[] = [];
			const decide: Decide = (rollAt) => {
				seen.push(rollAt(0), rollAt(1), rollAt(2));
				return { outcomeId: "a|b|c", multiplier: 0 };
			};

			const { fairness } = await engine.resolveSpin(
				makeUser({ coins: 500 }),
				input({
					game: "slots" as CasinoGame,
					rolls: 3,
					options: { serverSeed: "fixed", clientSeed: "c" },
				}),
				decide,
			);

			const expected = computeRolls("fixed", "c", 0, 3);
			expect(fairness.rolls).toEqual(expected);
			expect(fairness.roll).toBe(expected[0]);
			expect(seen).toEqual(expected);
		});

		it("should reject a decide() that reads a roll beyond the requested count", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));
			const decide: Decide = (rollAt) => {
				rollAt(2); // only 1 roll requested
				return { outcomeId: "x", multiplier: 0 };
			};

			await expect(
				engine.resolveSpin(
					makeUser({ coins: 500 }),
					input({ rolls: 1 }),
					decide,
				),
			).rejects.toBeInstanceOf(InternalServerErrorException);
		});
	});

	describe("locking", () => {
		it("should resolve inside a single transaction", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			await engine.resolveSpin(
				makeUser({ coins: 500 }),
				input(),
				fixedDecide(2),
			);

			expect(dataSource.transaction).toHaveBeenCalledTimes(1);
		});

		it("should take a pessimistic write lock with eager relations disabled", async () => {
			usersRepo.findOne.mockResolvedValue(makeUser({ coins: 500 }));

			await engine.resolveSpin(
				makeUser({ coins: 500 }),
				input(),
				fixedDecide(2),
			);

			expect(usersRepo.findOne).toHaveBeenCalledWith(
				expect.objectContaining({
					lock: { mode: "pessimistic_write" },
					loadEagerRelations: false,
				}),
			);
		});
	});
});
