import {
	BadRequestException,
	ForbiddenException,
	InternalServerErrorException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import {
	CARDS,
	CARD_FAMILIES,
	DUPLICATE_COIN_REFUND,
	PACK_PRICE_COINS,
	PACK_SIZE,
	PACK_TIERS,
	PRISMATIC_CHANCE_FRACTION,
	cardsByFamily,
	findPackTier,
} from "./cards.constants";
import { CardsService } from "./cards.service";
import { UserCard } from "./entities/user-card.entity";

const DELUXE_PRICE_COINS = findPackTier("deluxe")!.priceCoins;
const LEGENDARY_PRICE_COINS = findPackTier("legendary")!.priceCoins;

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.coins = overrides.coins ?? 0;
	user.profile = overrides.profile ?? new Profile();
	return user;
}

function makeUserCard(
	cardId: string,
	count: number,
	foilCount = 0,
	prismaticCount = 0,
): UserCard {
	const row = new UserCard();
	row.id = 1;
	row.cardId = cardId;
	row.count = count;
	row.foilCount = foilCount;
	row.prismaticCount = prismaticCount;
	row.firstObtainedAt = new Date("2026-01-01T00:00:00Z");
	return row;
}

/** Deterministic rng yielding each queued value in turn (wraps around). */
function seq(values: number[]): () => number {
	let i = 0;
	return () => values[i++ % values.length];
}

// Draw pattern for one rollCard call → rarity=stone, index=0, no foil.
const PULL_STONE_NO_FOIL = [0, 0, 0.99];
// Draw pattern for one rollCard call → rarity=stone, index=0, foil.
const PULL_STONE_FOIL = [0, 0, 0];
// Draw pattern for one rollCard call → rarity=gold, index=0, foil, prismatic.
const PULL_GOLD_PRISMATIC = [0.99, 0, 0, 0];
// Draw pattern for one rollCard call → rarity=gold, index=0, foil, NOT prismatic.
const PULL_GOLD_FOIL_NOT_PRISMATIC = [0.99, 0, 0, PRISMATIC_CHANCE_FRACTION];

