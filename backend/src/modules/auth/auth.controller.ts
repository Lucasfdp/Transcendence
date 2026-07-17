import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	HttpCode,
	HttpException,
	Param,
	Post,
	Query,
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
import { FortyTwoAuthGuard } from "./guards/ft-auth.guard";
import { GoogleAuthGuard } from "./guards/google-auth.guard";
import { AccountLinksService } from "./account-links.service";
import { OAuthStateService } from "./oauth-state.service";
import type { VerifiedOAuthIdentity } from "./account-links.types";
import type { AuthMethod } from "./entities/auth-identity.entity";

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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateUsername(raw: string | undefined): string {
	if (!raw || !USERNAME_RE.test(raw)) {
		throw new BadRequestException(
			"username must be 1–20 alphanumeric characters or underscores",
		);
	}
	return raw;
}

function validateEmail(raw: string | undefined): string {
	const email = raw?.trim().toLowerCase() ?? "";
	if (email.length > 254 || !EMAIL_RE.test(email)) {
		throw new BadRequestException("email must be a valid email address");
	}
	return email;
}

function validatePassword(raw: string | undefined): string {
	const password = raw ?? "";
	if (password.length < 8 || password.length > 128) {
		throw new BadRequestException("Password must be 8–128 characters");
	}
	return password;
}

