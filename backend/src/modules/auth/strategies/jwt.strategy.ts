import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { UsersService } from "../../users/users.service";
import { COOKIE_NAME } from "../auth.service";
import { TokenDenyListService } from "../token-deny-list.service";

/** Parse a single cookie value from a raw `Cookie` header string. */
function parseCookieHeader(cookieHeader: string, name: string): string | null {
	for (const part of cookieHeader.split(";")) {
		const trimmed = part.trim();
		if (trimmed.startsWith(`${name}=`)) {
			return trimmed.slice(name.length + 1);
		}
	}
	return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
	constructor(
		private readonly configService: ConfigService,
		private readonly usersService: UsersService,
		private readonly tokenDenyListService: TokenDenyListService,
	) {
		super({
			// Extract JWT from the httpOnly auth_token cookie — Bearer header not used.
			jwtFromRequest: (req: Request): string | null => {
				const cookieHeader = req?.headers?.cookie ?? "";
				return parseCookieHeader(cookieHeader, COOKIE_NAME);
			},
			secretOrKey: configService.get<string>("JWT_SECRET"),
		});
	}

	async validate(payload: {
		sub: number;
		username: string;
		isGuest: boolean;
		isDevAccount: boolean;
		/** JWT ID — present on all tokens issued after the revocation fix. */
		jti?: string;
		/** Expiry unix timestamp — set automatically by the JWT library. */
		exp: number;
	}): Promise<{
		id: number;
		username: string;
		isGuest: boolean;
		isDevAccount: boolean;
		jti: string | undefined;
		exp: number;
	}> {
		// Guests may be cleaned up — treat missing record as session expired.
		const user = await this.usersService.findById(payload.sub);
		if (!user)
			throw new UnauthorizedException(
				"Session expired or user not found",
			);

		// Reject tokens that appear in the deny list (e.g. logged-out sessions).
		// Tokens issued before the jti fix won't have a jti and are skipped here;
		// they will be rejected naturally once they expire.
		if (payload.jti != null) {
			const revoked = await this.tokenDenyListService.isRevoked(
				payload.jti,
			);
			if (revoked) {
				throw new UnauthorizedException("Token has been revoked");
			}
		}

		return {
			id: user.id,
			username: user.username,
			isGuest: payload.isGuest ?? user.isGuest,
			isDevAccount: payload.isDevAccount ?? user.isDevAccount,
			jti: payload.jti,
			exp: payload.exp,
		};
	}
}
