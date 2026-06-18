/**
 * hub/api.ts — typed REST client for the Shell Smash backend.
 *
 * Auth is cookie-based (httpOnly auth_token set by the backend).
 * All calls use credentials: 'include' — no Authorization header, no localStorage.
 * Non-GET requests attach X-CSRF-Token from the csrf_token cookie.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

// ── Typed errors ───────────────────────────────────────────────────────────────

export class AuthError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "AuthError";
	}
}

export class NetworkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NetworkError";
	}
}

// ── CSRF token — cached in-memory after first getCsrfToken() call ─────────────

let cachedCsrfToken: string | null = null;

function readCsrfCookie(): string | null {
	const match = document.cookie
		.split(";")
		.find((c) => c.trim().startsWith("csrf_token="));
	return match ? match.trim().slice("csrf_token=".length) : null;
}

// ── Core fetch helper ─────────────────────────────────────────────────────────

async function apiFetch<T>(
	path: string,
	options: RequestInit = {},
): Promise<T> {
	const method = (options.method ?? "GET").toUpperCase();
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(options.headers as Record<string, string>),
	};

	if (method !== "GET" && method !== "HEAD") {
		const token = cachedCsrfToken ?? readCsrfCookie();
		if (token) headers["X-CSRF-Token"] = token;
	}

	let res: Response;
	try {
		res = await fetch(`${API_BASE}${path}`, {
			...options,
			headers,
			credentials: "include",
		});
	} catch (err) {
		throw new NetworkError(
			`Network request failed for ${path}: ${String(err)}`,
		);
	}

	// Statuses that the frontend needs to act on by inspecting the code:
	//   401 / 403 — auth failures handled by AuthError (CSRF, session, forbidden)
	//   409 — conflict (duplicate username); friendlyError maps this
	//   422 — unprocessable entity (validation errors from backend)
	//   429 — rate limit; friendlyError maps this
	// Everything else that is not 2xx becomes NetworkError.
	const API_ERROR_STATUSES = new Set([401, 403, 409, 422, 429]);
	if (API_ERROR_STATUSES.has(res.status)) {
		throw new AuthError(res.status, `${res.status} on ${path}`);
	}
	if (!res.ok) {
		throw new NetworkError(`API error ${res.status} on ${path}`);
	}
	if (res.status === 204) return {} as T;
	return res.json() as Promise<T>;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface User {
	id: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	hubBackground: string;
	level: number;
	xp: number;
	coins: number;
	isGuest: boolean;
	isDevAccount: boolean;
	avatar: string | null;
	profile?: {
		totalWins: number;
		totalLosses: number;
		gamesPlayed: number;
		totalCoinsEarned: number;
		bio: string | null;
	};
}

export interface ProgressionResult {
	xpGained: number;
	coinsGained: number;
	newXp: number;
	newLevel: number;
	newCoins: number;
	leveledUp: boolean;
	unlockedAchievements: Achievement[];
}

export interface Achievement {
	id: string;
	title: string;
	description: string;
	unlockDescription: string;
	rewardLabel?: string;
	reward:
		| { type: "cosmetic"; cosmeticId: string; label: string }
		| { type: "coins"; amount: number; label: string }
		| { type: "title"; titleId: string; label: string }
		| { type: "none"; label?: string };
	progressCurrent: number;
	progressTarget: number;
	unlocked: boolean;
	unlockedAt: string | null;
}

export interface Cosmetic {
	id: string;
	type: "shell_skin" | "hub_background";
	name: string;
	description: string;
	price: number;
	accentColor: number;
	previewColor?: number;
	owned: boolean;
	equipped: boolean;
	unlockAchievementId?: string;
	unlockRequirement?: { type: "achievement"; achievementId: string };
	lockedReason?: "achievement-locked" | "not enough coins" | "purchasable";
}

export interface MiniGameDefinition {
	id: string;
	name: string;
	status: "available" | "locked" | "coming_soon";
	description: string;
}

/**
 * Maps shell type IDs to owned quantity.
 * The 'none' key is always present (value: Infinity — never depleted).
 */
export interface ShellInventory {
	[shellType: string]: number;
}

export interface ShellSelectionResult {
	shellTypes: string[];
}

export interface FriendView {
	userId: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	avatar: string | null;
	level: number;
	isOnline: boolean;
	requesterId: number;
}

export interface PendingView {
	userId: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	avatar: string | null;
	level: number;
	isOnline: boolean;
}

export interface LeaderboardEntry {
	rank: number;
	userId: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	avatar: string | null;
	level: number;
	wins: number;
	gamesPlayed: number;
	isOnline: boolean;
}

// ── API surface ───────────────────────────────────────────────────────────────

