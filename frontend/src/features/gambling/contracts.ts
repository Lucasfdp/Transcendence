/**
 * features/gambling/contracts.ts — Gambling domain contracts.
 *
 * Moved from features/hub/api.ts. `gambling` is the frontend domain name
 * only — the backend continues to expose `/casino/*` routes and the backend
 * `casino` module name is unchanged.
 */

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

/** Which gambling-den game a spin belongs to. Was `CasinoGame` in features/hub/api.ts. */
export type GamblingGame = "wheel" | "flip" | "monte" | "slots" | "dice" | "drop";

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
	game: GamblingGame;
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
