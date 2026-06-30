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

const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_RETRY_DELAY_MS = 350;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// ── CSRF token — cached in-memory after first getCsrfToken() call ─────────────

let cachedCsrfToken: string | null = null;

function readCsrfCookie(): string | null {
	const match = document.cookie
		.split(";")
		.find((c) => c.trim().startsWith("csrf_token="));
	return match ? match.trim().slice("csrf_token=".length) : null;
}

function getCurrentCsrfToken(): string | null {
	// Always prefer the browser cookie because it is the server-authoritative
	// token. The in-memory cache can go stale across tabs or after a later refresh.
	return readCsrfCookie() ?? cachedCsrfToken;
}

async function fetchCsrfToken(): Promise<string> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const res = await fetch(`${API_BASE}/auth/csrf-token`, {
			credentials: "include",
		});

		if (res.ok) {
			const data = (await res.json()) as { csrfToken: string };
			cachedCsrfToken = data.csrfToken;
			return data.csrfToken;
		}

		const message = await readErrorMessage(
			res,
			`${res.status} on /auth/csrf-token`,
		);
		if (
			attempt === 0 &&
			TRANSIENT_HTTP_STATUSES.has(res.status)
		) {
			await sleep(TRANSIENT_RETRY_DELAY_MS);
			continue;
		}

		throw new AuthError(res.status, message);
	}
	throw new AuthError(503, "Temporary auth bootstrap failure");
}

function isCsrfFailure(res: Response, message: string): boolean {
	return (
		(res.status === 401 || res.status === 403) &&
		message.toLowerCase().includes("csrf")
	);
}

function withCsrfHeader(
	headers: Record<string, string>,
	method: string,
): Record<string, string> {
	if (method === "GET" || method === "HEAD") return headers;
	const token = getCurrentCsrfToken();
	return token ? { ...headers, "X-CSRF-Token": token } : headers;
}

// ── Core fetch helper ─────────────────────────────────────────────────────────

