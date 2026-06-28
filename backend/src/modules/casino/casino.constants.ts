/**
 * Fortune Wheel — catalog & economy constants.
 *
 * The wheel is the first attraction in the dojo's back-alley gambling den.
 * Players spend the same `coins` they earn from matches; nothing here grants a
 * gameplay advantage (coins only ever buy cosmetics — see cards.constants.ts).
 *
 * All randomness happens server-side. This module owns the wheel layout and the
 * pure functions that map a roll in [0, 1) to a segment, so the payout maths is
 * auditable in one place and unit-tested independently of the spin service.
 *
 * Economy design: the wagered wheel is tuned to be NET-NEUTRAL — the
 * weighted-average multiplier equals exactly 1.0 (TARGET_RTP), so over time a
 * wager neither mints nor burns coins beyond variance. The daily free spin
 * (FREE_SPIN_STAKE_COINS) is the only intentional faucet.
 */

/** Source of randomness in [0, 1). Injectable so spins are testable. */
export type Rng = () => number;

/** How a spin was paid for: the daily faucet, or a staked wager. */
export type SpinMode = "free" | "wagered";

/**
 * Which attraction in the gambling den a wager belongs to. Stored on every
 * audit row so a single `wagers` table backs all games. "wheel" is the legacy
 * default for rows written before the discriminator existed.
 */
export type CasinoGame = "wheel" | "flip" | "monte" | "slots";

/** One wedge on the Fortune Wheel. */
export interface WheelSegment {
	/** Stable id stored on the Wager audit row, e.g. "x2". */
	id: string;
	/** Human-facing label shown on the wedge. */
	label: string;
	/** Payout multiplier applied to the stake (0 = lose the stake). */
	multiplier: number;
	/**
	 * Relative selection weight (integer). A segment's probability is
	 * `weight / totalWeight()`. Weights — not probabilities — are stored so the
	 * layout stays exact integers with no floating-point drift.
	 */
	weight: number;
}

/**
 * Target return-to-player. 1.0 = net-neutral: the house takes no edge, so the
 * wheel only ever redistributes coins via variance. Asserted against the
 * computed {@link wheelRtp} in casino.constants.spec.ts.
 */
export const TARGET_RTP = 1;

/**
 * The wheel layout. Weights sum to 790 and are tuned so the weighted-average
 * multiplier is exactly 1.0 (see the RTP test). Ordered worst → best so the
 * frontend can lay wedges out predictably.
 *
 *   multiplier × weight contributions:
 *     0.0×150 + 0.5×200 + 1.0×200 + 1.5×120 + 2.0×80 + 3.0×30 + 5.0×8 + 10.0×2
 *   = 0 + 100 + 200 + 180 + 160 + 90 + 40 + 20 = 790  ( = totalWeight → RTP 1.0 )
 */
export const WHEEL_SEGMENTS: readonly WheelSegment[] = [
	{ id: "bust", label: "Bust", multiplier: 0, weight: 150 },
	{ id: "half", label: "½×", multiplier: 0.5, weight: 200 },
	{ id: "push", label: "1×", multiplier: 1, weight: 200 },
	{ id: "x1_5", label: "1.5×", multiplier: 1.5, weight: 120 },
	{ id: "x2", label: "2×", multiplier: 2, weight: 80 },
	{ id: "x3", label: "3×", multiplier: 3, weight: 30 },
	{ id: "x5", label: "5×", multiplier: 5, weight: 8 },
	{ id: "jackpot", label: "10×", multiplier: 10, weight: 2 },
] as const;

/**
 * Coins the daily free spin wagers on the player's behalf. The player pays
 * nothing; payout = FREE_SPIN_STAKE_COINS × segment.multiplier. This is the
 * intentional coin faucet, separate from the net-neutral wagered wheel.
 */
export const FREE_SPIN_STAKE_COINS = 50;

/** Smallest coin stake accepted on a wagered spin. */
export const MIN_WAGER_COINS = 10;

/** Largest coin stake accepted on a wagered spin. */
export const MAX_WAGER_COINS = 1_000;

/** Sum of every segment weight — the denominator for segment probabilities. */
export function totalWeight(): number {
	return WHEEL_SEGMENTS.reduce((sum, segment) => sum + segment.weight, 0);
}

/**
 * Weighted-average payout multiplier across the wheel — the true return-to-player.
 * Equals {@link TARGET_RTP} by construction (verified in the spec).
 */
