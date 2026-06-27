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

	if (!res.ok) {
		throw new AuthError(
			res.status,
			await readErrorMessage(res, `${res.status} on ${path}`),
		);
	}
	if (res.status === 204) return {} as T;
	return res.json() as Promise<T>;
}

async function apiUploadFile<T>(
	path: string,
	formData: FormData,
): Promise<T> {
	const headers: Record<string, string> = {};
	const token = cachedCsrfToken ?? readCsrfCookie();
	if (token) headers["X-CSRF-Token"] = token;
	let res: Response;
	try {
		res = await fetch(`${API_BASE}${path}`, {
			method: "POST",
			headers,
			credentials: "include",
			body: formData,
		});
	} catch (err) {
		throw new NetworkError(
			`Network request failed for ${path}: ${String(err)}`,
		);
	}
	if (!res.ok) {
		throw new AuthError(
			res.status,
			await readErrorMessage(res, `${res.status} on ${path}`),
		);
	}
	return res.json() as Promise<T>;
}

async function readErrorMessage(
	res: Response,
	fallback: string,
): Promise<string> {
	const contentType = res.headers.get("content-type") ?? "";

	if (contentType.includes("application/json")) {
		try {
			const body = (await res.json()) as {
				message?: string | string[];
				error?: string;
			};
			if (Array.isArray(body.message) && body.message.length > 0) {
				return body.message.join(", ");
			}
			if (typeof body.message === "string" && body.message.trim()) {
				return body.message;
			}
			if (typeof body.error === "string" && body.error.trim()) {
				return body.error;
			}
		} catch {
			return fallback;
		}
	}

	try {
		const text = await res.text();
		return text.trim() || fallback;
	} catch {
		return fallback;
	}
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface MostPlayedGame {
	gameId: string;
	gameName: string;
	gamesPlayed: number;
	/** Win rate as an integer percentage (0–100). */
	winRate: number;
}

export interface User {
	id: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	hubBackground: string;
	hubBackgroundAlter: string | null;
	level: number;
	xp: number;
	coins: number;
	isGuest: boolean;
	isDevAccount: boolean;
	avatar: string | null;
	mostPlayedGame: MostPlayedGame | null;
	profile?: {
		totalWins: number;
		totalLosses: number;
		gamesPlayed: number;
		totalCoinsEarned: number;
		/** Single turtle personality tag chosen by the player. */
		tag: string | null;
		/** Up to 3 pinned achievement IDs. */
		showcasedAchievements: string[] | null;
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
	type: "shell_skin" | "hub_background" | "hub_background_alter";
	name: string;
	description: string;
	price: number;
	accentColor: number;
	previewColor?: number;
	parentCosmeticId?: string;
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

/** Per-game ELO leaderboard entry returned by GET /api/leaderboard?gameId=… */
export interface GameLeaderboardEntry {
	rank: number;
	userId: number;
	username: string;
	turtleName: string | null;
	avatar: string | null;
	level: number;
	rating: number;
	wins: number;
	losses: number;
	draws: number;
}

/** Cross-game total-wins entry returned by GET /api/leaderboard/overall */
export interface OverallLeaderboardEntry {
	rank: number;
	userId: number;
	username: string;
	turtleName: string | null;
	avatar: string | null;
	level: number;
	totalWins: number;
}

export type LeaderboardScope = "global" | "friends";

// ── Notifications ─────────────────────────────────────────────────────────────

export type NotificationType = "friend_request" | "friend_accepted";

export interface NotificationView {
	id: number;
	type: NotificationType;
	fromUserId: number;
	fromUsername: string;
	payload: Record<string, unknown> | null;
	createdAt: string;
}

/** The set of game IDs that have ranked leaderboards. */
export const RANKED_GAMES = [
	{ id: "temple-curling", label: "Temple Curling" },
	{ id: "bamboo-bash", label: "Bamboo Bash" },
	{ id: "kame-knock", label: "Kame Knock" },
	{ id: "bell-clash", label: "Bell Clash" },
] as const;

export type RankedGameId = (typeof RANKED_GAMES)[number]["id"];

// ── API surface ───────────────────────────────────────────────────────────────

export const api = {
	/** Update the current user's turtle name, tag, and/or showcased achievements. */
	updateProfile: (data: {
		turtleName?: string;
		tag?: string | null;
		showcasedAchievements?: string[];
	}): Promise<User> =>
		apiFetch<User>("/users/me", {
			method: "PATCH",
			body: JSON.stringify(data),
		}),

	/** Upload a new avatar image for the current user. */
	uploadAvatar: (file: File): Promise<{ avatarUrl: string }> => {
		const form = new FormData();
		form.append("avatar", file);
		return apiUploadFile<{ avatarUrl: string }>("/users/me/avatar", form);
	},

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
		outcome: "win" | "loss" | "draw" | "completed",
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
	 * Per-game ELO leaderboard.
	 * Returns up to 100 entries ranked highest ELO first.
	 * scope="friends" limits results to accepted friends + caller.
	 */
	getGameLeaderboard: (
		gameId: string,
		scope: LeaderboardScope = "global",
	): Promise<GameLeaderboardEntry[]> =>
		apiFetch<GameLeaderboardEntry[]>(
			`/leaderboard?gameId=${encodeURIComponent(gameId)}&scope=${scope}`,
		),

	/**
	 * Cross-game total-wins leaderboard.
	 * Aggregates wins across all games (casual + ranked + private lobbies).
	 */
	getOverallLeaderboard: (
		scope: LeaderboardScope = "global",
	): Promise<OverallLeaderboardEntry[]> =>
		apiFetch<OverallLeaderboardEntry[]>(`/leaderboard/overall?scope=${scope}`),
};
