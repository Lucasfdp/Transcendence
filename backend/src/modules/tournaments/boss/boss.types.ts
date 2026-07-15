/**
 * boss.types.ts — data model + ports for the Boss System (SPEC-020).
 *
 * The Boss is an ORCHESTRATOR, never gameplay (SPEC-020 "Filosofía"): every game
 * modification is a Rule, every presentation is an Action. So a Boss DEFINITION
 * is pure content (intro Actions + the Rules it activates + which Final Challenge
 * it starts), and the system depends only on narrow ports — a Rule controller,
 * an Action runner and the Key Item gate — never touching Economy, Inventory,
 * Board, rewards or winner logic (SPEC-020 "Restricciones").
 */

import { ActionConfig, ExecutionResult } from "../actions/action.interface";
import { ActionContext } from "../actions/action.interface";
import { RuleConfig } from "../rules/configured-rule";

/** Immutable Boss definition (SPEC-020 "Definición"). Pure content. */
export interface BossDefinition {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly icon: string;
	/** Presentation Actions run on spawn (SPEC-020: sequences use only Actions). */
	readonly introSequence: readonly ActionConfig[];
	/** Rules the Boss activates while it is present (SPEC-020 "Boss Rules"). */
	readonly activeRules: readonly RuleConfig[];
	/** Which Final Challenge the Boss starts (SPEC-020 "Final Challenge"). */
	readonly finalChallengeId: string;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The Rule Engine seam the Boss drives (SPEC-020 "Integración con Rule Engine":
 * the Boss may ONLY activate/deactivate Rules). Satisfied by the composition
 * adapter over the Rule Engine (`register(createRule(config))` + `activate`, and
 * `remove` by id). Returns the activated rule id, or null when it did not.
 */
export interface BossRuleController {
	activate(config: RuleConfig): string | null;
	remove(ruleId: string): void;
}

/** Runs the Boss intro Actions through the ONE Action Engine (SPEC-020). */
export interface BossActionRunner {
	run(configs: readonly ActionConfig[], context: ActionContext): ExecutionResult[];
}

/** Builds the ActionContext the intro Actions run against. */
export type BossContextFactory = (input: { round: number }) => ActionContext;

/**
 * The Key Item gate the Boss consults (SPEC-020 "Aparición": the Boss appears
 * ONLY when every Key Item is unlocked). Satisfied over `TournamentKeyItems`.
 */
export interface BossKeyItemGate {
	isComplete(): boolean;
}

/** Result of a spawn attempt (SPEC-020 "Casos límite"). */
export type BossSpawnResult =
	| { readonly status: "spawned"; readonly finalChallengeId: string }
	| { readonly status: "rejected"; readonly reason: "key_items_incomplete" }
	| { readonly status: "ignored"; readonly reason: "already_active" };

/** Boss lifecycle state (SPEC-020). */
export type BossLifecycle = "idle" | "active" | "finished";

/** JSON-safe snapshot of the Boss System (SPEC-020). */
export interface BossSnapshot {
	readonly tournamentId: string;
	readonly bossId: string;
	readonly state: BossLifecycle;
	readonly activeRuleIds: readonly string[];
}