export function wheelRtp(): number {
	const weighted = WHEEL_SEGMENTS.reduce(
		(sum, segment) => sum + segment.multiplier * segment.weight,
		0,
	);
	return weighted / totalWeight();
}

/**
 * Map a roll in [0, 1) to a wheel segment by cumulative weight. Rolls outside
 * the range are clamped (negative → first segment, ≥ 1 → last segment) so a
 * caller can never fall through unassigned. The final return also guards
 * against floating-point drift at the top of the range.
 */
export function selectSegment(roll: number): WheelSegment {
	if (roll <= 0) return WHEEL_SEGMENTS[0];
	const target = roll * totalWeight();
	let cumulative = 0;
	for (const segment of WHEEL_SEGMENTS) {
		cumulative += segment.weight;
		if (target < cumulative) return segment;
	}
	return WHEEL_SEGMENTS[WHEEL_SEGMENTS.length - 1];
}

/** Draw one value from `rng` and resolve it to a wheel segment. */
export function rollSegment(rng: Rng): WheelSegment {
	return selectSegment(rng());
}

/** Verifiable provably-fair data returned with every resolved spin. */
export interface SpinFairness {
	/** The server seed, revealed so the player can recompute the roll. */
	serverSeed: string;
	/** SHA-256 of the server seed — proves it was fixed before the spin. */
	serverSeedHash: string;
	/** The client seed mixed into the roll (empty string if none). */
	clientSeed: string;
	/** Per-user counter used in the roll. */
	nonce: number;
	/** The first resolved roll in [0, 1) — equals `rolls[0]`. */
	roll: number;
	/**
	 * Every roll drawn for this spin. Single-roll games (wheel, flip, monte)
	 * expose `[roll]`; multi-roll games (slots) expose one entry per reel.
	 */
	rolls: number[];
}

/**
 * Generic outcome of a resolved spin, produced by the shared {@link
 * SpinResolution}-returning engine and shared by every game. `outcomeId` is the
 * stable id written to the audit row (e.g. "x2", "heads", "shell-1",
 * "bell|bell|bell").
 */
export interface SpinResolution {
	/** Which game produced this spin. */
	game: CasinoGame;
	mode: SpinMode;
	/** Stable id of the resolved outcome, stored on the audit row. */
	outcomeId: string;
	/** Payout multiplier applied to the stake (0 = lose the stake). */
	multiplier: number;
	/** Coins the payout scaled from (paid stake, or the free-spin stake). */
	stake: number;
	/** Coins actually debited (0 for a free spin). */
	paid: number;
	/** Coins credited = floor(stake × multiplier). */
	payout: number;
	/** Net coin change for the player = payout − paid. */
	net: number;
	/** The player's coin balance after the spin. */
	coins: number;
	fairness: SpinFairness;
}

/** A resolved Fortune Wheel spin: the generic resolution plus its segment. */
export interface SpinResult extends SpinResolution {
	/** The winning wheel segment (includes its public odds weight). */
	segment: WheelSegment;
}

/** Optional per-spin inputs (defaults are filled in by the service). */
export interface SpinOptions {
	/** Player-supplied client seed. Defaults to empty string. */
	clientSeed?: string;
	/** Server seed override — for tests. Defaults to a fresh random seed. */
	serverSeed?: string;
}

/** A wheel segment enriched with its public selection probability. */
export interface WheelSegmentView extends WheelSegment {
	/** Probability of landing on this segment = weight / totalWeight. */
	probability: number;
}

/** Everything the frontend needs to render the wheel and its odds. */
export interface WheelView {
	segments: WheelSegmentView[];
	/** Weighted-average return-to-player (1.0 = net-neutral). */
	rtp: number;
	/** Coins the daily free spin wagers on the player's behalf. */
	freeStake: number;
	/** Accepted wager bounds for a staked spin. */
	minWager: number;
	maxWager: number;
	/** The requesting player's current coin balance. */
	coins: number;
	/** Whether the player's daily free spin is still available. */
	freeSpinAvailable: boolean;
}

/** The wheel layout with each segment's probability — pure, no I/O. */
export function wheelSegmentViews(): WheelSegmentView[] {
	const total = totalWeight();
	return WHEEL_SEGMENTS.map((segment) => ({
		...segment,
		probability: segment.weight / total,
	}));
}