function validateMethod(raw: string): AuthMethod {
	if (!["shellsmash", "google", "forty_two"].includes(raw)) {
		throw new BadRequestException("Unsupported authentication method");
	}
	return raw as AuthMethod;
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
		private readonly accountLinksService: AccountLinksService,
		private readonly oauthStateService: OAuthStateService,
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
		const {
			passwordHash: _pw,
			fortyTwoId: _fortyTwoId,
			googleId: _googleId,
			email: _email,
			mergedIntoUserId: _mergedIntoUserId,
			...safe
		} = user as typeof user & {
			passwordHash?: unknown;
		};
		void [_pw, _fortyTwoId, _googleId, _email, _mergedIntoUserId];
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
	// Create a local account (username + email + password).
	// Rate-limited: 5 attempts / IP / minute.
	// CSRF-validated — caller must include X-CSRF-Token header.

	@Post("register")
	@HttpCode(200)
	async localRegister(
		@Body() body: { username?: string; email?: string; password?: string },
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
		const email = validateEmail(body.email);
		const password = validatePassword(body.password);

		const user = await this.authService.localRegister(username, email, password);
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
		@Body()
		body: { identifier?: string; username?: string; password?: string },
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	): Promise<{ ok: boolean }> {
		this.validateCsrf(req);

		if (!this.rateLimiter.allow(req, "login", 10, 60_000)) {
			throw TooManyRequests("Too many login attempts — try again later.");
		}

		const identifier = (body.identifier ?? body.username)?.trim() ?? "";
		const password = body.password ?? "";

		if (!identifier || !password) {
			throw new BadRequestException(
				"email or username and password are required",
			);
		}

		const user = await this.authService.localLogin(identifier, password);
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
	async fortyTwoLogin(@Res() res: Response): Promise<void> {
		const state = await this.oauthStateService.create({
			provider: "forty_two",
			initiatorUserId: null,
			returnTo: "/",
		});
		res.redirect(`/api/auth/42/authorise?state=${encodeURIComponent(state)}`);
	}

	@Get("42/authorise")
	@UseGuards(FortyTwoAuthGuard)
	fortyTwoAuthorise(): void {
		// Passport handles the provider redirect with the one-time state.
	}

	// ── GET /api/auth/42/callback ─────────────────────────────────────────────────
	// 42 OAuth callback. Passport fills req.user via FortyTwoStrategy.validate().
	// Sets an httpOnly auth cookie then redirects to / — no token in the URL.
	// The React routes then redirect unauthenticated visitors through /auth.

	@Get("42/callback")
	@UseGuards(FortyTwoAuthGuard)
	async fortyTwoCallback(
		@Req() req: Request & { user?: VerifiedOAuthIdentity },
		@Res() res: Response,
		@Query("state") state?: string,
	): Promise<void> {
		if (!req.user) {
			res.redirect("/?auth_error=oauth_failed");
			return;
		}
		const pending = await this.oauthStateService.consume(state);
		if (pending.provider !== "forty_two") {
			throw new UnauthorizedException("OAuth provider state mismatch");
		}
		const result = await this.accountLinksService.completeOAuth(
			req.user,
			pending.initiatorUserId,
		);
		this.authService.issueAuthCookie(req, res, result.user);
		res.redirect(result.conflict ? "/?account_link_conflict=1" : pending.returnTo);
	}

	@Get("google")
	async googleLogin(@Res() res: Response): Promise<void> {
		const state = await this.oauthStateService.create({
			provider: "google",
			initiatorUserId: null,
			returnTo: "/",
		});
		res.redirect(`/api/auth/google/authorise?state=${encodeURIComponent(state)}`);
	}

	@Get("google/authorise")
	@UseGuards(GoogleAuthGuard)
	googleAuthorise(): void {
		// Passport handles the provider redirect with the one-time state.
	}

	@Get("google/callback")
	@UseGuards(GoogleAuthGuard)
	async googleCallback(
		@Req() req: Request & { user?: VerifiedOAuthIdentity },
		@Res() res: Response,
		@Query("state") state?: string,
	): Promise<void> {
		if (!req.user) {
			res.redirect("/?auth_error=oauth_failed");
			return;
		}
		const pending = await this.oauthStateService.consume(state);
		if (pending.provider !== "google") {
			throw new UnauthorizedException("OAuth provider state mismatch");
		}
		const result = await this.accountLinksService.completeOAuth(
			req.user,
			pending.initiatorUserId,
		);
		this.authService.issueAuthCookie(req, res, result.user);
		res.redirect(result.conflict ? "/?account_link_conflict=1" : pending.returnTo);
	}

	@Get("account-links")
	@UseGuards(JwtAuthGuard)
	accountLinks(@Req() req: Request & { user: AuthenticatedUser }) {
		this.assertPersistentUser(req.user);
		return this.accountLinksService.list(req.user.id);
	}

	@Post("account-links/shellsmash/create")
	@UseGuards(JwtAuthGuard)
	async createShellsmashLink(
		@Req() req: Request & { user: AuthenticatedUser },
		@Body() body: { username?: string; email?: string; password?: string },
	): Promise<{ ok: true }> {
		this.validateProtectedMutation(req, "account-link-create");
		await this.accountLinksService.createShellsmash(
			req.user.id,
			validateUsername(body.username),
			validateEmail(body.email),
			validatePassword(body.password),
		);
		return { ok: true };
	}

	@Post("account-links/shellsmash/link")
	@UseGuards(JwtAuthGuard)
	async linkShellsmash(
		@Req() req: Request & { user: AuthenticatedUser },
		@Body() body: { identifier?: string; password?: string },
	): Promise<{ ok: true; conflict: boolean }> {
		this.validateProtectedMutation(req, "account-link-existing");
		const identifier = body.identifier?.trim() ?? "";
		if (!identifier) throw new BadRequestException("Identifier is required");
		const result = await this.accountLinksService.linkExistingShellsmash(
			req.user.id,
			identifier,
			validatePassword(body.password),
		);
		return { ok: true, conflict: result.conflict };
	}

	@Post("account-links/:provider/start")
	@UseGuards(JwtAuthGuard)
	async startProviderLink(
		@Req() req: Request & { user: AuthenticatedUser },
		@Param("provider") providerRaw: string,
	): Promise<{ url: string }> {
		this.validateProtectedMutation(req, "account-link-oauth");
		const method = validateMethod(providerRaw);
		if (method === "shellsmash") {
			throw new BadRequestException("ShellSmash linking uses credentials");
		}
		await this.accountLinksService.assertCanStart(req.user.id);
		const state = await this.oauthStateService.create({
			provider: method,
			initiatorUserId: req.user.id,
			returnTo: "/?account_linked=1",
		});
		const route = method === "forty_two" ? "42" : "google";
		return {
			url: `/api/auth/${route}/authorise?state=${encodeURIComponent(state)}`,
		};
	}

	@Delete("account-links/:method")
	@UseGuards(JwtAuthGuard)
	async unlinkMethod(
		@Req() req: Request & { user: AuthenticatedUser },
		@Param("method") methodRaw: string,
	): Promise<{ ok: true }> {
		this.validateProtectedMutation(req, "account-unlink");
		await this.accountLinksService.unlink(req.user.id, validateMethod(methodRaw));
		return { ok: true };
	}

	@Delete("account-link-conflict/:id/:side/:method")
	@UseGuards(JwtAuthGuard)
	async unlinkConflictDuplicate(
		@Req() req: Request & { user: AuthenticatedUser },
		@Param("id") id: string,
		@Param("side") sideRaw: string,
		@Param("method") methodRaw: string,
	): Promise<{ ok: true }> {
		this.validateProtectedMutation(req, "account-conflict-unlink");
		if (sideRaw !== "current" && sideRaw !== "linked") {
			throw new BadRequestException("Invalid conflict preview");
		}
		await this.accountLinksService.unlinkDuplicate(
			req.user.id,
			id,
			sideRaw,
			validateMethod(methodRaw),
		);
		return { ok: true };
	}

	@Post("account-link-conflict/resolve")
	@UseGuards(JwtAuthGuard)
	async resolveConflict(
		@Req() req: Request & { user: AuthenticatedUser },
		@Res({ passthrough: true }) res: Response,
		@Body() body: { conflictId?: string; keep?: "initiator" | "linked" },
	): Promise<{ ok: true; userId: number }> {
		this.validateProtectedMutation(req, "account-conflict-resolve");
		if (!body.conflictId || !["initiator", "linked"].includes(body.keep ?? "")) {
			throw new BadRequestException("Conflict and account choice are required");
		}
		const user = await this.accountLinksService.resolve(
			req.user.id,
			body.conflictId,
			body.keep!,
		);
		this.authService.issueAuthCookie(req, res, user);
		return { ok: true, userId: user.id };
	}

	// ── CSRF validation ───────────────────────────────────────────────────────────

	private validateCsrf(req: Request): void {
		const headerToken = req.headers["x-csrf-token"] as string | undefined;
		const cookieToken = parseCookie(req.headers.cookie ?? "", CSRF_COOKIE);
		if (!headerToken || !cookieToken || headerToken !== cookieToken) {
			throw new UnauthorizedException("Invalid or missing CSRF token");
		}
	}

	private assertPersistentUser(user: AuthenticatedUser): void {
		if (user.isGuest) {
			throw new ForbiddenException("Guest accounts cannot link sign-in methods");
		}
	}

	private validateProtectedMutation(
		req: Request & { user: AuthenticatedUser },
		bucket: string,
	): void {
		this.assertPersistentUser(req.user);
		this.validateCsrf(req);
		if (!this.rateLimiter.allow(req, bucket, 8, 60_000)) {
			throw TooManyRequests("Too many account-link attempts — try again later.");
		}
	}
}
