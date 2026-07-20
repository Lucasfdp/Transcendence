import {
	ConflictException,
	Injectable,
	InternalServerErrorException,
	Logger,
	type OnApplicationBootstrap,
	UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request, Response } from "express";
import {
	randomBytes,
	randomUUID,
} from "crypto";
import { v4 as uuidv4 } from "uuid";
import { UsersService } from "../users/users.service";
import { User } from "../users/entities/user.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuthIdentity } from "./entities/auth-identity.entity";
import { AccountLinksService } from "./account-links.service";
import { hashPassword, verifyPassword } from "./password.util";

// ── Cookie tuning ─────────────────────────────────────────────────────────────

export const COOKIE_NAME = "auth_token";
const COOKIE_MAX_AGE_S = 60 * 60 * 24; // 24 h — full account
const GUEST_MAX_AGE_S = 60 * 60 * 2; // 2 h  — guest session
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function shouldUseSecureCookies(req: Request): boolean {
	if (IS_PRODUCTION) return true;
	const forwardedProto = req.headers["x-forwarded-proto"];
	return (
		typeof forwardedProto === "string" &&
		forwardedProto.split(",")[0].trim() === "https"
	);
}

function authCookieOptions(req: Request, maxAgeMs: number) {
	const secure = shouldUseSecureCookies(req);
	return {
		httpOnly: true,
		secure,
		sameSite: IS_PRODUCTION ? ("strict" as const) : ("lax" as const),
		maxAge: maxAgeMs,
		path: "/",
	};
}

// ── Demo account seed values ──────────────────────────────────────────────────

const DEMO_LEVEL = 99;
const DEMO_XP = 999_999;
const DEMO_WINS = 999;
const DEMO_GAMES = 999;

/**
 * Coin balance seeded on (and topped back up to on every startup of) the demo
 * account. Effectively unlimited for showcasing packs — 1e9 coins is ~10M packs
 * at the current price — while staying well under the int32 column ceiling so
 * duplicate refunds can't overflow it.
 */
export const DEMO_COINS = 1_000_000_000;

/** Defaults for the always-present demo account (override via env). */
const DEFAULT_DEMO_USERNAME = "KameMaster";
const DEFAULT_DEMO_PASSWORD = "KameMaster42";

@Injectable()
export class AuthService implements OnApplicationBootstrap {
	private readonly logger = new Logger(AuthService.name);

	constructor(
		private readonly usersService: UsersService,
		private readonly jwtService: JwtService,
		@InjectRepository(AuthIdentity)
		private readonly identities: Repository<AuthIdentity>,
		private readonly accountLinksService: AccountLinksService,
	) {}

	/**
	 * On boot, ensure the shared demo account exists so anyone (e.g. evaluators)
	 * can log in through the normal username/password form. Gated to
	 * non-production environments (or an explicit opt-in flag) — see
	 * `seedDemoAccount()`. Failures are non-fatal — seeding must never block
	 * startup.
	 */
	async onApplicationBootstrap(): Promise<void> {
		await this.accountLinksService.migrateLegacyIdentities();
		await this.seedDemoAccount();
	}

	// ── Cookie helpers ────────────────────────────────────────────────────────────

	/**
	 * Sign a JWT for `user` and write it as an httpOnly cookie onto `res`.
	 * Uses a 2-hour TTL for guest sessions, 24-hour TTL for full accounts.
	 */
	issueAuthCookie(
		req: Request,
		res: Response,
		user: User,
		isGuest = false,
	): void {
		try {
			const payload = {
				sub: user.id,
				username: user.username,
				isGuest: isGuest || user.isGuest,
				isDevAccount: user.isDevAccount,
				jti: randomUUID(),
			};
			const token = this.jwtService.sign(payload, {
				expiresIn: isGuest ? "2h" : "24h",
			});
				res.cookie(
					COOKIE_NAME,
					token,
					authCookieOptions(
						req,
						(isGuest ? GUEST_MAX_AGE_S : COOKIE_MAX_AGE_S) * 1000,
					),
				);
		} catch {
			throw new InternalServerErrorException(
				"Failed to issue auth cookie",
			);
		}
	}

	/** Clear the auth cookie (logout). */
	clearAuthCookie(req: Request, res: Response): void {
		res.clearCookie(
			COOKIE_NAME,
			authCookieOptions(req, 0),
		);
	}

	// ── 42 OAuth ──────────────────────────────────────────────────────────────────

