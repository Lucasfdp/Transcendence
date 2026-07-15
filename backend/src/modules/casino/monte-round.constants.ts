import type { SpinFairness } from "./casino.constants";

/** Number of cups in the classic Three-Shell Monte layout. */
export const MONTE_CUP_COUNT = 3;

/** Pending Monte rounds are settled as losses after this window. */
export const MONTE_ROUND_TTL_MS = 5 * 60 * 1000;

/**
 * How often the background sweeper settles abandoned rounds proactively, rather
 * than waiting for the owner to next start/resume. Well under the TTL so a
 * forfeited stake is booked within about a minute of expiring.
 */
export const MONTE_SWEEP_INTERVAL_MS = 60 * 1000;

/** Number of visible swaps in a shuffle. */
export const MONTE_SHUFFLE_STEPS = 8;

/** Ball shown under a cup before the cups come down (client + server agree). */
export const MONTE_PREVIEW_MS = 1200;

/** Cups-down beat between the preview and the first swap. */
export const MONTE_COVER_MS = 450;

/** Swap easing bounds — a slow first swap accelerating to a fast last one. */
export const MONTE_FIRST_SWAP_MS = 1000;
export const MONTE_FASTEST_SWAP_MS = 250;

/**
 * Latency tolerance subtracted from the shuffle timeline when gating a resolve,
 * so an honest player on a slow connection is never rejected for being a few
 * hundred ms early. Small enough that it doesn't meaningfully help a bot.
 */
export const MONTE_RESOLVE_GRACE_MS = 500;

/** Round states persisted for recovery and audit. */
export type MonteRoundStatus = "pending" | "resolved" | "expired";

/** A single visible swap of two slot positions. */
export type MonteSwap = [number, number];

/**
 * A started round returned before the player chooses. Deliberately carries NO
 * winning information: the player is shown only the ball's START slot (as in
 * real monte) plus the shape/timeline of the shuffle. The swaps themselves are
 * streamed just-in-time via the steps endpoint, and the winning slot never
 * leaves the server until the round resolves.
 */
export interface MonteRoundStartResult {
	roundId: string;
	/** Opaque render keys for the three cups — reveal nothing about the ball. */
	cupIds: string[];
	/** Slot the ball starts under (public — the whole point of the preview). */
	ballStartSlot: number;
	/** How many swaps the shuffle has. */
	stepCount: number;
	/** Per-swap durations (ms) so the client animates on the server's timeline. */
	stepDurations: number[];
	/** Preview + cover lead-in before the first swap is due. */
	shuffleLeadMs: number;
	/** Total time the swaps take, for the client's own progress display. */
	totalShuffleMs: number;
	/** SHA-256 of the server seed — proves it was fixed before the round. */
	serverSeedHash: string;
	/** Commitment binding seed, nonce, start slot and winning slot. */
	commitHash: string;
	clientSeed: string;
	nonce: number;
	stake: number;
	expiresAt: string;
	coins: number;
}

/** Just-in-time delivery of the swaps that are due by now. */
export interface MonteRoundStepsResult {
	roundId: string;
	/** Swaps whose scheduled time has elapsed, in order from the start. */
	steps: { index: number; pair: MonteSwap }[];
	/** Total swaps in the round (so the client knows when it has them all). */
	stepCount: number;
	/** True once every swap is delivered AND the resolve gate has opened. */
	ready: boolean;
}

/** Resolved Monte round, revealing the full shuffle for verification. */
export interface MonteRoundResolveResult {
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
