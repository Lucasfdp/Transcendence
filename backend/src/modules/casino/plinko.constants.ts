/**
 * Shell Drop (Plinko) — catalogue & economy constants.
 *
 * A shell falls through `rows` rows of pegs; at each row a roll sends it left
 * or right. It lands in one of `rows + 1` buckets, indexed by how many times
 * it went right. The bucket distribution is binomial — centre buckets are far
 * more likely than edge buckets — so the payout multipliers are shaped to pay
 * less than the stake in the centre and far more at the edges.
 *
 * Economy design: for a chosen row-count R, give each bucket k a symmetric
 * U-shaped *shape weight* `w_k = PLINKO_RISK_BASE ^ |k - R/2|` (edges weigh
 * more) and normalise it against the binomial bucket probability:
 *   Z = Σ_k p_k · w_k
 *   M_k = w_k / Z
 * so that `Σ_k p_k · M_k = Σ_k p_k · w_k / Z = Z / Z = 1.0` exactly, for any
 * row-count and any base — net-neutral by construction, no tuning needed. No
 * bucket pays zero (every `w_k > 0`); variance comes from centre-vs-edge, not
 * from a chance of losing everything. The shared engine moves the coins; this
 * module owns only the binomial maths and the multiplier derivation.
 */

/** Risk tiers: how many peg rows the shell falls through. */
export const PLINKO_ROWS_OPTIONS = [8, 12, 16, 20] as const;

/** A selectable row-count (risk tier). */
export type PlinkoRows = (typeof PLINKO_ROWS_OPTIONS)[number];

/** Default row-count when the player does not pick a risk tier. */
export const DEFAULT_ROWS: PlinkoRows = 8;

/**
 * Base of the symmetric U-shaped shape weight used to derive bucket
 * multipliers. Must be > 1 so edge buckets (rarer, by the binomial
 * distribution) weigh — and therefore pay — more than centre buckets.
 */
export const PLINKO_RISK_BASE = 1.6;

/** Rolls strictly below this send the shell left; the rest send it right. */
const RIGHT_THRESHOLD = 0.5;

/**
 * Binomial coefficient C(n, k), computed iteratively (no factorials) to avoid
 * overflow. Returns 0 outside the valid `0 <= k <= n` range.
 */
export function binomial(n: number, k: number): number {
	if (k < 0 || k > n) return 0;
	let result = 1;
	for (let i = 0; i < k; i++) {
		result = (result * (n - i)) / (i + 1);
	}
	return Math.round(result);
}

/** Probability of landing in bucket `k` of `rows` rows: C(rows,k) / 2^rows. */
export function bucketProbability(rows: number, k: number): number {
	return binomial(rows, k) / 2 ** rows;
}

/**
 * Map a set of per-row rolls in [0, 1) to the bucket index: the count of
 * rolls that sent the shell right (>= {@link RIGHT_THRESHOLD}).
 */
export function bucketIndexFromRolls(rolls: readonly number[]): number {
	return rolls.filter((roll) => roll >= RIGHT_THRESHOLD).length;
}

/**
 * The net-neutral multiplier for every bucket of a `rows`-row board, derived
 * by normalising the symmetric shape weight against the binomial bucket
 * probability (see the module doc). Computed once per call; `rows` is at most
 * 20 so this is cheap.
 */
function bucketMultipliers(rows: number): number[] {
	const weights: number[] = [];
	for (let k = 0; k <= rows; k++) {
		weights.push(PLINKO_RISK_BASE ** Math.abs(k - rows / 2));
	}
	const normaliser = weights.reduce(
		(sum, weight, k) => sum + bucketProbability(rows, k) * weight,
		0,
	);
	return weights.map((weight) => weight / normaliser);
}

/** Net-neutral payout multiplier for bucket `k` of a `rows`-row board. */
export function bucketMultiplier(rows: number, k: number): number {
	return bucketMultipliers(rows)[k];
}

/**
 * Evaluate a drop's per-row rolls. `outcomeId` is the bucket id (e.g.
 * "bucket-4"); the multiplier is that bucket's net-neutral payout.
 */
export function evaluateDrop(
	rows: number,
	rolls: readonly number[],
): { outcomeId: string; multiplier: number } {
	const bucket = bucketIndexFromRolls(rolls);
	return {
		outcomeId: `bucket-${bucket}`,
		multiplier: bucketMultiplier(rows, bucket),
	};
}

/**
 * Weighted-average return-to-player for a `rows`-row board, computed by
 * enumerating every bucket. Equals 1.0 by construction; the spec asserts it
 * rather than trusting the derivation.
 */
export function plinkoRtp(rows: number): number {
	let rtp = 0;
	for (let k = 0; k <= rows; k++) {
		rtp += bucketProbability(rows, k) * bucketMultiplier(rows, k);
	}
	return rtp;
}

/** A single bucket enriched with its public probability and payout. */
export interface PlinkoBucketView {
	/** Bucket index — count of right moves (0..rows). */
	index: number;
	/** Net-neutral payout multiplier (< 1 in the centre, > 1 at the edges). */
	multiplier: number;
	/** Probability of landing here = C(rows,index) / 2^rows. */
	probability: number;
}

/** One row-count's full paytable. */
export interface PlinkoTierView {
	rows: number;
	buckets: PlinkoBucketView[];
	/** Weighted-average return-to-player for this tier (1.0 = net-neutral). */
	rtp: number;
}

/** Every bucket of a `rows`-row board with its probability and payout. */
export function plinkoTierView(rows: number): PlinkoTierView {
	const buckets: PlinkoBucketView[] = [];
	for (let k = 0; k <= rows; k++) {
		buckets.push({
			index: k,
			multiplier: bucketMultiplier(rows, k),
			probability: bucketProbability(rows, k),
		});
	}
	return { rows, buckets, rtp: plinkoRtp(rows) };
}

/** Everything the frontend needs to render Shell Drop and its paytables. */
export interface PlinkoView {
	/** Selectable row-counts (risk tiers). */
	rowOptions: number[];
	/** Default row-count. */
	defaultRows: number;
	/** Full paytable per selectable row-count. */
	tiers: PlinkoTierView[];
	/** Accepted wager bounds (shared with the wheel). */
	minWager: number;
	maxWager: number;
	/** The requesting player's current coin balance. */
	coins: number;
}