describe("CardsService", () => {
	let service: CardsService;
	let cardsRepo: {
		find: jest.Mock;
		findOne: jest.Mock;
		create: jest.Mock;
		save: jest.Mock;
	};
	let usersRepo: { findOne: jest.Mock; save: jest.Mock };
	let dataSource: { transaction: jest.Mock };

	beforeEach(async () => {
		cardsRepo = {
			find: jest.fn().mockResolvedValue([]),
			findOne: jest.fn().mockResolvedValue(null),
			create: jest.fn((data: Partial<UserCard>) => data as UserCard),
			save: jest.fn(async (row: UserCard) => row),
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
							if (entity === UserCard) return cardsRepo;
							throw new Error("Unknown repository");
						},
					}),
			),
		};

		const moduleRef: TestingModule = await Test.createTestingModule({
			providers: [
				CardsService,
				{ provide: getRepositoryToken(UserCard), useValue: cardsRepo },
				{ provide: DataSource, useValue: dataSource },
			],
		}).compile();

		service = moduleRef.get(CardsService);
	});

	describe("getBinder", () => {
		it("should list every catalogue card as unowned when the user owns nothing", async () => {
			const binder = await service.getBinder(makeUser());

			expect(binder.cards).toHaveLength(CARDS.length);
			expect(binder.cards.every((c) => c.owned === false)).toBe(true);
			expect(binder.cards.every((c) => c.count === 0)).toBe(true);
			expect(binder.cards.every((c) => c.foilCount === 0)).toBe(true);
		});

		it("should mark owned cards with their count and foilCount", async () => {
			const sample = CARDS[0];
			cardsRepo.find.mockResolvedValue([makeUserCard(sample.id, 3, 1)]);

			const binder = await service.getBinder(makeUser());
			const view = binder.cards.find((c) => c.id === sample.id);

			expect(view?.owned).toBe(true);
			expect(view?.count).toBe(3);
			expect(view?.foilCount).toBe(1);
		});

		it("should compute per-family set progress from owned distinct cards", async () => {
			const family = CARD_FAMILIES[0];
			const familyCards = cardsByFamily(family);
			cardsRepo.find.mockResolvedValue([makeUserCard(familyCards[0].id, 1)]);

			const binder = await service.getBinder(makeUser());
			const setProgress = binder.sets.find((s) => s.family === family);

			expect(setProgress?.owned).toBe(1);
			expect(setProgress?.total).toBe(familyCards.length);
		});

		it("should report a set entry for every family", async () => {
			const binder = await service.getBinder(makeUser());
			expect(binder.sets).toHaveLength(CARD_FAMILIES.length);
		});

		it("should expose the full, server-authoritative pack tier catalogue", async () => {
			const binder = await service.getBinder(makeUser());
			expect(binder.packTiers).toEqual(PACK_TIERS);
		});

		it("should compute overall totals across the whole catalogue", async () => {
			cardsRepo.find.mockResolvedValue([
				makeUserCard(CARDS[0].id, 1),
				makeUserCard(CARDS[1].id, 5),
			]);

			const binder = await service.getBinder(makeUser());

			expect(binder.totals.owned).toBe(2);
			expect(binder.totals.total).toBe(CARDS.length);
		});

		it("should not count an unknown owned cardId towards catalogue totals", async () => {
			cardsRepo.find.mockResolvedValue([makeUserCard("ghost-card-xyz", 1)]);

			const binder = await service.getBinder(makeUser());

			expect(binder.totals.owned).toBe(0);
		});

		it("should surface a meaningful error when the repository read fails", async () => {
			cardsRepo.find.mockRejectedValue(new Error("db down"));

			await expect(service.getBinder(makeUser())).rejects.toBeInstanceOf(
				InternalServerErrorException,
			);
		});
	});

	describe("openPack", () => {
		it("should default to the basic tier when no tierId is given", async () => {
			const user = makeUser({ coins: 500 });
			usersRepo.findOne.mockResolvedValue(user);

			const result = await service.openPack(
				user,
				undefined,
				seq(PULL_STONE_NO_FOIL),
			);

			expect(result.pulls).toHaveLength(PACK_SIZE);
			expect(result.coins).toBe(500 - PACK_PRICE_COINS);
		});

		it("should deduct exactly the pack price and grant PACK_SIZE new cards on success", async () => {
			const user = makeUser({ coins: 500 });
			usersRepo.findOne.mockResolvedValue(user);

			const result = await service.openPack(
				user,
				"basic",
				seq(PULL_STONE_NO_FOIL),
			);

			expect(result.pulls).toHaveLength(PACK_SIZE);
			expect(result.coins).toBe(500 - PACK_PRICE_COINS);
			expect(result.pulls.every((p) => p.isNew)).toBe(true);
			expect(cardsRepo.save).toHaveBeenCalledTimes(PACK_SIZE);
			expect(usersRepo.save).toHaveBeenCalledTimes(1);
		});

		it("should charge the selected tier's price, not the basic price, when opening a deluxe or legendary pack", async () => {
			const deluxeUser = makeUser({ coins: DELUXE_PRICE_COINS });
			usersRepo.findOne.mockResolvedValue(deluxeUser);
			const deluxeResult = await service.openPack(
				deluxeUser,
				"deluxe",
				seq(PULL_STONE_NO_FOIL),
			);
			expect(deluxeResult.coins).toBe(0);

			const legendaryUser = makeUser({ coins: LEGENDARY_PRICE_COINS });
			usersRepo.findOne.mockResolvedValue(legendaryUser);
			cardsRepo.findOne.mockResolvedValue(null);
			const legendaryResult = await service.openPack(
				legendaryUser,
				"legendary",
				seq(PULL_STONE_NO_FOIL),
			);
			expect(legendaryResult.coins).toBe(0);
		});

		it("should reject an unknown tierId with a 400, spending no coins", async () => {
			const user = makeUser({ coins: 5000 });
			usersRepo.findOne.mockResolvedValue(user);

			await expect(
				service.openPack(
					user,
					"platinum" as unknown as "basic",
					seq(PULL_STONE_NO_FOIL),
				),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(usersRepo.findOne).not.toHaveBeenCalled();
			expect(usersRepo.save).not.toHaveBeenCalled();
		});

		it("should throw BadRequestException and not deduct coins when the user cannot afford a pack", async () => {
			const user = makeUser({ coins: PACK_PRICE_COINS - 1 });
			usersRepo.findOne.mockResolvedValue(user);

			await expect(
				service.openPack(user, "basic", seq(PULL_STONE_NO_FOIL)),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});

		it("should reject when coins are enough for basic but not for the selected legendary tier", async () => {
			const user = makeUser({ coins: PACK_PRICE_COINS });
			usersRepo.findOne.mockResolvedValue(user);

			await expect(
				service.openPack(user, "legendary", seq(PULL_STONE_NO_FOIL)),
			).rejects.toBeInstanceOf(BadRequestException);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});

		it("should throw ForbiddenException when the user row is missing", async () => {
			usersRepo.findOne.mockResolvedValue(null);

			await expect(
				service.openPack(
					makeUser({ coins: 500 }),
					"basic",
					seq(PULL_STONE_NO_FOIL),
				),
			).rejects.toBeInstanceOf(ForbiddenException);
		});

		it("should increment count and refund coins for a duplicate pull", async () => {
			const user = makeUser({ coins: 500 });
			usersRepo.findOne.mockResolvedValue(user);
			const existing = makeUserCard("power-heavy", 1, 0);
			cardsRepo.findOne.mockResolvedValue(existing);

			const result = await service.openPack(
				user,
				"basic",
				seq(PULL_STONE_NO_FOIL),
			);

			// All 5 pulls are duplicates of the same stone card (refund 2 each).
			expect(result.pulls.every((p) => p.isNew === false)).toBe(true);
			expect(existing.count).toBe(1 + PACK_SIZE);
			expect(result.coins).toBe(500 - PACK_PRICE_COINS + 2 * PACK_SIZE);
		});

		it("should increment foilCount when a foil duplicate is pulled", async () => {
			const user = makeUser({ coins: 500 });
			usersRepo.findOne.mockResolvedValue(user);
			const existing = makeUserCard("power-heavy", 1, 0);
			cardsRepo.findOne.mockResolvedValue(existing);

			await service.openPack(user, "basic", seq(PULL_STONE_FOIL));

			expect(existing.foilCount).toBe(PACK_SIZE);
		});

		it("should set prismaticCount to 1 on a brand-new prismatic pull, and foilCount to 1 alongside it", async () => {
			const user = makeUser({ coins: 500 });
			usersRepo.findOne.mockResolvedValue(user);
			cardsRepo.findOne.mockResolvedValue(null);

			await service.openPack(user, "basic", seq(PULL_GOLD_PRISMATIC));

			expect(cardsRepo.create).toHaveBeenCalledWith(
				expect.objectContaining({
					count: 1,
					foilCount: 1,
					prismaticCount: 1,
				}),
			);
		});

		it("should increment prismaticCount (not just foilCount) on a duplicate prismatic pull", async () => {
			const user = makeUser({ coins: 500 });
			usersRepo.findOne.mockResolvedValue(user);
			const existing = makeUserCard("power-lightning", 1, 1, 0);
			cardsRepo.findOne.mockResolvedValue(existing);

			await service.openPack(user, "basic", seq(PULL_GOLD_PRISMATIC));

			expect(existing.foilCount).toBe(1 + PACK_SIZE);
			expect(existing.prismaticCount).toBe(PACK_SIZE);
		});

		it("should refund the same amount for a prismatic duplicate as a regular gold foil duplicate", async () => {
			const user = makeUser({ coins: 500 });
			usersRepo.findOne.mockResolvedValue(user);
			const existing = makeUserCard("power-lightning", 1, 0, 0);
			cardsRepo.findOne.mockResolvedValue(existing);

			const result = await service.openPack(
				user,
				"basic",
				seq(PULL_GOLD_PRISMATIC),
			);

			expect(result.coins).toBe(
				500 - PACK_PRICE_COINS + DUPLICATE_COIN_REFUND.gold * PACK_SIZE,
			);
		});

		it("should never report prismaticCount higher than foilCount across a mix of prismatic and non-prismatic gold-foil pulls", async () => {
			const user = makeUser({ coins: 500 });
			usersRepo.findOne.mockResolvedValue(user);
			const existing = makeUserCard("power-lightning", 1, 0, 0);
			cardsRepo.findOne.mockResolvedValue(existing);

			// A concatenated sequence: first prismatic-eligible pull is prismatic,
			// the rest land gold+foil but just miss the prismatic threshold.
			const draws = [
				...PULL_GOLD_PRISMATIC,
				...PULL_GOLD_FOIL_NOT_PRISMATIC,
				...PULL_GOLD_FOIL_NOT_PRISMATIC,
				...PULL_GOLD_FOIL_NOT_PRISMATIC,
				...PULL_GOLD_FOIL_NOT_PRISMATIC,
			];
			let i = 0;
			await service.openPack(user, "basic", () => draws[i++]);

			expect(existing.prismaticCount).toBeLessThanOrEqual(
				existing.foilCount,
			);
			expect(existing.prismaticCount).toBe(1);
			expect(existing.foilCount).toBe(PACK_SIZE);
		});

		it("should create a first copy with count 1 and no refund for a new pull", async () => {
			const user = makeUser({ coins: 500 });
			usersRepo.findOne.mockResolvedValue(user);
			cardsRepo.findOne.mockResolvedValue(null);

			const result = await service.openPack(
				user,
				"basic",
				seq(PULL_STONE_NO_FOIL),
			);

			expect(cardsRepo.create).toHaveBeenCalledWith(
				expect.objectContaining({ cardId: "power-heavy", count: 1, foilCount: 0 }),
			);
			expect(result.coins).toBe(500 - PACK_PRICE_COINS);
		});

		it("should not persist the coin deduction when a card grant fails (no double-spend)", async () => {
			const user = makeUser({ coins: 500 });
			usersRepo.findOne.mockResolvedValue(user);
			cardsRepo.findOne.mockResolvedValue(null);
			cardsRepo.save.mockRejectedValue(new Error("insert failed"));

			await expect(
				service.openPack(user, "basic", seq(PULL_STONE_NO_FOIL)),
			).rejects.toBeInstanceOf(InternalServerErrorException);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});

		it("should not double-spend coins when the grant step fails for a non-basic tier", async () => {
			const user = makeUser({ coins: LEGENDARY_PRICE_COINS });
			usersRepo.findOne.mockResolvedValue(user);
			cardsRepo.findOne.mockResolvedValue(null);
			cardsRepo.save.mockRejectedValue(new Error("insert failed"));

			await expect(
				service.openPack(user, "legendary", seq(PULL_STONE_NO_FOIL)),
			).rejects.toBeInstanceOf(InternalServerErrorException);
			expect(usersRepo.save).not.toHaveBeenCalled();
		});

		it("should wrap an unexpected repository error as InternalServerErrorException", async () => {
			const user = makeUser({ coins: 500 });
			usersRepo.findOne.mockRejectedValue(new Error("db exploded"));

			await expect(
				service.openPack(user, "basic", seq(PULL_STONE_NO_FOIL)),
			).rejects.toBeInstanceOf(InternalServerErrorException);
		});

		it("should include a gold-or-better card among the pulls when opening a legendary pack, across several seeded sequences", async () => {
			cardsRepo.findOne.mockResolvedValue(null);

			// Every draw pattern below rolls "stone" (r=0) for the first four
			// slots, which would never reach gold on its own — the guaranteed
			// slot is what must still deliver a gold-or-better card.
			const drawPatterns = [
				[0, 0, 0.99],
				[0, 0.5, 0.99],
				[0, 0.999999, 0],
			];

			for (const pattern of drawPatterns) {
				cardsRepo.save.mockClear();
				const user = makeUser({ coins: LEGENDARY_PRICE_COINS });
				usersRepo.findOne.mockResolvedValue(user);

				const result = await service.openPack(
					user,
					"legendary",
					seq(pattern),
				);
				const rarities = result.pulls.map((p) => p.card.rarity);
				expect(rarities).toContain("gold");
			}
		});
	});

	describe("grantMatchDrop", () => {
		it("should grant a brand-new card and report it as new", async () => {
			cardsRepo.findOne.mockResolvedValue(null);

			const pull = await service.grantMatchDrop(
				makeUser(),
				seq(PULL_STONE_NO_FOIL),
			);

			expect(pull.isNew).toBe(true);
			expect(pull.card.id).toBe("power-heavy");
			expect(cardsRepo.create).toHaveBeenCalledWith(
				expect.objectContaining({ cardId: "power-heavy", count: 1 }),
			);
		});

		it("should increment an existing card and report it as not new", async () => {
			const existing = makeUserCard("power-heavy", 2, 0);
			cardsRepo.findOne.mockResolvedValue(existing);

			const pull = await service.grantMatchDrop(
				makeUser(),
				seq(PULL_STONE_NO_FOIL),
			);

			expect(pull.isNew).toBe(false);
			expect(existing.count).toBe(3);
		});

		it("should increment foilCount when the dropped card is foil", async () => {
			const existing = makeUserCard("power-heavy", 1, 0);
			cardsRepo.findOne.mockResolvedValue(existing);

			const pull = await service.grantMatchDrop(
				makeUser(),
				seq(PULL_STONE_FOIL),
			);

			expect(pull.foil).toBe(true);
			expect(existing.foilCount).toBe(1);
		});

		it("should wrap a repository failure as InternalServerErrorException", async () => {
			cardsRepo.findOne.mockRejectedValue(new Error("db down"));

			await expect(
				service.grantMatchDrop(makeUser(), seq(PULL_STONE_NO_FOIL)),
			).rejects.toBeInstanceOf(InternalServerErrorException);
		});

		// ── Bug Audit L5: concurrent first-copy grant race ───────────────────────

		it("should re-read and increment instead of losing the drop when a concurrent grant wins the first-copy race", async () => {
			// The initial `existing` lookup finds nothing (this player has never
			// owned the card), but the insert then loses a race against another
			// concurrent match-completion grant for the same card and hits the
			// unique index on (user, cardId).
			cardsRepo.findOne
				.mockResolvedValueOnce(null) // initial "existing" lookup
				.mockResolvedValueOnce(makeUserCard("power-heavy", 1, 0)); // re-read after 23505
			cardsRepo.save.mockRejectedValueOnce(
				Object.assign(new Error("duplicate key"), { code: "23505" }),
			);

			const pull = await service.grantMatchDrop(
				makeUser(),
				seq(PULL_STONE_NO_FOIL),
			);

			expect(pull.isNew).toBe(false);
			expect(cardsRepo.findOne).toHaveBeenCalledTimes(2);
			// Second save() call increments the re-read row rather than retrying the insert.
			expect(cardsRepo.save).toHaveBeenCalledTimes(2);
			const incremented = cardsRepo.save.mock.calls[1][0] as {
				count: number;
			};
			expect(incremented.count).toBe(2);
		});

		it("should rethrow when the race-winner row can't be found after a 23505", async () => {
			cardsRepo.findOne
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null); // re-read somehow still finds nothing
			cardsRepo.save.mockRejectedValueOnce(
				Object.assign(new Error("duplicate key"), { code: "23505" }),
			);

			await expect(
				service.grantMatchDrop(makeUser(), seq(PULL_STONE_NO_FOIL)),
			).rejects.toBeInstanceOf(InternalServerErrorException);
		});

		it("should rethrow a non-unique-violation save failure without retrying", async () => {
			cardsRepo.findOne.mockResolvedValueOnce(null);
			cardsRepo.save.mockRejectedValueOnce(new Error("connection lost"));

			await expect(
				service.grantMatchDrop(makeUser(), seq(PULL_STONE_NO_FOIL)),
			).rejects.toBeInstanceOf(InternalServerErrorException);
			expect(cardsRepo.findOne).toHaveBeenCalledTimes(1);
		});
	});
});
