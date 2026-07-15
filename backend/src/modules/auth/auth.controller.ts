import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpException,
	Post,
	Req,
	Res,
	UnauthorizedException,
	UseGuards,
} from "@nestjs/common";
import { UsersService } from "../users/users.service";

/** Portable 429 — TooManyRequestsException was added in later NestJS patches. */
const TooManyRequests = (msg: string): HttpException =>
	new HttpException(msg, 429);
import { ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { randomBytes } from "crypto";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RateLimiterService } from "./rate-limiter.service";
import { TokenDenyListService } from "./token-deny-list.service";
import { User } from "../users/entities/user.entity";
import { FortyTwoAuthGuard } from "./guards/ft-auth.guard";
import { GoogleAuthGuard } from "./guards/google-auth.guard";

// ── CSRF cookie name (NOT httpOnly — must be readable by JS) ─────────────────
const CSRF_COOKIE = "csrf_token";

// ── Authenticated request user shape (set by JwtStrategy.validate) ───────────
interface AuthenticatedUser {
	id: number;
	username: string;
	isGuest: boolean;
	isDevAccount: boolean;
	/** JWT ID — undefined on tokens issued before the revocation fix. */
	jti?: string;
	/** Expiry unix timestamp. */
	exp: number;
}

// ── Username validation: 1–20 alphanumeric + underscore ──────────────────────
const USERNAME_RE = /^[a-zA-Z0-9_]{1,20}$/;

function validateUsername(raw: string | undefined): string {
	if (!raw || !USERNAME_RE.test(raw)) {
		throw new BadRequestException(
			"username must be 1–20 alphanumeric characters or underscores",
		);
	}
	return raw;
}

function parseCookie(cookieHeader: string, name: string): string | null {
	for (const part of cookieHeader.split(";")) {
		const t = part.trim();
		if (t.startsWith(`${name}=`)) return t.slice(name.length + 1);
	}
	return null;
}

