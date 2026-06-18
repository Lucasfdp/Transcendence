import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { UsersService } from "../../users/users.service";
import { COOKIE_NAME } from "../auth.service";

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
	}): Promise<{
		id: number;
		username: string;
		isGuest: boolean;
		isDevAccount: boolean;
	}> {
		// Guests may be cleaned up — treat missing record as session expired.
		const user = await this.usersService.findById(payload.sub);
		if (!user)
			throw new UnauthorizedException(
				"Session expired or user not found",
			);

		return {
			id: user.id,
			username: user.username,
			isGuest: payload.isGuest ?? user.isGuest,
			isDevAccount: payload.isDevAccount ?? user.isDevAccount,
		};
	}
}