	async findOrCreateUser(data: {
		fortyTwoId: string;
		username: string;
		email: string;
		avatar?: string;
	}): Promise<User> {
		try {
			let user = await this.usersService.findByFortyTwoId(
				data.fortyTwoId,
			);
			if (user) return user;

			const existingEmail = data.email
				? await this.usersService.findByEmail(data.email)
				: null;
			const uniqueUsername = await this.makeUniqueOAuthUsername(
				data.username,
			);
			user = await this.usersService.create({
				...data,
				email: existingEmail ? null : data.email,
				username: uniqueUsername,
			});
			return user;
		} catch {
			throw new InternalServerErrorException(
				"Failed to find or create user",
			);
		}
	}

	async findOrCreateGoogleUser(data: {
		googleId: string;
		username: string;
		email?: string | null;
		avatar?: string | null;
	}): Promise<User> {
		try {
			let user = await this.usersService.findByGoogleId(data.googleId);
			if (user) return user;

			const existingEmail = data.email
				? await this.usersService.findByEmail(data.email)
				: null;
			const uniqueUsername = await this.makeUniqueOAuthUsername(
				data.username,
			);
			user = await this.usersService.create({
				googleId: data.googleId,
				email: existingEmail ? null : (data.email ?? null),
				username: uniqueUsername,
				avatar: data.avatar ?? undefined,
			});
			return user;
		} catch {
			throw new InternalServerErrorException(
				"Failed to find or create Google user",
			);
		}
	}

	private async makeUniqueOAuthUsername(
		baseUsername: string,
	): Promise<string> {
		const MAX_SUFFIX_ITERATIONS = 100;

		const normalizedBase = baseUsername.trim() || "player42";
		const clippedBase = normalizedBase.slice(0, 20);
		let candidate = clippedBase;
		let suffix = 2;

		while (await this.usersService.findByUsername(candidate)) {
			if (suffix > MAX_SUFFIX_ITERATIONS) {
				// Numeric suffix space exhausted — use 4 random hex chars as a fallback.
				const fallback = `${clippedBase.slice(0, 15)}_${randomBytes(2).toString("hex")}`;
				if (await this.usersService.findByUsername(fallback)) {
					throw new InternalServerErrorException(
						"Unable to generate a unique OAuth username",
					);
				}
				return fallback;
			}
			const suffixText = String(suffix);
			candidate = `${clippedBase.slice(0, Math.max(1, 20 - suffixText.length))}${suffixText}`;
			suffix += 1;
		}

		return candidate;
	}

	// ── Guest login ───────────────────────────────────────────────────────────────

	/**
	 * Create an ephemeral guest user with a UUID-based username.
	 * No email or fortyTwoId — isGuest is set to true.
	 */
	async guestLogin(): Promise<User> {
		try {
			const shortId = uuidv4().replace(/-/g, "").slice(0, 12);
			return await this.usersService.create({
				username: `guest_${shortId}`,
				fortyTwoId: null,
				email: null,
				isGuest: true,
				isDevAccount: false,
			});
		} catch {
			throw new InternalServerErrorException(
				"Failed to create guest user",
			);
		}
	}

	// ── Demo account ──────────────────────────────────────────────────────────────