function shouldUseSecureCookies(req: Request): boolean {
	if (process.env.NODE_ENV === "production") return true;
	const forwardedProto = req.headers["x-forwarded-proto"];
	return (
		typeof forwardedProto === "string" &&
		forwardedProto.split(",")[0].trim() === "https"
	);
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
	constructor(
		private readonly authService: AuthService,
		private readonly rateLimiter: RateLimiterService,
		private readonly usersService: UsersService,
		private readonly tokenDenyListService: TokenDenyListService,
	) {}

	// ── GET /api/auth/me ─────────────────────────────────────────────────────────

	@Get("me")
	@UseGuards(JwtAuthGuard)
	async getMe(
		@Req() req: Request & { user: { id: number } },
	): Promise<unknown> {
		const user = await this.usersService.findById(req.user.id);
		if (!user)
			throw new UnauthorizedException(
				"Session expired or user not found",
			);
		// passwordHash has select:false so it is absent from findById results.
		// The explicit omission below is a defence-in-depth guard.
		const { passwordHash: _pw, ...safe } = user as typeof user & {
			passwordHash?: unknown;
		};
		void _pw;
		return safe;
	}

	// ── GET /api/auth/csrf-token ──────────────────────────────────────────────────
	// Issues a double-submit CSRF token:
	//   • Set as a non-httpOnly cookie (so JS can read it)
	//   • Returned in the body (for immediate use by the caller)
	// The frontend attaches it as X-CSRF-Token on every non-GET request.

	@Get("csrf-token")
	getCsrfToken(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	): {
		csrfToken: string;
	} {
		const token = randomBytes(32).toString("hex");
		res.cookie(CSRF_COOKIE, token, {
			httpOnly: false,
			secure: shouldUseSecureCookies(req),
			sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
			path: "/",
		});
		return { csrfToken: token };
	}

	// ── POST /api/auth/guest ──────────────────────────────────────────────────────
	// Creates an ephemeral guest user; sets a 2-hour httpOnly auth cookie.
	// Rate-limited: 10 requests / IP / minute.

	@Post("guest")
	@HttpCode(200)
	async guestLogin(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	): Promise<{ ok: boolean }> {
		this.validateCsrf(req);
		if (!this.rateLimiter.allow(req, "guest", 10, 60_000)) {
			throw TooManyRequests("Too many guest sessions — try again later.");
		}
		const user = await this.authService.guestLogin();
		this.authService.issueAuthCookie(req, res, user, true);
		return { ok: true };
	}

	// ── POST /api/auth/register ───────────────────────────────────────────────────
	// Create a new local account (username + password).
	// Rate-limited: 5 attempts / IP / minute.
	// CSRF-validated — caller must include X-CSRF-Token header.

	@Post("register")
	@HttpCode(200)
	async localRegister(
		@Body() body: { username?: string; password?: string },
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	): Promise<{ ok: boolean }> {
		this.validateCsrf(req);

		if (!this.rateLimiter.allow(req, "register", 5, 60_000)) {
			throw TooManyRequests(
				"Too many registration attempts — try again later.",
			);
		}

		const username = validateUsername(body.username);
		const password = body.password ?? "";

		if (password.length < 8) {
			throw new BadRequestException(
				"Password must be at least 8 characters",
			);
		}
		if (password.length > 128) {
			throw new BadRequestException(
				"Password must be at most 128 characters",
			);
		}

		const user = await this.authService.localRegister(username, password);
		this.authService.issueAuthCookie(req, res, user);
		return { ok: true };
	}

	// ── POST /api/auth/login ──────────────────────────────────────────────────────
	// Authenticate an existing local account.
	// Rate-limited: 10 attempts / IP / minute.
	// CSRF-validated — caller must include X-CSRF-Token header.

	@Post("login")
	@HttpCode(200)
	async localLogin(
		@Body() body: { username?: string; password?: string },
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	): Promise<{ ok: boolean }> {
		this.validateCsrf(req);

		if (!this.rateLimiter.allow(req, "login", 10, 60_000)) {
			throw TooManyRequests("Too many login attempts — try again later.");
		}

		const username = body.username?.trim() ?? "";
		const password = body.password ?? "";

		if (!username || !password) {
			throw new BadRequestException("username and password are required");
		}

		const user = await this.authService.localLogin(username, password);
		this.authService.issueAuthCookie(req, res, user);
		return { ok: true };
	}

	// ── DELETE /api/auth/session ──────────────────────────────────────────────────
	// Revokes the JWT in Redis, then clears the auth cookie.

	@Delete("session")
	@UseGuards(JwtAuthGuard)
	async logout(
		@Req() req: Request & { user: AuthenticatedUser },
		@Res({ passthrough: true }) res: Response,
	): Promise<{ ok: boolean }> {
		const { jti, exp } = req.user;
		if (jti != null) {
			const now = Math.floor(Date.now() / 1000);
			const remainingTtl = Math.max(0, exp - now);
			if (remainingTtl > 0) {
				await this.tokenDenyListService.revoke(jti, remainingTtl);
			}
		}
		this.authService.clearAuthCookie(req, res);
		return { ok: true };
	}

	// ── GET /api/auth/42 ─────────────────────────────────────────────────────────
	// Starts the 42 OAuth flow via Passport.

	@Get("42")
	@UseGuards(FortyTwoAuthGuard)
	fortyTwoLogin(): void {
		// Passport handles the redirect to the provider.
	}

	// ── GET /api/auth/42/callback ─────────────────────────────────────────────────
	// 42 OAuth callback. Passport fills req.user via FortyTwoStrategy.validate().
	// Sets an httpOnly auth cookie then redirects to / — no token in the URL.
	// The React routes then redirect unauthenticated visitors through /auth.

	@Get("42/callback")
	@UseGuards(FortyTwoAuthGuard)
	async fortyTwoCallback(
		@Req() req: Request & { user?: User },
		@Res() res: Response,
	): Promise<void> {
		if (!req.user) {
			res.redirect("/?auth_error=oauth_failed");
			return;
		}
		this.authService.issueAuthCookie(req, res, req.user);
		res.redirect("/");
	}

	@Get("google")
	@UseGuards(GoogleAuthGuard)
	googleLogin(): void {
		// Passport handles the redirect to the provider.
	}

	@Get("google/callback")
	@UseGuards(GoogleAuthGuard)
	async googleCallback(
		@Req() req: Request & { user?: User },
		@Res() res: Response,
	): Promise<void> {
		if (!req.user) {
			res.redirect("/?auth_error=oauth_failed");
			return;
		}
		this.authService.issueAuthCookie(req, res, req.user);
		res.redirect("/");
	}

	// ── CSRF validation ───────────────────────────────────────────────────────────

	private validateCsrf(req: Request): void {
		const headerToken = req.headers["x-csrf-token"] as string | undefined;
		const cookieToken = parseCookie(req.headers.cookie ?? "", CSRF_COOKIE);
		if (!headerToken || !cookieToken || headerToken !== cookieToken) {
			throw new UnauthorizedException("Invalid or missing CSRF token");
		}
	}
}
