import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import {
	ConflictException,
	InternalServerErrorException,
	UnauthorizedException,
} from "@nestjs/common";
import { AuthService, DEMO_COINS } from "./auth.service";
import { UsersService } from "../users/users.service";
import { User } from "../users/entities/user.entity";
import { getRepositoryToken } from "@nestjs/typeorm";
import { AuthIdentity } from "./entities/auth-identity.entity";
import { AccountLinksService } from "./account-links.service";

const mockUser: User = {
	id: 1,
	fortyTwoId: "dev-testuser",
	googleId: null,
	username: "testuser",
	email: "testuser@dev.local",
	xp: 0,
	level: 1,
	avatar: null,
	isGuest: false,
	isDevAccount: false,
	profile: null,
} as unknown as User;

const mockResponse = {
	cookie: jest.fn(),
	clearCookie: jest.fn(),
} as unknown as import("express").Response;

// issueAuthCookie derives cookie `secure` from the request's forwarded-proto
// header; an empty headers object is enough for the non-production path.
const mockRequest = {
	headers: {},
} as unknown as import("express").Request;

describe("AuthService", () => {
	let service: AuthService;
	let usersService: jest.Mocked<UsersService>;
	let jwtService: jest.Mocked<JwtService>;
	let identityRepo: {
		create: jest.Mock;
		save: jest.Mock;
		createQueryBuilder: jest.Mock;
	};
	let identityQuery: { addSelect: jest.Mock; where: jest.Mock; andWhere: jest.Mock; getOne: jest.Mock };
	let accountLinksService: { migrateLegacyIdentities: jest.Mock };
	const ORIGINAL_ENV = { ...process.env };

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
	});

	beforeEach(async () => {
		identityQuery = {
			addSelect: jest.fn(),
			where: jest.fn(),
			andWhere: jest.fn(),
			getOne: jest.fn(),
		};
		identityQuery.addSelect.mockReturnValue(identityQuery);
		identityQuery.where.mockReturnValue(identityQuery);
		identityQuery.andWhere.mockReturnValue(identityQuery);
		identityRepo = {
			create: jest.fn((value) => value),
			save: jest.fn(async (value) => value),
			createQueryBuilder: jest.fn(() => identityQuery),
		};
		accountLinksService = { migrateLegacyIdentities: jest.fn() };
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AuthService,
				{
					provide: UsersService,
					useValue: {
						findByFortyTwoId: jest.fn(),
						findByEmail: jest.fn(),
						findByUsername: jest.fn(),
						findForLocalLogin: jest.fn(),
						create: jest.fn(),
						findById: jest.fn(),
						findCanonicalById: jest.fn(),
						save: jest.fn(),
						saveProfile: jest.fn(),
					},
				},
				{ provide: getRepositoryToken(AuthIdentity), useValue: identityRepo },
				{ provide: AccountLinksService, useValue: accountLinksService },
				{
					provide: JwtService,
					useValue: { sign: jest.fn().mockReturnValue("signed.jwt") },
				},
			],
		}).compile();

		service = module.get(AuthService);
		usersService = module.get(UsersService);
		jwtService = module.get(JwtService);
	});

	// ── issueAuthCookie ──────────────────────────────────────────────────────────

	describe("issueAuthCookie", () => {
		it("signs a JWT and sets an httpOnly cookie", () => {
			service.issueAuthCookie(mockRequest, mockResponse, mockUser);
			expect(jwtService.sign).toHaveBeenCalledWith(
				expect.objectContaining({ sub: 1, username: "testuser" }),
				expect.objectContaining({ expiresIn: "24h" }),
			);
			expect(mockResponse.cookie).toHaveBeenCalledWith(
				"auth_token",
				"signed.jwt",
				expect.objectContaining({ httpOnly: true }),
			);
		});

		it("uses a 2-hour TTL for guest sessions", () => {
			service.issueAuthCookie(mockRequest, mockResponse, mockUser, true);
			expect(mockResponse.cookie).toHaveBeenCalledWith(
				"auth_token",
				"signed.jwt",
				expect.objectContaining({ maxAge: 2 * 60 * 60 * 1000 }),
			);
		});

		it("throws InternalServerErrorException when sign fails", () => {
			jwtService.sign.mockImplementation(() => {
				throw new Error("sign error");
			});
			expect(() =>
				service.issueAuthCookie(mockRequest, mockResponse, mockUser),
			).toThrow(InternalServerErrorException);
		});
	});

	// ── findOrCreateUser ─────────────────────────────────────────────────────────

	describe("findOrCreateUser", () => {
		it("returns an existing user when found by 42 id", async () => {
			usersService.findByFortyTwoId.mockResolvedValue(mockUser);
			const result = await service.findOrCreateUser({
				fortyTwoId: mockUser.fortyTwoId!,
				username: mockUser.username,
				email: mockUser.email!,
			});
			expect(result).toBe(mockUser);
			expect(usersService.create).not.toHaveBeenCalled();
		});

		it("creates a new user when not found", async () => {
			usersService.findByFortyTwoId.mockResolvedValue(null);
			usersService.create.mockResolvedValue(mockUser);
			const result = await service.findOrCreateUser({
				fortyTwoId: "new-id",
				username: "newuser",
				email: "new@dev.local",
			});
			expect(usersService.create).toHaveBeenCalledWith(
				expect.objectContaining({ fortyTwoId: "new-id" }),
			);
			expect(result).toBe(mockUser);
		});

		it("throws InternalServerErrorException on repo failure", async () => {
			usersService.findByFortyTwoId.mockRejectedValue(
				new Error("db error"),
			);
			await expect(
				service.findOrCreateUser({
					fortyTwoId: "x",
					username: "x",
					email: "x@x",
				}),
			).rejects.toThrow(InternalServerErrorException);
		});
	});

	// ── seedDemoAccount ──────────────────────────────────────────────────────────

	describe("seedDemoAccount", () => {
		it("creates the demo account as a password user seeded with max coins", async () => {
			const created = { ...mockUser, profile: null } as unknown as User;
			usersService.findByUsername.mockResolvedValue(null);
			usersService.create.mockResolvedValue(created);
			usersService.save.mockImplementation(async (u: User) => u);

			const result = await service.seedDemoAccount();

			expect(usersService.create).toHaveBeenCalledWith(
				expect.objectContaining({
					username: expect.any(String),
					passwordHash: expect.any(String),
				}),
			);
			expect(result?.coins).toBe(DEMO_COINS);
		});

		it("does not store the password in plaintext", async () => {
			const created = { ...mockUser, profile: null } as unknown as User;
			usersService.findByUsername.mockResolvedValue(null);
			usersService.create.mockResolvedValue(created);
			usersService.save.mockImplementation(async (u: User) => u);

			await service.seedDemoAccount();

			const createArg = usersService.create.mock.calls[0][0];
			expect(createArg.passwordHash).toEqual(expect.any(String));
			expect(createArg.passwordHash).not.toContain("KameMaster42");
		});

		it("tops the existing demo account back up to the coin cap when below it", async () => {
			const existing = { ...mockUser, coins: 50 } as unknown as User;
			usersService.findByUsername.mockResolvedValue(existing);
			usersService.save.mockImplementation(async (u: User) => u);

			const result = await service.seedDemoAccount();

			expect(result?.coins).toBe(DEMO_COINS);
			expect(usersService.save).toHaveBeenCalled();
			expect(usersService.create).not.toHaveBeenCalled();
		});

		it("does not write when the demo account already has full coins and isDevAccount set", async () => {
			const existing = {
				...mockUser,
				coins: DEMO_COINS,
				isDevAccount: true,
			} as unknown as User;
			usersService.findByUsername.mockResolvedValue(existing);

			await service.seedDemoAccount();

			expect(usersService.create).not.toHaveBeenCalled();
			expect(usersService.save).not.toHaveBeenCalled();
		});

		// ── Rankings Bug Audit N4: demo account flagged as a dev account ──────────

		it("backfills isDevAccount on an existing demo account seeded before the fix", async () => {
			const existing = {
				...mockUser,
				coins: DEMO_COINS,
				isDevAccount: false,
			} as unknown as User;
			usersService.findByUsername.mockResolvedValue(existing);
			usersService.save.mockImplementation(async (u: User) => u);

			const result = await service.seedDemoAccount();

			expect(usersService.save).toHaveBeenCalledWith(
				expect.objectContaining({ isDevAccount: true }),
			);
			expect(result?.isDevAccount).toBe(true);
		});

		it("sets isDevAccount on a freshly created demo account", async () => {
			const created = { ...mockUser, profile: null } as unknown as User;
			usersService.findByUsername.mockResolvedValue(null);
			usersService.create.mockResolvedValue(created);
			usersService.save.mockImplementation(async (u: User) => u);

			await service.seedDemoAccount();

			expect(usersService.create).toHaveBeenCalledWith(
				expect.objectContaining({ isDevAccount: true }),
			);
		});

		it("returns null and does not throw when seeding fails", async () => {
			usersService.findByUsername.mockRejectedValue(new Error("db down"));

			await expect(service.seedDemoAccount()).resolves.toBeNull();
		});

		// ── Bug Audit M2: production gating ───────────────────────────────────────

		it("does not seed in production without ENABLE_DEMO_ACCOUNT", async () => {
			process.env.NODE_ENV = "production";
			delete process.env.ENABLE_DEMO_ACCOUNT;
			usersService.findByUsername.mockResolvedValue(null);

			const result = await service.seedDemoAccount();

			expect(result).toBeNull();
			expect(usersService.findByUsername).not.toHaveBeenCalled();
			expect(usersService.create).not.toHaveBeenCalled();
		});

		it("refuses to seed in production with ENABLE_DEMO_ACCOUNT=true but default credentials", async () => {
			process.env.NODE_ENV = "production";
			process.env.ENABLE_DEMO_ACCOUNT = "true";
			delete process.env.DEMO_USERNAME;
			delete process.env.DEMO_PASSWORD;
			usersService.findByUsername.mockResolvedValue(null);

			const result = await service.seedDemoAccount();

			expect(result).toBeNull();
			expect(usersService.findByUsername).not.toHaveBeenCalled();
			expect(usersService.create).not.toHaveBeenCalled();
		});

		it("seeds in production when explicitly enabled with non-default credentials", async () => {
			process.env.NODE_ENV = "production";
			process.env.ENABLE_DEMO_ACCOUNT = "true";
			process.env.DEMO_USERNAME = "ShowcaseAccount";
			process.env.DEMO_PASSWORD = "a-real-generated-secret";
			const created = { ...mockUser, profile: null } as unknown as User;
			usersService.findByUsername.mockResolvedValue(null);
			usersService.create.mockResolvedValue(created);
			usersService.save.mockImplementation(async (u: User) => u);

			const result = await service.seedDemoAccount();

			expect(usersService.create).toHaveBeenCalledWith(
				expect.objectContaining({ username: "ShowcaseAccount" }),
			);
			expect(result?.coins).toBe(DEMO_COINS);
		});

		it("seeds normally outside production regardless of ENABLE_DEMO_ACCOUNT", async () => {
			process.env.NODE_ENV = "development";
			delete process.env.ENABLE_DEMO_ACCOUNT;
			const created = { ...mockUser, profile: null } as unknown as User;
			usersService.findByUsername.mockResolvedValue(null);
			usersService.create.mockResolvedValue(created);
			usersService.save.mockImplementation(async (u: User) => u);

			const result = await service.seedDemoAccount();

			expect(usersService.create).toHaveBeenCalled();
			expect(result?.coins).toBe(DEMO_COINS);
		});
	});

	describe("onApplicationBootstrap", () => {
		it("delegates to seedDemoAccount on boot", async () => {
			const spy = jest
				.spyOn(service, "seedDemoAccount")
				.mockResolvedValue(mockUser);

			await service.onApplicationBootstrap();

			expect(accountLinksService.migrateLegacyIdentities).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledTimes(1);
		});
	});

	// ── localRegister ────────────────────────────────────────────────────────────

	describe("localRegister", () => {
		it("throws ConflictException when the username is taken", async () => {
			usersService.findByUsername.mockResolvedValue(mockUser);
			await expect(
				service.localRegister(
					"testuser",
					"new@example.com",
					"password123",
				),
			).rejects.toThrow(ConflictException);
		});

		it("creates a user with a unique email address", async () => {
			usersService.findByUsername.mockResolvedValue(null);
			usersService.findByEmail.mockResolvedValue(null);
			const newUser = {
				...mockUser,
				email: "new@example.com",
			} as User;
			usersService.create.mockImplementation(async (data) =>
				({ ...newUser, ...data } as User),
			);
			const result = await service.localRegister(
				"newuser",
				"new@example.com",
				"password123",
			);
			expect(usersService.create).toHaveBeenCalledWith(
				expect.objectContaining({
					username: "newuser",
					email: "new@example.com",
					isGuest: false,
				}),
			);
			expect(result).toEqual(expect.objectContaining({ username: "newuser" }));
		});
	});

	// ── localLogin ────────────────────────────────────────────────────────────────

	describe("localLogin", () => {
		it("throws UnauthorizedException for unknown username", async () => {
			identityQuery.getOne.mockResolvedValue(null);
			await expect(service.localLogin("nobody", "pass")).rejects.toThrow(
				UnauthorizedException,
			);
		});

		it("throws UnauthorizedException when passwordHash is null (OAuth account)", async () => {
			identityQuery.getOne.mockResolvedValue({ userId: 1, passwordHash: null });
			await expect(
				service.localLogin("testuser", "pass"),
			).rejects.toThrow(UnauthorizedException);
		});

		it("accepts an email identifier for a password account", async () => {
			usersService.findByUsername.mockResolvedValue(null);
			usersService.findByEmail.mockResolvedValue(null);
			usersService.create.mockImplementation(async (data) =>
				({ ...mockUser, ...data } as User),
			);
			usersService.save.mockImplementation(async (user: User) => user);
			const registered = await service.localRegister(
				"testuser",
				"testuser@dev.local",
				"password123",
			);
			const savedIdentity = identityRepo.save.mock.calls.at(-1)?.[0];
			identityQuery.getOne.mockResolvedValue(savedIdentity);
			usersService.findCanonicalById.mockResolvedValue(registered);

			await expect(
				service.localLogin("testuser@dev.local", "password123"),
			).resolves.toBe(registered);
			expect(identityQuery.andWhere).toHaveBeenCalledWith(
				expect.stringContaining("shellEmail"),
				{ identifier: "testuser@dev.local" },
			);
		});

	});
});
