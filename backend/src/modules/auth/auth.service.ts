import {
	ConflictException,
	Injectable,
	InternalServerErrorException,
	type OnApplicationBootstrap,
	UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Response } from "express";
import {
	randomBytes,
	randomUUID,
	scrypt,
	timingSafeEqual,
	ScryptOptions,
} from "crypto";
import { v4 as uuidv4 } from "uuid";
import { UsersService } from "../users/users.service";
import { User } from "../users/entities/user.entity";

// ── Password-hashing constants ─────────────────────────────────────────────────
// scrypt params: N=2^15 (32 768), r=8, p=1 → ~100 ms on a modern single core.
// keyLen=64 bytes → 128 hex chars in the stored hash.
// maxmem is set explicitly: the required working memory is 128·N·r = 32 MiB,
// which equals Node's default maxmem and causes OpenSSL to reject the params
// with ERR_CRYPTO_INVALID_SCRYPT_PARAMS. 64 MiB gives ample headroom.
const SCRYPT_OPTS: ScryptOptions = {
	N: 32_768,
	r: 8,
	p: 1,
	maxmem: 64 * 1024 * 1024,
};
const SCRYPT_KEYLEN = 64;

/** Promisified scrypt with full options support (avoids promisify's type limits). */
function scryptDerive(password: string, salt: string): Promise<Buffer> {
	return new Promise((resolve, reject) =>
		scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS, (err, key) =>
			err ? reject(err) : resolve(key),
		),
	);
}

// ── Cookie tuning ─────────────────────────────────────────────────────────────

export const COOKIE_NAME = "auth_token";
const COOKIE_MAX_AGE_S = 60 * 60 * 24; // 24 h — full account
const GUEST_MAX_AGE_S = 60 * 60 * 2; // 2 h  — guest session
const IS_PRODUCTION = process.env.NODE_ENV === "production";

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
	constructor(
		private readonly usersService: UsersService,
		private readonly jwtService: JwtService,
	) {}

	/**
	 * On boot, ensure the shared demo account exists so anyone (e.g. evaluators)
	 * can log in through the normal username/password form. Seeded in every
	 * environment. Failures are non-fatal — seeding must never block startup.
	 */
	async onApplicationBootstrap(): Promise<void> {
		await this.seedDemoAccount();
	}

	// ── Cookie helpers ────────────────────────────────────────────────────────────

	/**
	 * Sign a JWT for `user` and write it as an httpOnly cookie onto `res`.
	 * Uses a 2-hour TTL for guest sessions, 24-hour TTL for full accounts.
	 */
	issueAuthCookie(res: Response, user: User, isGuest = false): void {
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
			res.cookie(COOKIE_NAME, token, {
				httpOnly: true,
				secure: IS_PRODUCTION,
				sameSite: IS_PRODUCTION ? "strict" : "lax",
				maxAge: (isGuest ? GUEST_MAX_AGE_S : COOKIE_MAX_AGE_S) * 1000,
				path: "/",
			});
		} catch {
			throw new InternalServerErrorException(
				"Failed to issue auth cookie",
			);
		}
	}

	/** Clear the auth cookie (logout). */
	clearAuthCookie(res: Response): void {
		res.clearCookie(COOKIE_NAME, { path: "/", httpOnly: true });
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

	async findOrCreateGithubUser(data: {
		githubId: string;
		username: string;
		email?: string | null;
		avatar?: string | null;
	}): Promise<User> {
		try {
			let user = await this.usersService.findByGithubId(data.githubId);
			if (user) return user;

			const existingEmail = data.email
				? await this.usersService.findByEmail(data.email)
				: null;
			const uniqueUsername = await this.makeUniqueOAuthUsername(
				data.username,
			);
			user = await this.usersService.create({
				githubId: data.githubId,
				email: existingEmail ? null : (data.email ?? null),
				username: uniqueUsername,
				avatar: data.avatar ?? undefined,
			});
			return user;
		} catch {
			throw new InternalServerErrorException(
				"Failed to find or create GitHub user",
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
	 * Best-effort: any failure is swallowed so it can never block startup.
	 */
	async seedDemoAccount(): Promise<User | null> {
		const username = process.env.DEMO_USERNAME ?? DEFAULT_DEMO_USERNAME;
		const password = process.env.DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD;

		try {
			let user = await this.usersService.findByUsername(username);

			if (!user) {
				const passwordHash = await this.hashPassword(password);
				user = await this.usersService.create({
					username,
					email: `${username}@demo.local`,
					passwordHash,
				});

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
			} else if (user.coins < DEMO_COINS) {
				// Top the demo account back up so packs can always be showcased.
				user.coins = DEMO_COINS;
				user = await this.usersService.save(user);
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
	private async hashPassword(plain: string): Promise<string> {
		const salt = randomBytes(16).toString("hex");
		const derived = await scryptDerive(plain, salt);
		return `${salt}:${derived.toString("hex")}`;
	}

	/**
	 * Verify a plaintext password against a stored hash.
	 * Uses timingSafeEqual to prevent timing-based enumeration.
	 */
	private async verifyPassword(
		plain: string,
		stored: string,
	): Promise<boolean> {
		const [salt, hash] = stored.split(":");
		if (!salt || !hash) return false;
		try {
			const hashBuf = Buffer.from(hash, "hex");
			const derivedBuf = await scryptDerive(plain, salt);
			return timingSafeEqual(hashBuf, derivedBuf);
		} catch {
			return false;
		}
	}

	/**
	 * Create a new local account with a hashed password.
	 * Throws ConflictException if the username is taken.
	 */
	async localRegister(username: string, password: string): Promise<User> {
		const existing = await this.usersService.findByUsername(username);
		if (existing) throw new ConflictException("Username is already taken");
		try {
			const passwordHash = await this.hashPassword(password);
			return await this.usersService.create({
				username,
				fortyTwoId: null,
				email: null,
				passwordHash,
				isGuest: false,
				isDevAccount: false,
			});
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
	async localLogin(username: string, password: string): Promise<User> {
		const user = await this.usersService.findByUsername(username);
		const stored = user?.passwordHash ?? null;

		// Always run a dummy derivation when there is no stored hash so that
		// the response time is indistinguishable from a real verify.
		if (!stored) {
			await scryptDerive("__dummy_constant__", "__dummy_salt__").catch(
				() => {},
			);
			throw new UnauthorizedException("Invalid username or password");
		}

		const valid = await this.verifyPassword(password, stored);
		if (!valid)
			throw new UnauthorizedException("Invalid username or password");

		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		return user!;
	}
}
