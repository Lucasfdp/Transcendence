import {
	BadRequestException,
	ForbiddenException,
	NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { UserAchievement } from "../achievements/entities/user-achievement.entity";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import { CustomizationService } from "./customization.service";
import { UserCosmetic } from "./entities/user-cosmetic.entity";

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.level = overrides.level ?? 1;
	user.xp = overrides.xp ?? 0;
	user.coins = overrides.coins ?? 0;
	user.shellSkin = overrides.shellSkin ?? "kanagawa";
	user.hubBackground = overrides.hubBackground ?? "default_dojo";
	user.profile = overrides.profile ?? new Profile();
	return user;
}

function makeCosmetic(user: User, cosmeticId: string): UserCosmetic {
	const row = new UserCosmetic();
	row.id = 1;
	row.user = user;
	row.cosmeticId = cosmeticId;
	row.unlockedAt = new Date("2026-01-01T00:00:00Z");
	return row;
}

function makeAchievement(user: User, achievementId: string): UserAchievement {
	const row = new UserAchievement();
	row.id = 1;
	row.user = user;
	row.achievementId = achievementId;
	row.unlockedAt = new Date("2026-01-01T00:00:00Z");
	return row;
}

describe("CustomizationService", () => {
	let service: CustomizationService;
	let cosmeticsRepo: {
		find: jest.Mock;
		create: jest.Mock;
		save: jest.Mock;
	};
	let achievementsRepo: {
		find: jest.Mock;
		findOne: jest.Mock;
	};
	let usersRepo: {
		findOne: jest.Mock;
		save: jest.Mock;
	};
	let dataSource: { transaction: jest.Mock };

	beforeEach(async () => {
		cosmeticsRepo = {
			find: jest.fn().mockResolvedValue([]),
			create: jest.fn(
				(data: Partial<UserCosmetic>) => data as UserCosmetic,
			),
			save: jest.fn(async (record: UserCosmetic) => record),
		};
		achievementsRepo = {
			find: jest.fn().mockResolvedValue([]),
			findOne: jest.fn().mockResolvedValue(null),
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
							if (entity === UserCosmetic) return cosmeticsRepo;
							if (entity === UserAchievement)
								return achievementsRepo;
							throw new Error("Unknown repository");
						},
					}),
			),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CustomizationService,
				{
					provide: getRepositoryToken(UserCosmetic),
					useValue: cosmeticsRepo,
				},
				{
					provide: getRepositoryToken(UserAchievement),
					useValue: achievementsRepo,
				},
				{ provide: getRepositoryToken(User), useValue: usersRepo },
				{ provide: DataSource, useValue: dataSource },
			],
		}).compile();

		service = module.get(CustomizationService);
	});

	it("marks default kanagawa as owned", async () => {
		const user = makeUser();

		const cosmetics = await service.listForUser(user);

		expect(
			cosmetics.find((cosmetic) => cosmetic.id === "kanagawa"),
		).toEqual(expect.objectContaining({ owned: true, equipped: true }));
		expect(
			cosmetics.find((cosmetic) => cosmetic.id === "default_dojo"),
		).toEqual(expect.objectContaining({ owned: true, equipped: true }));
	});

	it("cannot equip locked cosmetic", async () => {
		const user = makeUser();

		await expect(service.equip(user, "dragon")).rejects.toThrow(
			ForbiddenException,
		);
	});

	it("can equip owned cosmetic", async () => {
		const user = makeUser();
		cosmeticsRepo.find = jest
			.fn()
			.mockResolvedValue([makeCosmetic(user, "dragon")]);

		const cosmetics = await service.equip(user, "dragon");

		expect(usersRepo.save).toHaveBeenCalledWith(
			expect.objectContaining({ shellSkin: "dragon" }),
		);
		expect(
			cosmetics.find((cosmetic) => cosmetic.id === "dragon")?.equipped,
		).toBe(true);
	});

	it("can equip owned hub background", async () => {
		const user = makeUser();
		cosmeticsRepo.find = jest
			.fn()
			.mockResolvedValue([makeCosmetic(user, "sunset_dojo")]);

		const cosmetics = await service.equip(user, "sunset_dojo");

		expect(usersRepo.save).toHaveBeenCalledWith(
			expect.objectContaining({ hubBackground: "sunset_dojo" }),
		);
		expect(
			cosmetics.find((cosmetic) => cosmetic.id === "sunset_dojo")
				?.equipped,
		).toBe(true);
		expect(
			cosmetics.find((cosmetic) => cosmetic.id === "kanagawa")?.equipped,
		).toBe(true);
	});

	it("cannot buy unknown cosmetic", async () => {
		const user = makeUser();

		await expect(service.buy(user, "missing")).rejects.toThrow(
			NotFoundException,
		);
	});

	it("cannot buy achievement-locked cosmetic before achievement", async () => {
		const user = makeUser({ coins: 200 });
		usersRepo.findOne = jest.fn().mockResolvedValue(user);

		await expect(service.buy(user, "dragon")).rejects.toThrow(
			ForbiddenException,
		);
	});

	it("can buy eligible cosmetic when enough coins", async () => {
		const user = makeUser({ coins: 200 });
		usersRepo.findOne = jest.fn().mockResolvedValue(user);
		achievementsRepo.find = jest
			.fn()
			.mockResolvedValue([makeAchievement(user, "matches-50-played")]);

		const cosmetics = await service.buy(user, "dragon");

		expect(user.coins).toBe(50);
		expect(cosmeticsRepo.save).toHaveBeenCalledWith(
			expect.objectContaining({ cosmeticId: "dragon" }),
		);
		expect(
			cosmetics.find((cosmetic) => cosmetic.id === "dragon")?.owned,
		).toBe(true);
	});

	it("buying already owned cosmetic does not charge twice", async () => {
		const user = makeUser({ coins: 200 });
		usersRepo.findOne = jest.fn().mockResolvedValue(user);
		cosmeticsRepo.find = jest
			.fn()
			.mockResolvedValue([makeCosmetic(user, "dragon")]);
		achievementsRepo.find = jest
			.fn()
			.mockResolvedValue([makeAchievement(user, "matches-50-played")]);

		await service.buy(user, "dragon");

		expect(user.coins).toBe(200);
		expect(cosmeticsRepo.save).not.toHaveBeenCalled();
	});

	it("insufficient coins returns an error", async () => {
		const user = makeUser({ coins: 20 });
		usersRepo.findOne = jest.fn().mockResolvedValue(user);
		achievementsRepo.find = jest
			.fn()
			.mockResolvedValue([makeAchievement(user, "matches-50-played")]);

		await expect(service.buy(user, "dragon")).rejects.toThrow(
			BadRequestException,
		);
	});
});