export const api = {
	/** Fetch and cache the CSRF token. Call once before any POST/DELETE. */
	getCsrfToken: async (): Promise<string> => {
		const data = await apiFetch<{ csrfToken: string }>("/auth/csrf-token");
		cachedCsrfToken = data.csrfToken;
		return data.csrfToken;
	},

	/** Returns the current user or throws AuthError(401) if no session. */
	getMe: (): Promise<User> => apiFetch<User>("/auth/me"),

	/** URL to redirect to in order to start the 42 OAuth flow. */
	loginUrl: (): string => `${API_BASE}/auth/42`,

	/** Create a guest session (httpOnly cookie, 2-hour TTL). */
	guestLogin: (): Promise<{ ok: boolean }> =>
		apiFetch<{ ok: boolean }>("/auth/guest", { method: "POST" }),

	/** Create a new local account and log in. Sets httpOnly auth cookie. */
	register: (username: string, password: string): Promise<{ ok: boolean }> =>
		apiFetch<{ ok: boolean }>("/auth/register", {
			method: "POST",
			body: JSON.stringify({ username, password }),
		}),

	/** Log in to an existing local account. Sets httpOnly auth cookie. */
	login: (username: string, password: string): Promise<{ ok: boolean }> =>
		apiFetch<{ ok: boolean }>("/auth/login", {
			method: "POST",
			body: JSON.stringify({ username, password }),
		}),

	/** Dev-only — requires ENABLE_DEV_LOGIN=true on the backend. */
	devLogin: (username = "KameMaster"): Promise<{ ok: boolean }> =>
		apiFetch<{ ok: boolean }>(
			`/auth/dev-login?username=${encodeURIComponent(username)}`,
		),

	/** Logout — clears the auth cookie. */
	logout: (): Promise<{ ok: boolean }> =>
		apiFetch<{ ok: boolean }>("/auth/session", { method: "DELETE" }),

	getUser: (username: string): Promise<User> =>
		apiFetch<User>(`/users/${username}`),
	getAllUsers: (): Promise<User[]> => apiFetch<User[]>("/users"),
	getMiniGames: (): Promise<MiniGameDefinition[]> =>
		apiFetch<MiniGameDefinition[]>("/minigames"),
	getAchievements: (): Promise<Achievement[]> =>
		apiFetch<Achievement[]>("/achievements"),
	getCustomization: (): Promise<Cosmetic[]> =>
		apiFetch<Cosmetic[]>("/customization"),
	equipCosmetic: (cosmeticId: string): Promise<Cosmetic[]> =>
		apiFetch<Cosmetic[]>("/customization/equip", {
			method: "POST",
			body: JSON.stringify({ cosmeticId }),
		}),
	buyCosmetic: (cosmeticId: string): Promise<Cosmetic[]> =>
		apiFetch<Cosmetic[]>("/customization/buy", {
			method: "POST",
			body: JSON.stringify({ cosmeticId }),
		}),

	/**
	 * Record the outcome of a completed game session.
	 * Returns XP / coin / level-up deltas for progression feedback animation.
	 * Non-fatal on failure — callers should catch and log, then continue.
	 */
	submitGameResult: (
		gameId: string,
		outcome: "win" | "loss",
	): Promise<ProgressionResult> =>
		apiFetch<ProgressionResult>("/game-results", {
			method: "POST",
			body: JSON.stringify({ gameId, outcome }),
		}),

	/**
	 * Fetch the logged-in player's shell inventory.
	 * Returns { shellType: quantity } — 'none' is always Infinity.
	 * Throws AuthError if unauthenticated.
	 */
	getShellInventory: (): Promise<ShellInventory> =>
		apiFetch<ShellInventory>("/shells/inventory"),

	/**
	 * Validate a shell selection against the backend before starting a game.
	 * Body: up to 3 special shell IDs (not counting 'none').
	 * Returns the validated list on success; throws AuthError(400) on failure.
	 * This does NOT deduct inventory — it is read-only.
	 */
	validateShellSelection: (
		shellTypes: string[],
	): Promise<ShellSelectionResult> =>
		apiFetch<ShellSelectionResult>("/shells/validate-selection", {
			method: "POST",
			body: JSON.stringify({ shellTypes }),
		}),

	// ── Friends ────────────────────────────────────────────────────────────────

	/** Return all accepted friends with live online status. */
	getFriends: (): Promise<FriendView[]> => apiFetch<FriendView[]>("/friends"),

	/** Return incoming pending friend requests. */
	getPendingRequests: (): Promise<PendingView[]> =>
		apiFetch<PendingView[]>("/friends/pending"),

	/** Send a friend request by username. */
	sendFriendRequest: (username: string): Promise<void> =>
		apiFetch<void>("/friends/request", {
			method: "POST",
			body: JSON.stringify({ username }),
		}),

	/** Accept an incoming friend request by the requester's userId. */
	acceptFriendRequest: (userId: number): Promise<void> =>
		apiFetch<void>("/friends/accept", {
			method: "POST",
			body: JSON.stringify({ userId }),
		}),

	/** Remove a friend or decline/cancel a pending request. */
	removeFriend: (userId: number): Promise<void> =>
		apiFetch<void>(`/friends/${userId}`, { method: "DELETE" }),

	/** Block a user by userId. */
	blockUser: (userId: number): Promise<void> =>
		apiFetch<void>("/friends/block", {
			method: "POST",
			body: JSON.stringify({ userId }),
		}),

	// ── Leaderboard ────────────────────────────────────────────────────────────

	/**
	 * Fetch the leaderboard.
	 * @param period  'all' (default) | 'monthly' | 'weekly'
	 * @param scope   'global' (default) | 'friends'
	 */
	getLeaderboard: (
		period: "all" | "monthly" | "weekly" = "all",
		scope: "global" | "friends" = "global",
	): Promise<LeaderboardEntry[]> =>
		apiFetch<LeaderboardEntry[]>(
			`/users/leaderboard?period=${period}&scope=${scope}`,
		),
};
