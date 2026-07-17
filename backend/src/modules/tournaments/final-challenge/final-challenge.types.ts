/**
 * final-challenge.types.ts — data model + ports for the Final Challenge System
 * (SPEC-021).
 *
 * The Final Challenge is the LAST PHASE of a Tournament, not a combat (SPEC-021
 * "Filosofía"): it starts automatically after the Boss intro (the Boss is ONLY
 * the trigger — full decoupling), validates the victory condition, declares the
 * single winner, grants ¡¡THE PARROT'S SHELL!! through the Reward Resolver and
 * generates the final ranking. It never manages economy, inventories,
 * matchmaking or minigames itself (SPEC-021 "Restricciones") — the v1
 * sudden-death runs EXACTLY the SPEC-015 minigame pipeline through a narrow
 * port, and every interaction happens via Actions, Rules and Events.
 */

import { ActionConfig, ActionContext, ExecutionResult } from "../actions/action.interface";
import { RuleConfig } from "../rules/configured-rule";
import { GrantRewardResult, Reward } from "../rewards/reward.types";
import { MinigameRoundResult } from "../minigame/minigame.types";

/**
 * A configurable victory condition (SPEC-021 "Condiciones de victoria"). v1
 * ships ONLY `suddenDeath` (minigame sudden death); future variants (board
 * objective, sequence, special event) extend this union without touching the
 * system.
 */
export interface VictoryConditionConfig {
	readonly kind: "suddenDeath";
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Immutable Final Challenge definition (SPEC-021 "Definición"). Pure content. */
export interface FinalChallengeDefinition {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	/** Challenge-specific Rules activated on start (Boss Rules stay active too). */
	readonly rules: readonly RuleConfig[];
	/** Presentation Actions run on start (SPEC-021: interaction via Actions). */
	readonly actions: readonly ActionConfig[];
	/** How the winner is determined (SPEC-021: configurable; v1 sudden death). */
	readonly victoryConditions: readonly VictoryConditionConfig[];
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The SPEC-015 minigame pipeline seam (SPEC-021 "Mecánica v1"): the sudden
 * death launches minigames EXACTLY through the existing coordinator — the
 * challenge never creates matches, never scores, never touches matchmaking.
 * Satisfied by `TournamentMinigame.run` at composition.
 */
export interface FinalChallengeMinigamePort {
	run(activePlayerIds: readonly number[], round?: number): Promise<MinigameRoundResult>;
}

/** Grants the Shell Reward on victory (satisfied by the Reward Resolver). */
export interface FinalChallengeRewardGranter {
	grant(reward: Reward, context: ActionContext): GrantRewardResult;
}

/** Builds the ActionContext the Shell Reward / start Actions run against. */
export type FinalChallengeContextFactory = (input: {
	playerId: number;
	round: number;
}) => ActionContext;

/**
 * Freezes the final ranking (SPEC-021 "Clasificación final": 1º the Shell
 * holder, 2º+ by Leaderboard order). Satisfied by
 * `TournamentLeaderboard.generateFinal` at composition.
 */
export interface FinalChallengeRankingPort {
	generateFinal(shellHolderId: number | null): void;
}

/**
 * The Rule Engine seam for challenge-specific Rules (same shape as the Boss's
 * controller — activation ONLY through the Rule Engine, SPEC-021).
 */
export interface FinalChallengeRuleController {
	activate(config: RuleConfig): string | null;
	remove(ruleId: string): void;
}

/** Runs the challenge's start Actions through the ONE Action Engine. */
export interface FinalChallengeActionRunner {
	run(configs: readonly ActionConfig[], context: ActionContext): ExecutionResult[];
}

/** Result of `start()` / `resume()` (SPEC-021 "Victoria" / "Casos límite"). */
export type FinalChallengeRunResult =
	| { readonly status: "finished"; readonly winnerId: number; readonly attempts: number }
	/**
	 * The challenge could not progress (minigame skipped/cancelled — SPEC-021
	 * "Error interno": log and KEEP the challenge active). `resume()` re-enters
	 * the sudden death.
	 */
	| { readonly status: "stalled"; readonly reason: string }
	| { readonly status: "ignored"; readonly reason: "already_active" | "already_finished" | "not_active" };

/** Lifecycle of the challenge (SPEC-021 "Responsabilidades"). */
export type FinalChallengeLifecycle = "idle" | "active" | "finished";

/** Result of granting THE PARROT'S SHELL (one per tournament, SPEC-013). */
export type ShellGrantResult =
	| { readonly status: "granted"; readonly winnerId: number }
	| { readonly status: "rejected"; readonly reason: "already_granted" };

/** JSON-safe snapshot of the Shell match state (SPEC-013 "ShellReward"). */
export interface ShellSnapshot {
	readonly tournamentId: string;
	readonly holderId: number | null;
}

/** JSON-safe snapshot of the Final Challenge System (SPEC-021). */
export interface FinalChallengeSnapshot {
	readonly tournamentId: string;
	readonly challengeId: string;
	readonly state: FinalChallengeLifecycle;
	readonly attempts: number;
	readonly winnerId: number | null;
	readonly activeRuleIds: readonly string[];
}
