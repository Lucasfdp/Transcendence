/**
 * gambling.types.ts — ports and result types for Gambling Integration (SPEC-016).
 *
 * The Tournament reuses ONLY the provably-fair primitives of the existing casino
 * (server seed committed, optional client seed, nonce → a verifiable roll); it
 * never touches `users.coins`, `wagers` or the CasinoEngine (SPEC-016 "Decisión
 * de integración"/"Restricciones"). The stake is charged against the Tournament
 * Economy (points), and the only reward is a Key Item via the Reward Resolver.
 *
 * Everything the module depends on is a narrow injected port, so it is
 * standalone-testable and never reaches into the casino or Economy internals.
 */

import { ActionContext } from "../actions/action.interface";
import { EconomyCommands } from "../actions/action.interface";
import { GrantRewardResult, Reward } from "../rewards/reward.types";

/** Economy subset Gambling drives (SPEC-016): charge the stake, read the balance. */
export type GamblingEconomyPort = Pick<EconomyCommands, "remove" | "getBalance">;

/** Grants the Key Item Reward on a win (satisfied by the Reward Resolver). */
export interface GamblingRewardGranter {
	grant(reward: Reward, context: ActionContext): GrantRewardResult;
}

/** Builds the ActionContext the winning bet's KeyItemReward is granted against. */
export type GamblingContextFactory = (input: {
	playerId: number;
	round: number;
}) => ActionContext;

/**
 * The Key Item gate Gambling consults before opening (SPEC-016 "Apertura": the
 * phase opens only while Key Items remain locked). Satisfied by the composition
 * over `TournamentKeyItems.hasLockedRemaining`.
 */
export interface GamblingKeyItemGate {
	hasLockedRemaining(): boolean;
}

/**
 * The provably-fair seam (SPEC-016 "Integración"): a per-bet secret server seed,
 * its committed hash, and the verifiable roll in [0, 1). The default
 * implementation IS the existing casino's `casino.fair` primitives (imported,
 * not duplicated — architect-approved, SPEC-016 "Restricciones"); tests inject a
 * deterministic stub. Seeds are generated PER BET and are NOT derived from the
 * tournament seed, so the outcome is outside the determinism layer (SPEC-000).
 */
export interface GamblingFairness {
	serverSeed(): string;
	commit(serverSeed: string): string;
	roll(serverSeed: string, clientSeed: string, nonce: number): number;
}

/** Result of opening the Gambling phase (SPEC-016 "Apertura"). */
export type GamblingOpenResult =
	| { readonly status: "opened"; readonly canAfford: boolean }
	| { readonly status: "ignored"; readonly reason: "session_in_progress" }
	| { readonly status: "skipped"; readonly reason: "no_locked_key_items" };

/** Result of a bet request (SPEC-016 "Flujo"). */
export type GamblingBetResult =
	| { readonly status: "won" }
	| { readonly status: "lost" }
	| {
			readonly status: "rejected";
			readonly reason: "no_session" | "not_winner" | "insufficient_points" | "error";
	  };

/** JSON-safe snapshot of the Gambling phase (SPEC-016). */
export interface GamblingSnapshot {
	readonly tournamentId: string;
	readonly session: {
		readonly winnerId: number;
		readonly cost: number;
		readonly winChance: number;
		readonly deadlineAt: number;
	} | null;
	/** Per-player bet nonce (the provably-fair sequence counter). */
	readonly nonces: Readonly<Record<number, number>>;
}
