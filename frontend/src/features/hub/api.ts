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
		if (attempt === 0 && TRANSIENT_HTTP_STATUSES.has(res.status)) {
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

interface ApiFetchOptions extends RequestInit {
	/**
	 * Vouches that this endpoint is idempotent/safe to repeat, so a single
	 * bounded retry on a transient 5xx (502/503/504) is allowed for non-GET
	 * methods too — the same treatment GET already gets (Bug Audit L1).
	 *
	 * Only set this for state-scoped mutations that no-op when already
	 * applied — see `acceptFriendRequest`, `declineOrCancelFriendRequest`,
	 * `removeFriend`, `blockUser`, and `markConversationReadRest` below.
	 * Do NOT set this for side-effecting actions like casino spins, chat
	 * sends, or match-result submission: a transient 5xx there can't be
	 * distinguished from "the backend already processed this and the
	 * response was lost in transit", so retrying risks double-spending
	 * coins or double-counting a match result.
	 */
	idempotent?: boolean;
}

async function apiFetch<T>(
	path: string,
	{ idempotent, ...options }: ApiFetchOptions = {},
): Promise<T> {
	const method = (options.method ?? "GET").toUpperCase();
	const baseHeaders: Record<string, string> = {
		"Content-Type": "application/json",
		...(options.headers as Record<string, string>),
	};
	// GET is always safe to retry; non-GET only retries when the caller has
	// explicitly opted in via `idempotent: true`.
	const retryableOnTransient = method === "GET" || idempotent === true;

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
		if (TRANSIENT_HTTP_STATUSES.has(res.status) && retryableOnTransient) {
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
		} else if (
			isCsrfFailure(res, message) &&
			method !== "GET" &&
			method !== "HEAD"
		) {
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
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}

async function apiUploadFile<T>(path: string, formData: FormData): Promise<T> {
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
	// Mirror apiFetch's empty-body guard (Bug Audit L2): works today because
	// avatar upload always returns JSON, but any future empty-body upload
	// response (e.g. a 204) would otherwise throw a JSON parse error here.
	if (res.status === 204) return {} as T;
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
	trailEffect: string;
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
export type CardFamily = "power_shell" | "shrine" | "shell_skin" | "character";

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
	/** Always ≤ foilCount — prismatic is a rarer state layered on foil, gold-only. */
	prismaticCount: number;
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
	packTiers: PackTierView[];
}

/** Stable identifiers for the purchasable pack tiers, cheapest to priciest. */
export type PackTierId = "basic" | "deluxe" | "legendary";

/**
 * One purchasable pack tier, fully transparent: price, rarity odds (mirrors
 * the backend's own display copy — sums to 1), foil chance, and an optional
 * guaranteed minimum rarity for one slot in the pack.
 */
export interface PackTierView {
	id: PackTierId;
	name: string;
	priceCoins: number;
	rarityOdds: Record<CardRarity, number>;
	foilChance: number;
	guaranteedMinRarity?: CardRarity;
}

export interface PackPull {
	card: Omit<CardView, "owned" | "count" | "foilCount" | "prismaticCount">;
	foil: boolean;
	/** Always implies `foil: true`. */
	prismatic: boolean;
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
export type CasinoGame = "wheel" | "flip" | "monte" | "slots" | "dice" | "drop";

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
	/** A round already in progress (stake debited, not resolved) — for resume. */
	activeRound?: MonteRoundStart | null;
}

/** A single visible swap of two slot positions. */
export type MonteSwap = [number, number];

/**
 * A started round. Carries the ball's START slot (shown in the preview) and the
 * shape/timeline of the shuffle — but never the winning slot or the swaps
 * themselves, which are streamed just-in-time and recomputed server-side.
 */
export interface MonteRoundStart {
	roundId: string;
	cupIds: string[];
	ballStartSlot: number;
	stepCount: number;
	stepDurations: number[];
	shuffleLeadMs: number;
	totalShuffleMs: number;
	serverSeedHash: string;
	commitHash: string;
	clientSeed: string;
	nonce: number;
	stake: number;
	expiresAt: string;
	coins: number;
}

/** Just-in-time swap delivery while the shuffle animates. */
export interface MonteRoundSteps {
	roundId: string;
	steps: { index: number; pair: MonteSwap }[];
	stepCount: number;
	ready: boolean;
}

export interface MonteRoundResolution {
	roundId: string;
	game: "monte";
	mode: "wagered";
	cupIds: string[];
	ballStartSlot: number;
	winningSlot: number;
	selectedSlot: number;
	shuffle: MonteSwap[];
	won: boolean;
	multiplier: number;
	stake: number;
	paid: number;
	payout: number;
	net: number;
	coins: number;
	fairness: SpinFairness & {
		commitHash: string;
	};
}

// ── Koi Dice ─────────────────────────────────────────────────────────────────

/** A called betting direction. */
export type DiceDirection = "under" | "over";

/** Koi Dice layout: range, per-direction target bounds, wager bounds and balance. */
export interface DiceConfig {
	range: number;
	minTargetUnder: number;
	maxTargetUnder: number;
	minTargetOver: number;
	maxTargetOver: number;
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

// ── Shell Drop (Plinko) ──────────────────────────────────────────────────────

/** One bucket of a Shell Drop board with its odds and payout. */
export interface PlinkoBucketView {
	/** Bucket index — count of right moves (0..rows). */
	index: number;
	/** Net-neutral payout multiplier (< 1 in the centre, > 1 at the edges). */
	multiplier: number;
	/** Probability of landing here. */
	probability: number;
}

/** One row-count's full paytable. */
export interface PlinkoTierView {
	rows: number;
	buckets: PlinkoBucketView[];
	/** Weighted-average return-to-player for this tier (1.0 = net-neutral). */
	rtp: number;
}

/** Shell Drop layout: row tiers, paytables, wager bounds and balance. */
export interface PlinkoView {
	rowOptions: number[];
	defaultRows: number;
	tiers: PlinkoTierView[];
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
	type:
		| "shell_skin"
		| "hub_background"
		| "hub_background_alter"
		| "trail_effect"
		| "dojo_tag";
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

/** Coarse presence state for a player. Mirrors the backend PresenceStatus. */
export type PresenceStatus = "offline" | "online" | "in-game";

export interface FriendView {
	userId: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	avatar: string | null;
	level: number;
	/** True when status is anything other than "offline". */
	isOnline: boolean;
	status: PresenceStatus;
	/** The game the friend is currently playing, or null. */
	gameId: string | null;
	/** ISO timestamp of when the friend was last online, or null if unknown. */
	lastSeenAt: string | null;
	requesterId: number;
}

/** Mirrors the backend ReportCategory union. */
export type ReportCategory =
	| "harassment"
	| "cheating"
	| "inappropriate_name"
	| "spam"
	| "other";

export const REPORT_CATEGORIES: { id: ReportCategory; label: string }[] = [
	{ id: "harassment", label: "Harassment" },
	{ id: "cheating", label: "Cheating" },
	{ id: "inappropriate_name", label: "Inappropriate name" },
	{ id: "spam", label: "Spam" },
	{ id: "other", label: "Other" },
];

export interface PendingView {
	userId: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	avatar: string | null;
	level: number;
	isOnline: boolean;
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export type ConversationType = "dm" | "group";

export interface ConversationSummaryView {
	id: number;
	type: ConversationType;
	/** Group name, or the other participant's username for a dm. */
	name: string | null;
	/** The other participant's id, for a dm. Null for groups. */
	otherUserId: number | null;
	/** The other participant's avatar, for a dm. Null for groups. */
	avatar: string | null;
	/** Group owner's user id — null for dms / owner-deleted groups. Gates owner-only controls (Decision 1). */
	ownerId: number | null;
	lastMessageAt: string | null;
	lastMessagePreview: string | null;
}

/** A single group member, from GET /chat/conversations/:id/members (Decision 2). */
export interface GroupMemberView {
	userId: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	avatar: string | null;
	level: number;
	isOnline: boolean;
	joinedAt: string;
	isOwner: boolean;
}

export type ChatMessageType = "text" | "system" | "gif" | "game_invite";

export interface ChatMessageView {
	id: number;
	conversationId: number;
	senderId: number;
	senderUsername: string;
	type: ChatMessageType;
	body: string;
	metadata: Record<string, unknown> | null;
	createdAt: string;
}

/** A single Klipy gif search result, from GET /chat/gifs/search. */
export interface GifSearchResult {
	slug: string;
	title: string;
	url: string;
	previewUrl: string;
	width: number;
	height: number;
}

/** A conversation with unread messages — hydrated via GET /chat/unread and pushed live over the socket. */
export interface UnreadConversationView {
	conversationId: number;
	type: ConversationType;
	/** Group name, or the sender's username for a dm. */
	title: string;
	preview: string | null;
	lastMessageAt: string;
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

export type ReplayContractVersion = 2;

export interface ReplayVisualPlayer {
	side: number;
	userId: number | null;
	username: string;
	turtleName?: string | null;
	shellSkin?: string;
	trailEffect?: string;
	hubBackground?: string;
	hubBackgroundAlter?: string | null;
}

export interface ReplaySnapshotEntity {
	id: number | string;
	type: "projectile" | "ball" | string;
	side?: number;
	ownerSide?: number;
	x: number;
	y: number;
	vx?: number;
	vy?: number;
	rotation?: number;
	angularVelocity?: number;
	r?: number;
	power?: string;
	scale?: number;
	stateFlags?: string[];
	visible?: boolean;
	alpha?: number;
	spriteKey?: string;
	trail?: Array<{ x: number; y: number }>;
}

export interface ReplayFrameSnapshot {
	gameId?: string;
	seq?: number;
	phase?: string;
	players?: ReplayVisualPlayer[];
	score?: number[];
	scores?: number[];
	currentTurn?: number;
	activeBallId?: number | string | null;
	activeBallIdBySide?: Array<number | string | null>;
	entities?: ReplaySnapshotEntity[];
	balls?: ReplaySnapshotEntity[];
	objects?: ReplaySnapshotEntity[];
	powerups?: Array<Record<string, unknown>>;
	powerPickups?: Array<Record<string, unknown>>;
	winnerSide?: number | null;
	[key: string]: unknown;
}

export interface ReplayFrame {
	seq: number;
	tMs: number;
	round: number;
	state: "pending" | "active" | "finished" | "abandoned";
	type: "keyframe" | "delta";
	changes: Record<string, unknown>;
	removals: string[];
	/** Reconstructed by ReplayController; never persisted in contract v2. */
	snapshot?: ReplayFrameSnapshot;
}

export interface ReplayEvent {
	seq: number;
	tMs: number;
	round: number;
	type: string;
	payload: Record<string, unknown>;
}

export interface ReplayMetadataV2 {
	contractVersion: 2;
	origin: "local" | "online";
	gameId: string;
	mode: string;
	participants: ReplayVisualPlayer[];
	durationMs: number;
	sampleHz: 20;
	keyframeIntervalMs: 1000;
	preRollMs: number;
	statistics: Record<string, unknown>;
	powerupsEnabled: false;
}

export interface ReplaySummary {
	id: string;
	matchId: string;
	replayVersion: ReplayContractVersion;
	contractVersion: ReplayContractVersion;
	metadata: ReplayMetadataV2;
	durationMs: number;
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
	events: ReplayEvent[];
}

export interface ReplayImportRequest {
	gameId: string;
	mode: string;
	status: "finished" | "abandoned";
	createdAt?: string;
	finishedAt?: string | null;
	winnerSide?: number | null;
	metadata: ReplayMetadataV2;
	durationMs: number;
	frames: ReplayFrame[];
	events?: ReplayEvent[];
}

export type LeaderboardScope = "global" | "friends";

// ── Notifications ─────────────────────────────────────────────────────────────

/**
 * These are the only persisted, inbox-visible notification types — mirrors
 * the backend NotificationType. A friend removal is delivered separately as
 * a live-only `friend:removed` WS event on the game socket and deliberately
 * never appears here or in GET /notifications: see the backend entity doc
 * for why that event has no persisted/bell form.
 */
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

	/** Spend coins to open one card pack of the given tier. Returns the pulls and new balance. */
	openCardPack: (tierId: PackTierId): Promise<PackResult> =>
		apiFetch<PackResult>("/cards/packs/open", {
			method: "POST",
			body: JSON.stringify({ tierId }),
		}),

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
	getMonte: (): Promise<MonteConfig> =>
		apiFetch<MonteConfig>("/casino/monte"),

	/** Start a committed Three-Shell Monte round. */
	startMonteRound: (
		stake: number,
		clientSeed?: string,
	): Promise<MonteRoundStart> =>
		apiFetch<MonteRoundStart>("/casino/monte/rounds", {
			method: "POST",
			body: JSON.stringify({ stake, clientSeed }),
		}),

	/** Poll the just-in-time swaps for an in-flight round. */
	getMonteSteps: (roundId: string): Promise<MonteRoundSteps> =>
		apiFetch<MonteRoundSteps>(
			`/casino/monte/rounds/${encodeURIComponent(roundId)}/steps`,
		),

	/** Resolve a committed Three-Shell Monte round with the chosen slot. */
	resolveMonteRound: (
		roundId: string,
		selectedSlot: number,
	): Promise<MonteRoundResolution> =>
		apiFetch<MonteRoundResolution>(
			`/casino/monte/rounds/${encodeURIComponent(roundId)}/resolve`,
			{
				method: "POST",
				body: JSON.stringify({ selectedSlot }),
			},
		),

	/** Fetch the Shrine Slots reel, paytable, RTP, bounds and balance. */
	getSlots: (): Promise<SlotsView> => apiFetch<SlotsView>("/casino/slots"),

	/** Stake coins and spin the reels. Returns the outcome and new balance. */
	spinSlots: (stake: number, clientSeed?: string): Promise<SpinResolution> =>
		apiFetch<SpinResolution>("/casino/slots", {
			method: "POST",
			body: JSON.stringify({ stake, clientSeed }),
		}),

	/** Fetch the Koi Dice layout: range, target bounds, wager bounds and balance. */
	getDice: (): Promise<DiceConfig> => apiFetch<DiceConfig>("/casino/dice"),

	/** Bet a direction/target and stake coins. Returns the outcome and new balance. */
	dice: (
		stake: number,
		direction: DiceDirection,
		target: number,
		clientSeed?: string,
	): Promise<SpinResolution> =>
		apiFetch<SpinResolution>("/casino/dice", {
			method: "POST",
			body: JSON.stringify({ stake, direction, target, clientSeed }),
		}),

	/** Fetch the Shell Drop layout: row tiers, paytables, bounds and balance. */
	getPlinko: (): Promise<PlinkoView> =>
		apiFetch<PlinkoView>("/casino/plinko"),

	/** Pick a risk tier and stake coins. Returns the outcome and new balance. */
	dropPlinko: (
		stake: number,
		rows?: number,
		clientSeed?: string,
	): Promise<SpinResolution> =>
		apiFetch<SpinResolution>("/casino/plinko", {
			method: "POST",
			body: JSON.stringify({ stake, rows, clientSeed }),
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

	/** Return outgoing pending friend requests sent by the current user. */
	getOutgoingRequests: (): Promise<PendingView[]> =>
		apiFetch<PendingView[]>("/friends/outgoing"),

	/** "People you may know" — friends-of-friends suggestions. */
	getFriendSuggestions: (): Promise<PendingView[]> =>
		apiFetch<PendingView[]>("/friends/suggestions"),

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
			// Scoped to status="pending" server-side (see AcceptRequest) — a
			// retry after a real success just finds no pending row and 404s,
			// rather than double-accepting or double-notifying.
			idempotent: true,
		}),

	/** Remove an established (accepted) friend. Use declineOrCancelFriendRequest for pending requests. */
	removeFriend: (userId: number): Promise<void> =>
		apiFetch<void>(`/friends/${userId}`, {
			method: "DELETE",
			// Delete scoped to status="accepted" — repeating it is a no-op.
			idempotent: true,
		}),

	/**
	 * Decline an incoming pending request, or cancel your own outgoing one.
	 * Idempotent server-side — safe to call even if the request was already
	 * resolved from another surface (e.g. accepted via the notification drawer
	 * while this was still showing as pending in the social tab).
	 */
	declineOrCancelFriendRequest: (userId: number): Promise<void> =>
		apiFetch<void>("/friends/decline", {
			method: "POST",
			body: JSON.stringify({ userId }),
			idempotent: true,
		}),

	/** Block a user by userId. */
	blockUser: (userId: number): Promise<void> =>
		apiFetch<void>("/friends/block", {
			method: "POST",
			body: JSON.stringify({ userId }),
			// Delete-then-insert to the same "blocked" end state — repeating
			// it lands in the same place (Bug Audit M5 made this atomic too).
			idempotent: true,
		}),

	/** List users the current user has blocked (Bug Audit H3). */
	getBlockedUsers: (): Promise<PendingView[]> =>
		apiFetch<PendingView[]>("/friends/blocked"),

	/** Unblock a user by userId. Removes only the caller's own block row. */
	unblockUser: (userId: number): Promise<void> =>
		apiFetch<void>("/friends/unblock", {
			method: "POST",
			body: JSON.stringify({ userId }),
			// Deletes the caller's block row — repeating it is a no-op.
			idempotent: true,
		}),

	// ── Notifications ────────────────────────────────────────────────────────

	/**
	 * Full unread notification inbox. Source of truth for hydrating the bell
	 * on mount (Bug Audit H1) — the game socket's `notification:inbox` /
	 * `notification:new` events remain the live accelerator on top of this
	 * while a tab stays open.
	 */
	getNotifications: (): Promise<NotificationView[]> =>
		apiFetch<NotificationView[]>("/notifications"),

	/**
	 * Mark one notification as read over REST. The live path is the
	 * `notification:read` socket event — this is a fallback for when the
	 * socket is unavailable, mirroring markConversationReadRest for chat.
	 */
	markNotificationReadRest: (notificationId: number): Promise<void> =>
		apiFetch<void>(`/notifications/${notificationId}/read`, {
			method: "POST",
			// Scoped to readAt IS NULL server-side — repeating it is a no-op.
			idempotent: true,
		}),

	/** Mark every unread notification as read over REST. */
	markAllNotificationsReadRest: (): Promise<void> =>
		apiFetch<void>("/notifications/read-all", {
			method: "POST",
			idempotent: true,
		}),

	// ── Chat ───────────────────────────────────────────────────────────────────

	/** List every conversation the current user belongs to, most recent first. */
	getConversations: (): Promise<ConversationSummaryView[]> =>
		apiFetch<ConversationSummaryView[]>("/chat/conversations"),

	/**
	 * The current unread-conversation digest over REST. Mirrors
	 * getNotifications: the `chat:unread-inbox` socket push only fires at
	 * connect time, so a freshly-mounted HomePage hydrates its unread set from
	 * here rather than waiting for the next live message (Bug B1). WS events
	 * remain the live accelerator while the tab stays open.
	 */
	getUnreadConversations: (): Promise<UnreadConversationView[]> =>
		apiFetch<UnreadConversationView[]>("/chat/unread"),

	/** Get or create a dm with a friend. Rejects if the two are not friends. */
	startDirectMessage: (userId: number): Promise<{ id: number }> =>
		apiFetch<{ id: number }>("/chat/conversations/direct", {
			method: "POST",
			body: JSON.stringify({ userId }),
		}),

	/** Create a group. Every member must be a friend of the creator. */
	createGroupChat: (
		name: string,
		memberUserIds: number[],
	): Promise<{ id: number }> =>
		apiFetch<{ id: number }>("/chat/conversations/group", {
			method: "POST",
			body: JSON.stringify({ name, memberUserIds }),
		}),

	/**
	 * Paginated message history for a conversation, newest first. Pass
	 * `beforeId` (the oldest message id seen so far) to load the previous
	 * page. An id cursor, not a timestamp, so pages can't skip messages that
	 * share a millisecond (Bug B6).
	 */
	getChatMessages: (
		conversationId: number,
		beforeId?: number,
	): Promise<ChatMessageView[]> =>
		apiFetch<ChatMessageView[]>(
			`/chat/conversations/${conversationId}/messages${beforeId !== undefined ? `?beforeId=${beforeId}` : ""}`,
		),

	/**
	 * Send a message over REST. The live path is the `chat:send` socket
	 * event (see gameSocket) — this is a fallback for when the socket is
	 * unavailable.
	 */
	sendChatMessageRest: (
		conversationId: number,
		body: string,
	): Promise<ChatMessageView> =>
		apiFetch<ChatMessageView>(
			`/chat/conversations/${conversationId}/messages`,
			{
				method: "POST",
				body: JSON.stringify({ body }),
			},
		),

	/** Search gifs via the backend's Klipy proxy. An empty/blank query returns []. */
	searchGifs: (query: string): Promise<GifSearchResult[]> =>
		apiFetch<GifSearchResult[]>(
			`/chat/gifs/search?q=${encodeURIComponent(query)}`,
		),

	/**
	 * Send a gif message over REST. The live path is the `chat:send-gif`
	 * socket event (see gameSocket) — this is a fallback, mirroring
	 * sendChatMessageRest for text.
	 */
	sendGifMessageRest: (
		conversationId: number,
		slug: string,
	): Promise<ChatMessageView> =>
		apiFetch<ChatMessageView>(
			`/chat/conversations/${conversationId}/messages/gif`,
			{
				method: "POST",
				body: JSON.stringify({ slug }),
			},
		),

	/** List a group's members (participant-only). Backs the member-list UI (Decision 2). */
	getGroupMembers: (conversationId: number): Promise<GroupMemberView[]> =>
		apiFetch<GroupMemberView[]>(
			`/chat/conversations/${conversationId}/members`,
		),

	/** Add a friend to an existing group. Caller must be a participant and a friend of userId. */
	addGroupMember: (conversationId: number, userId: number): Promise<void> =>
		apiFetch<void>(`/chat/conversations/${conversationId}/members`, {
			method: "POST",
			body: JSON.stringify({ userId }),
		}),

	/** Owner-only: remove a member from a group (Decision 1). */
	kickGroupMember: (conversationId: number, userId: number): Promise<void> =>
		apiFetch<void>(
			`/chat/conversations/${conversationId}/members/${userId}`,
			{
				method: "DELETE",
			},
		),

	/** Owner-only: rename a group (Decision 1). */
	renameGroupChat: (conversationId: number, name: string): Promise<void> =>
		apiFetch<void>(`/chat/conversations/${conversationId}`, {
			method: "PATCH",
			body: JSON.stringify({ name }),
		}),

	/** Owner-only: delete a group and all its messages (Decision 1). */
	deleteGroupChat: (conversationId: number): Promise<void> =>
		apiFetch<void>(`/chat/conversations/${conversationId}`, {
			method: "DELETE",
		}),

	/** Leave a group. Members leave themselves; the owner kicks via kickGroupMember. */
	leaveGroupChat: (conversationId: number): Promise<void> =>
		apiFetch<void>(`/chat/conversations/${conversationId}/leave`, {
			method: "POST",
		}),

	/**
	 * Mark a conversation read over REST. The live path is the `chat:read`
	 * socket event — this is a fallback for when the socket is unavailable.
	 */
	markConversationReadRest: (conversationId: number): Promise<void> =>
		apiFetch<void>(`/chat/conversations/${conversationId}/read`, {
			method: "POST",
			// Sets lastReadAt to "now" — repeating it is harmless.
			idempotent: true,
		}),

	// ── Reports ────────────────────────────────────────────────────────────────

	/** Report a user by userId. Auto-blocks the reported user server-side. */
	reportUser: (
		reportedId: number,
		category: ReportCategory,
		message?: string,
	): Promise<void> =>
		apiFetch<void>("/reports", {
			method: "POST",
			body: JSON.stringify({ reportedId, category, message }),
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
		apiFetch<OverallLeaderboardEntry[]>(
			`/leaderboard/overall?scope=${scope}`,
		),

	getMyReplays: (): Promise<ReplaySummary[]> =>
		apiFetch<ReplaySummary[]>("/matches/replays/me"),

	getReplay: (matchId: string): Promise<ReplayDetail> =>
		apiFetch<ReplayDetail>(
			`/matches/${encodeURIComponent(matchId)}/replay`,
		),

	importReplay: (payload: ReplayImportRequest): Promise<ReplaySummary> =>
		apiFetch<ReplaySummary>("/matches/replays/import", {
			method: "POST",
			body: JSON.stringify(payload),
		}),

	saveReplay: (matchId: string): Promise<ReplaySummary> =>
		apiFetch<ReplaySummary>(
			`/matches/${encodeURIComponent(matchId)}/replay/save`,
			{
				method: "POST",
			},
		),

	unsaveReplay: (matchId: string): Promise<ReplaySummary> =>
		apiFetch<ReplaySummary>(
			`/matches/${encodeURIComponent(matchId)}/replay/save`,
			{
				method: "DELETE",
			},
		),
};
