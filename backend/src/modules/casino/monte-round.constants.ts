import type { SpinFairness } from "./casino.constants";

/** Number of cups in the classic Three-Shell Monte layout. */
export const MONTE_CUP_COUNT = 3;

/** Pending Monte rounds are settled as losses after this window. */
export const MONTE_ROUND_TTL_MS = 5 * 60 * 1000;

/** Round states persisted for recovery and audit. */
export type MonteRoundStatus = "pending" | "resolved" | "expired";

/** A started round returned before the player chooses a cup. */
export interface MonteRoundStartResult {
	roundId: string;
	cupIds: string[];
	ballCupId: string;
	serverSeedHash: string;
	winningCupHash: string;
	clientSeed: string;
	nonce: number;
	stake: number;
	expiresAt: string;
	coins: number;
}

/** Resolved Monte round, including revealed fairness data. */
export interface MonteRoundResolveResult {
	roundId: string;
	game: "monte";
	mode: "wagered";
	cupIds: string[];
	ballCupId: string;
	selectedCupId: string;
	won: boolean;
	multiplier: number;
	stake: number;
	paid: number;
	payout: number;
	net: number;
	coins: number;
	fairness: SpinFairness & {
		winningCupHash: string;
	};
}