async function apiFetch<T>(
	path: string,
	options: RequestInit = {},
): Promise<T> {
	const method = (options.method ?? "GET").toUpperCase();
	const baseHeaders: Record<string, string> = {
		"Content-Type": "application/json",
		...(options.headers as Record<string, string>),
	};

	const runFetch = () =>
		fetch(`${API_BASE}${path}`, {
			...options,
			headers: withCsrfHeader(baseHeaders, method),
			credentials: "include",
		});

	let res: Response;
	try {
		res = await runFetch();
	} catch (err) {
		throw new NetworkError(
			`Network request failed for ${path}: ${String(err)}`,
		);
	}

	if (!res.ok) {
		const message = await readErrorMessage(res, `${res.status} on ${path}`);
		if (
			TRANSIENT_HTTP_STATUSES.has(res.status) &&
			method === "GET"
		) {
			await sleep(TRANSIENT_RETRY_DELAY_MS);
			try {
				res = await runFetch();
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
		} else
		if (isCsrfFailure(res, message) && method !== "GET" && method !== "HEAD") {
			await fetchCsrfToken();
			try {
				res = await runFetch();
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
		} else {
			throw new AuthError(res.status, message);
		}
	}
	if (res.status === 204) return {} as T;
	return res.json() as Promise<T>;
}

async function apiUploadFile<T>(
	path: string,
	formData: FormData,
): Promise<T> {
	const headers = withCsrfHeader({}, "POST");
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
		const message = await readErrorMessage(res, `${res.status} on ${path}`);
		if (isCsrfFailure(res, message)) {
			await fetchCsrfToken();
			res = await fetch(`${API_BASE}${path}`, {
				method: "POST",
				headers: withCsrfHeader({}, "POST"),
				credentials: "include",
				body: formData,
			});
			if (!res.ok) {
				throw new AuthError(
					res.status,
					await readErrorMessage(res, `${res.status} on ${path}`),
				);
			}
		} else {
			throw new AuthError(res.status, message);
		}
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
	/** Cosmetic card awarded for completing the match, or null if none. */
	cardDrop: PackPull | null;
}

// ── Shell Cards (collectible binder) ─────────────────────────────────────────

export type CardRarity = "stone" | "bronze" | "jade" | "gold";
export type CardFamily =
	| "power_shell"
	| "shrine"
	| "shell_skin"
	| "character";

export interface CardView {
	id: string;
	family: CardFamily;
	rarity: CardRarity;
	name: string;
	flavor: string;
	sourceRef: string;
	imageUrl?: string;
	owned: boolean;
	count: number;
	foilCount: number;
}

export interface CardSetProgress {
	family: CardFamily;
	owned: number;
	total: number;
}

export interface BinderView {
	cards: CardView[];
	sets: CardSetProgress[];
	totals: { owned: number; total: number };
	packPrice: number;
}

export interface PackPull {
	card: Omit<CardView, "owned" | "count" | "foilCount">;
	foil: boolean;
	isNew: boolean;
}

export interface PackResult {
	pulls: PackPull[];
	coins: number;
}

// ── Fortune Wheel (the gambling den) ─────────────────────────────────────────

export interface WheelSegment {
	id: string;
	label: string;
	multiplier: number;
	weight: number;
}

export interface WheelSegmentView extends WheelSegment {
	/** Probability of landing here = weight / total weight. */
	probability: number;
}

export interface WheelView {
	segments: WheelSegmentView[];
	/** Weighted-average return-to-player (1.0 = net-neutral, no house edge). */
	rtp: number;
	freeStake: number;
	minWager: number;
	maxWager: number;
	coins: number;
	freeSpinAvailable: boolean;
}

/** Which gambling-den game a spin belongs to. */
export type CasinoGame = "wheel" | "flip" | "monte" | "slots";

/** Provably-fair data the player can recompute to verify a spin. */
export interface SpinFairness {
	serverSeed: string;
	serverSeedHash: string;
	clientSeed: string;
	nonce: number;
	/** The first roll in [0, 1) — equals `rolls[0]`. */
	roll: number;
	/** Every roll drawn for this spin (one per reel; single-roll games = [roll]). */
	rolls: number[];
}

/** Generic outcome of any resolved spin (shared by every game). */
export interface SpinResolution {
	game: CasinoGame;
	mode: "free" | "wagered";
	/** Stable id of the resolved outcome (e.g. "x2", "heads", "shell-1"). */
	outcomeId: string;
	multiplier: number;
	stake: number;
	paid: number;
	payout: number;
	net: number;
	coins: number;
	fairness: SpinFairness;
}

/** A resolved Fortune Wheel spin: the generic resolution plus its segment. */
export interface SpinResult extends SpinResolution {
	segment: WheelSegment;
}

// ── Shell Flip ───────────────────────────────────────────────────────────────

/** A called/landed shell side. */
export type FlipSide = "heads" | "tails";

/** Shell Flip layout: multiplier, RTP, bounds and the player's balance. */
export interface FlipConfig {
	multiplier: number;
	rtp: number;
	minWager: number;
	maxWager: number;
	coins: number;
}

// ── Three-Shell Monte ────────────────────────────────────────────────────────

/** Three-Shell Monte layout: risk tiers, default, RTP, bounds and balance. */
export interface MonteConfig {
	shellOptions: number[];
	defaultShells: number;
	rtp: number;
	minWager: number;
	maxWager: number;
	coins: number;
}

// ── Shrine Slots ─────────────────────────────────────────────────────────────

/** One reel symbol with its odds and three-of-a-kind payout. */
export interface SlotSymbolView {
	id: string;
	label: string;
	weight: number;
	/** Probability of this symbol on one reel. */
	probability: number;
	/** Three-of-a-kind payout multiplier. */
	payout: number;
}

/** Shrine Slots layout: reel, paytable, RTP, bounds and balance. */
export interface SlotsView {
	symbols: SlotSymbolView[];
	reelCount: number;
	rtp: number;
	minWager: number;
	maxWager: number;
	coins: number;
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
	type: "shell_skin" | "hub_background" | "hub_background_alter" | "dojo_tag";
	name: string;
	description: string;
	price: number;
	accentColor: number;
	previewColor?: number;
	parentCosmeticId?: string;
	tagEmoji?: string;
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

export interface ReplayFrame {
	seq: number;
	recordedAt: string;
	snapshot: Record<string, unknown>;
}

export interface ReplaySummary {
	id: string;
	matchId: string;
	gameId: string;
	mode: string;
	status: string;
	frameCount: number;
	createdAt: string;
	finishedAt: string | null;
	expiresAt: string | null;
	winnerSide: number | null;
	playerUserIds: number[];
	playerNames: string[];
	isSavedByCurrentUser: boolean;
}

export interface ReplayDetail extends ReplaySummary {
	frames: ReplayFrame[];
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
	getCsrfToken: (): Promise<string> => fetchCsrfToken(),

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

	/** Fetch the player's Shell Cards binder (owned + locked + set progress). */
	getCards: (): Promise<BinderView> => apiFetch<BinderView>("/cards"),

	/** Spend coins to open one card pack. Returns the pulls and new balance. */
	openCardPack: (): Promise<PackResult> =>
		apiFetch<PackResult>("/cards/packs/open", { method: "POST" }),

	/** Fetch the Fortune Wheel layout, odds, bounds, balance and free-spin state. */
	getWheel: (): Promise<WheelView> => apiFetch<WheelView>("/casino/wheel"),

	/** Take the daily free spin. Optional client seed feeds the provable roll. */
	spinFreeWheel: (clientSeed?: string): Promise<SpinResult> =>
		apiFetch<SpinResult>("/casino/wheel/free", {
			method: "POST",
			body: JSON.stringify({ clientSeed }),
		}),

	/** Stake coins on a wagered spin. Returns the outcome and new balance. */
	spinWheel: (stake: number, clientSeed?: string): Promise<SpinResult> =>
		apiFetch<SpinResult>("/casino/wheel/spin", {
			method: "POST",
			body: JSON.stringify({ stake, clientSeed }),
		}),

	/** Fetch the Shell Flip layout, multiplier, bounds and balance. */
	getFlip: (): Promise<FlipConfig> => apiFetch<FlipConfig>("/casino/flip"),

	/** Call a shell side and stake coins. Returns the outcome and new balance. */
	flip: (
		stake: number,
		pick: FlipSide,
		clientSeed?: string,
	): Promise<SpinResolution> =>
		apiFetch<SpinResolution>("/casino/flip", {
			method: "POST",
			body: JSON.stringify({ stake, pick, clientSeed }),
		}),

	/** Fetch the Three-Shell Monte layout: risk tiers, RTP, bounds and balance. */
	getMonte: (): Promise<MonteConfig> => apiFetch<MonteConfig>("/casino/monte"),

	/** Guess a shell and stake coins. Returns the outcome and new balance. */
	monte: (
		stake: number,
		pick: number,
		shells?: number,
		clientSeed?: string,
	): Promise<SpinResolution> =>
		apiFetch<SpinResolution>("/casino/monte", {
			method: "POST",
			body: JSON.stringify({ stake, pick, shells, clientSeed }),
		}),

	/** Fetch the Shrine Slots reel, paytable, RTP, bounds and balance. */
	getSlots: (): Promise<SlotsView> => apiFetch<SlotsView>("/casino/slots"),

	/** Stake coins and spin the reels. Returns the outcome and new balance. */
	spinSlots: (stake: number, clientSeed?: string): Promise<SpinResolution> =>
		apiFetch<SpinResolution>("/casino/slots", {
			method: "POST",
			body: JSON.stringify({ stake, clientSeed }),
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

	getMyReplays: (): Promise<ReplaySummary[]> =>
		apiFetch<ReplaySummary[]>("/matches/replays/me"),

	getReplay: (matchId: string): Promise<ReplayDetail> =>
		apiFetch<ReplayDetail>(`/matches/${encodeURIComponent(matchId)}/replay`),

	saveReplay: (matchId: string): Promise<ReplaySummary> =>
		apiFetch<ReplaySummary>(`/matches/${encodeURIComponent(matchId)}/replay/save`, {
			method: "POST",
		}),

	unsaveReplay: (matchId: string): Promise<ReplaySummary> =>
		apiFetch<ReplaySummary>(`/matches/${encodeURIComponent(matchId)}/replay/save`, {
			method: "DELETE",
		}),
};
