import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { InternalServerErrorException } from "@nestjs/common";
import { UsersService } from "./users.service";
import { User } from "./entities/user.entity";
import { Profile } from "../profiles/entities/profile.entity";
import { ShellsService } from "../shells/shells.service";

const mockProfile = {
	id: 1,
	totalWins: 0,
	totalLosses: 0,
	gamesPlayed: 0,
} as Profile;
const mockUser: User = {
	id: 1,
	fortyTwoId: "ft-123",
	username: "kamegoro",
	email: "kame@42.fr",
	xp: 0,
	level: 1,
	avatar: null,
	profile: mockProfile,
} as unknown as User;

type MockRepo<T> = Partial<Record<keyof Repository<T>, jest.Mock>>;
const createMockRepo = <T>(): MockRepo<T> => ({
	findOne: jest.fn(),
	find: jest.fn(),
	create: jest.fn(),
	save: jest.fn(),
	createQueryBuilder: jest.fn(),
});

describe("UsersService", () => {
	let service: UsersService;
	let usersRepo: MockRepo<User>;
	let profilesRepo: MockRepo<Profile>;
	let shellsService: jest.Mocked<Pick<ShellsService, "seedInventory">>;

	beforeEach(async () => {
		usersRepo = createMockRepo<User>();
		profilesRepo = createMockRepo<Profile>();
		shellsService = {
			seedInventory: jest.fn().mockResolvedValue(undefined),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				UsersService,
				{ provide: getRepositoryToken(User), useValue: usersRepo },
				{
					provide: getRepositoryToken(Profile),
					useValue: profilesRepo,
				},
				{ provide: ShellsService, useValue: shellsService },
			],
		}).compile();

		service = module.get(UsersService);
	});

	// ── findById ──────────────────────────────────────────────────────────────

	describe("findById", () => {
		it("returns a user when found", async () => {
			usersRepo.findOne!.mockResolvedValue(mockUser);
			expect(await service.findById(1)).toBe(mockUser);
		});

		it("returns null when not found", async () => {
			usersRepo.findOne!.mockResolvedValue(null);
			expect(await service.findById(99)).toBeNull();
		});

		it("throws InternalServerErrorException on db error", async () => {
			usersRepo.findOne!.mockRejectedValue(new Error("db"));
			await expect(service.findById(1)).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});

	// ── findByFortyTwoId ──────────────────────────────────────────────────────

	describe("findByFortyTwoId", () => {
		it("returns user when found", async () => {
			usersRepo.findOne!.mockResolvedValue(mockUser);
			expect(await service.findByFortyTwoId("ft-123")).toBe(mockUser);
		});

		it("returns null when not found", async () => {
			usersRepo.findOne!.mockResolvedValue(null);
			expect(await service.findByFortyTwoId("unknown")).toBeNull();
		});
	});

	// ── findByUsername ────────────────────────────────────────────────────────

	describe("findByUsername", () => {
		const mockQueryBuilder = (result?: User | null, error?: Error) => {
			const builder = {
				addSelect: jest.fn().mockReturnThis(),
				leftJoinAndSelect: jest.fn().mockReturnThis(),
				where: jest.fn().mockReturnThis(),
				getOne: jest.fn(),
			};
			if (error) builder.getOne.mockRejectedValue(error);
			else builder.getOne.mockResolvedValue(result ?? null);
			usersRepo.createQueryBuilder!.mockReturnValue(builder);
			return builder;
		};

		it("returns user when found", async () => {
			mockQueryBuilder(mockUser);
			expect(await service.findByUsername("kamegoro")).toBe(mockUser);
		});

		it("returns null when user not found", async () => {
			mockQueryBuilder(null);
			await expect(service.findByUsername("ghost")).resolves.toBeNull();
		});

		it("wraps query errors in InternalServerErrorException", async () => {
			mockQueryBuilder(null, new Error("connection reset"));
			await expect(service.findByUsername("oops")).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});

	// ── create ────────────────────────────────────────────────────────────────

	describe("create", () => {
		it("creates a profile and user, then saves both", async () => {
			profilesRepo.create!.mockReturnValue(mockProfile);
			profilesRepo.save!.mockResolvedValue(mockProfile);
			usersRepo.create!.mockReturnValue(mockUser);
			usersRepo.save!.mockResolvedValue(mockUser);

			const result = await service.create({
				fortyTwoId: "ft-123",
				username: "kamegoro",
				email: "kame@42.fr",
			});

			expect(profilesRepo.create).toHaveBeenCalled();
			expect(profilesRepo.save).toHaveBeenCalledWith(mockProfile);
			expect(shellsService.seedInventory).toHaveBeenCalledWith(mockUser);
			expect(result).toBe(mockUser);
		});

		it("throws InternalServerErrorException on db error", async () => {
			profilesRepo.create!.mockReturnValue(mockProfile);
			profilesRepo.save!.mockRejectedValue(new Error("disk full"));
			await expect(
				service.create({
					fortyTwoId: "x",
					username: "x",
					email: "x@x",
				}),
			).rejects.toThrow(InternalServerErrorException);
		});
	});

	// ── findAll ───────────────────────────────────────────────────────────────

	describe("findAll", () => {
		it("returns an array of users", async () => {
			usersRepo.find!.mockResolvedValue([mockUser]);
			expect(await service.findAll()).toEqual([mockUser]);
		});

		it("throws InternalServerErrorException on db error", async () => {
			usersRepo.find!.mockRejectedValue(new Error("timeout"));
			await expect(service.findAll()).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});
});
