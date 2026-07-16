import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { JwtStrategy } from "./jwt.strategy";
import { UsersService } from "../../users/users.service";
import { User } from "../../users/entities/user.entity";
import { TokenDenyListService } from "../token-deny-list.service";

const mockUser: User = {
	id: 1,
	username: "kamegoro",
	isGuest: false,
	isDevAccount: false,
} as unknown as User;

/** A fully-populated JWT payload as issued after the revocation fix. */
function makePayload(
	overrides: Partial<{
		sub: number;
		username: string;
		isGuest: boolean;
		isDevAccount: boolean;
		jti?: string;
		exp: number;
	}> = {},
) {
	return {
		sub: 1,
		username: "kamegoro",
		isGuest: false,
		isDevAccount: false,
		jti: "token-1",
		exp: 1_900_000_000,
		...overrides,
	};
}

describe("JwtStrategy", () => {
	let strategy: JwtStrategy;
	let usersService: jest.Mocked<UsersService>;
	let tokenDenyList: jest.Mocked<TokenDenyListService>;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				JwtStrategy,
				{
					provide: ConfigService,
					useValue: { get: jest.fn().mockReturnValue("test-secret") },
				},
				{
					provide: UsersService,
					useValue: { findCanonicalById: jest.fn() },
				},
				{
					provide: TokenDenyListService,
					useValue: { isRevoked: jest.fn().mockResolvedValue(false) },
				},
			],
		}).compile();

		strategy = module.get(JwtStrategy);
		usersService = module.get(UsersService);
		tokenDenyList = module.get(TokenDenyListService);
	});

	describe("validate", () => {
		it("should return the user identity including jti and exp for a valid payload", async () => {
			usersService.findCanonicalById.mockResolvedValue(mockUser);

			const result = await strategy.validate(makePayload());

			expect(result).toEqual({
				id: 1,
				username: "kamegoro",
				isGuest: false,
				isDevAccount: false,
				jti: "token-1",
				exp: 1_900_000_000,
			});
			expect(usersService.findCanonicalById).toHaveBeenCalledWith(1);
		});

		it("should throw UnauthorizedException when the user no longer exists", async () => {
			usersService.findCanonicalById.mockResolvedValue(null);

			await expect(
				strategy.validate(makePayload({ sub: 99, username: "ghost" })),
			).rejects.toThrow(UnauthorizedException);
		});

		it("should throw UnauthorizedException when the token jti is revoked", async () => {
			usersService.findCanonicalById.mockResolvedValue(mockUser);
			tokenDenyList.isRevoked.mockResolvedValue(true);

			await expect(strategy.validate(makePayload())).rejects.toThrow(
				UnauthorizedException,
			);
			expect(tokenDenyList.isRevoked).toHaveBeenCalledWith("token-1");
		});

		it("should skip the deny-list check for legacy tokens without a jti", async () => {
			usersService.findCanonicalById.mockResolvedValue(mockUser);

			const result = await strategy.validate(
				makePayload({ jti: undefined }),
			);

			expect(result.jti).toBeUndefined();
			expect(tokenDenyList.isRevoked).not.toHaveBeenCalled();
		});
	});
});