	/**
	 * Ensure the shared demo account exists as a normal username/password user,
	 * so it can be logged into through the standard login form. Credentials come
	 * from DEMO_USERNAME / DEMO_PASSWORD (with defaults). The coin balance is
	 * topped back up on every boot so packs can always be showcased.
	 *
	 * GATED (Bug Audit M2): this used to seed a known-credential account
	 * (`KameMaster` / `KameMaster42` by default) unconditionally in every
	 * environment, including production — a predictable backdoor login unless
	 * an operator remembered to override both env vars. It now requires BOTH:
	 *   1. `NODE_ENV !== 'production'`, OR an explicit `ENABLE_DEMO_ACCOUNT=true`
	 *      opt-in for the rare case a demo account is genuinely wanted in prod
	 *      (e.g. a showcase deployment).
	 *   2. Even when explicitly enabled in production, the well-known default
	 *      username/password may not be used — an operator must set real ones.
	 *
	 * Best-effort: any failure is swallowed so it can never block startup.
	 */
	async seedDemoAccount(): Promise<User | null> {
		const isProduction = process.env.NODE_ENV === "production";
		const demoAccountEnabled = process.env.ENABLE_DEMO_ACCOUNT === "true";

		if (isProduction && !demoAccountEnabled) {
			this.logger.log(
				"Demo account seeding skipped (production without ENABLE_DEMO_ACCOUNT=true)",
			);
			return null;
		}

		const username = process.env.DEMO_USERNAME ?? DEFAULT_DEMO_USERNAME;
		const password = process.env.DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD;

		if (
			isProduction &&
			(username === DEFAULT_DEMO_USERNAME ||
				password === DEFAULT_DEMO_PASSWORD)
		) {
			this.logger.warn(
				"Demo account seeding refused: production requires DEMO_USERNAME and DEMO_PASSWORD to be overridden from their defaults",
			);
			return null;
		}

		try {
			let user = await this.usersService.findByUsername(username);

			if (!user) {
				const passwordHash = await hashPassword(password);
				user = await this.usersService.create({
					username,
					email: `${username}@demo.local`,
					passwordHash,
					// Rankings Bug Audit N4 (2026-07-20): the demo account used to
					// rank as a normal player (level 99 wins every overall-board
					// tie-break) because this flag was never set at seeding.
					isDevAccount: true,
				});
				await this.identities.save(
					this.identities.create({
						userId: user.id,
						method: "shellsmash",
						providerSubject: null,
						shellUsername: username,
						shellEmail: `${username.toLowerCase()}@demo.local`,
						passwordHash,
					}),
				);

				user.level = DEMO_LEVEL;
				user.xp = DEMO_XP;
				user.coins = DEMO_COINS;
				user = await this.usersService.save(user);

				if (user.profile) {
					user.profile.totalWins = DEMO_WINS;
					user.profile.totalLosses = 0;
					user.profile.gamesPlayed = DEMO_GAMES;
					await this.usersService.saveProfile(user.profile);
				}
			} else {
				// Rankings Bug Audit N4 (2026-07-20): backfill `isDevAccount` on
				// every boot for a demo account seeded before this fix — top up
				// coins in the same write when due so this stays a single save.
				const needsBackfill = !user.isDevAccount;
				const needsTopUp = user.coins < DEMO_COINS;
				if (needsBackfill || needsTopUp) {
					if (needsBackfill) user.isDevAccount = true;
					if (needsTopUp) user.coins = DEMO_COINS;
					user = await this.usersService.save(user);
				}
			}

			return user;
		} catch {
			// Non-fatal: a demo seeding failure must not prevent the app booting.
			return null;
		}
	}

	// ── Local (username + password) auth ─────────────────────────────────────────

	/**
	 * Hash a plaintext password with scrypt + a random 16-byte salt.
	 * Output format: "<hex-salt>:<hex-derived-key>".
	 */
	/**
	 * Create a new local account with a unique username and email address.
	 */
	async localRegister(
		username: string,
		email: string,
		password: string,
	): Promise<User> {
		const [existingUsername, existingEmail] = await Promise.all([
			this.usersService.findByUsername(username),
			this.usersService.findByEmail(email),
		]);
		if (existingUsername || existingEmail) {
			throw new ConflictException("Username or email is already in use");
		}
		try {
			const passwordHash = await hashPassword(password);
			const user = await this.usersService.create({
				username,
				fortyTwoId: null,
				email,
				passwordHash,
				isGuest: false,
				isDevAccount: false,
			});
			await this.identities.save(
				this.identities.create({
					userId: user.id,
					method: "shellsmash",
					providerSubject: null,
					shellUsername: username,
					shellEmail: email,
					passwordHash,
				}),
			);
			return user;
		} catch (err) {
			if (err instanceof ConflictException) throw err;
			throw new InternalServerErrorException("Failed to create account");
		}
	}

	/**
	 * Validate credentials for a local account.
	 * Always performs the scrypt derivation even when the user doesn't exist
	 * so the response time is constant (prevents username enumeration).
	 * Throws UnauthorizedException on any mismatch.
	 */
	async localLogin(identifier: string, password: string): Promise<User> {
		const identity = await this.identities
			.createQueryBuilder("identity")
			.addSelect("identity.passwordHash")
			.where("identity.method = 'shellsmash'")
			.andWhere(
				"(identity.shellUsername = :identifier OR LOWER(identity.shellEmail) = LOWER(:identifier))",
				{ identifier },
			)
			.getOne();
		const valid = await verifyPassword(password, identity?.passwordHash ?? null);
		if (!valid)
			throw new UnauthorizedException("Invalid email, username or password");
		const user = await this.usersService.findCanonicalById(identity!.userId);
		if (!user) throw new UnauthorizedException("Invalid email, username or password");
		return user;
	}
}
