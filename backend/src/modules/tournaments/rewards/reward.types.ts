/**
 * reward.types.ts — Reward Resolver contracts (SPEC-013).
 *
 * SPEC-013 "Reward"/"Filosofía": a Reward is NOT behaviour — it is a pure DATA
 * object (`type` + `payload`) that describes WHAT should be granted, never HOW.
 * The Reward Resolver is the single system authorised to turn a Reward into real
 * effects, and it does so by TRANSLATING `type + payload` into `ActionConfig[]`
 * run through the ONE Action Engine (SPEC-013 "Integración con Action Engine":
 * "El Reward Resolver no implementa comportamiento. Solo traduce."). A Reward
 * therefore NEVER carries constructed Actions (SPEC-013 "Reward": "La Reward
 * nunca transporta Actions ya construidas").
 *
 * This file imports ONLY the public Action Engine TYPES
 * (`ActionConfig`/`ActionContext`/`ExecutionResult`/`ConditionConfig`) — never
 * the concrete engine/factory (SPEC-013 "Restricciones"): execution is delegated
 * through the `RewardActionRunner` port below, which the architect fills with the
 * real engine at integration.
 */

import {
	ActionConfig,
	ActionContext,
	ConditionConfig,
	ExecutionResult,
} from "../actions/action.interface";

// ── Reward data object (SPEC-013 "Reward") ──────────────────────────────────

/**
 * The abstract reward types the Resolver supports (SPEC-013 "Tipos soportados").
 * BundleReward was fused into `composite` — there is a SINGLE compound reward
 * type (SPEC-013 "Tipos soportados": "BundleReward fue fusionado en
 * CompositeReward"). `future` is the explicit forward-compatible no-op
 * placeholder (SPEC-013 "FutureReward").
 */
export type RewardType =
	| "points"
	| "item"
	| "rule"
	| "keyItem"
	| "shell"
	| "composite"
	| "future";

/**
 * The exhaustive list of known reward types (SPEC-013 "Tipos soportados"), the
 * single source of truth for "is this a known type" used by both the registry
 * validator and the Resolver's validation gate. Kept in sync with `RewardType`
 * by the `satisfies` check below.
 */
export const REWARD_TYPES = [
	"points",
	"item",
	"rule",
	"keyItem",
	"shell",
	"composite",
	"future",
] as const satisfies readonly RewardType[];

/** True when `value` is one of the known `RewardType`s (SPEC-013 "Validación"). */
export const isRewardType = (value: unknown): value is RewardType =>
	typeof value === "string" &&
	(REWARD_TYPES as readonly string[]).includes(value);

/**
 * True when `value` is a well-formed `Reward` (SPEC-013 "Validación": Reward
 * válida): an object with a non-empty `id` and a known `type`. Used to validate
 * top-level Rewards and to filter composite child Rewards (SPEC-013 "Reward
 * parcialmente inválida": skip the invalid ones, resolve the rest).
 */
export const isReward = (value: unknown): value is Reward => {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as { id?: unknown; type?: unknown };
	return (
		typeof candidate.id === "string" &&
		candidate.id.trim() !== "" &&
		isRewardType(candidate.type)
	);
};

/**
 * A Reward — the pure DATA object (SPEC-013 "Reward"): `id`, `type`, optional
 * `payload`, optional `conditions`, optional `metadata`. It never transports
 * constructed Actions; the Resolver derives the Actions from `type + payload`.
 *
 * For a `composite` Reward the child Rewards live in `payload.rewards`
 * (SPEC-013 "Composite Reward"). `conditions` are propagated onto every
 * generated leaf `ActionConfig` so the existing Action Engine gating enforces
 * them (SPEC-013 "Validación": Condiciones cumplidas) — the Resolver never
 * builds a second condition-evaluation path.
 */
export interface Reward {
	readonly id: string;
	readonly type: RewardType;
	readonly payload?: Readonly<Record<string, unknown>>;
	readonly conditions?: readonly ConditionConfig[];
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Rewards are content definitions referenced by id (SPEC-013 "Reward"), so the
 * reward registry stores them directly. Aliased for clarity at the registry
 * boundary; a `RewardDefinition` IS a `Reward`.
 */
export type RewardDefinition = Reward;

// ── Translation (SPEC-013 "Integración con Action Engine") ──────────────────

/**
 * A pure translation from a Reward to the `ActionConfig[]` that realise it
 * (SPEC-013 "Solo traduce."). One `RewardTranslator` exists per supported
 * `RewardType` (config-over-code, SPEC-013 "Todo mediante configuración"). A
 * translator has NO side effects and NEVER executes anything — it only maps
 * `type + payload` to configs the Action Engine will later run.
 */
export type RewardTranslator = (reward: Reward) => ActionConfig[];

/** The translation map: one translator per supported reward type. */
export type RewardTranslatorMap = Readonly<
	Record<RewardType, RewardTranslator>
>;

// ── Execution seam (dependency inversion, SPEC-013 "Restricciones") ─────────

/**
 * The seam through which the Resolver runs its TRANSLATED configs through the
 * Action Engine WITHOUT importing it (SPEC-013 "Arquitectura": Reward Resolver →
 * Action Engine). Structurally IDENTICAL to the Inventory's `ItemEffectRunner`
 * (same `run(configs, context) => ExecutionResult[]` shape) on purpose: ONE
 * concrete adapter (ActionFactory + ActionEngine) built by the architect can
 * satisfy both at integration. It is declared here rather than imported so the
 * Resolver depends on no other engine; `run` returns one `ExecutionResult` per
 * config, in config order, and (like the engine) never throws.
 */
export interface RewardActionRunner {
	run(
		configs: readonly ActionConfig[],
		context: ActionContext,
	): ExecutionResult[];
}

// ── Public command results (discriminated unions) ───────────────────────────

/**
 * Why a grant was rejected (SPEC-013 "Validación" / "Casos límite"):
 * - `unknown_type`: the Reward's `type` is not a known `RewardType` (SPEC-013
 *   "Reward desconocida → Registrar error → Cancelar").
 * - `invalid_config`: the payload is malformed for the type, or `grantById`
 *   found no Reward with the given id.
 * - `conditions_unmet`: reserved for a Resolver-level pre-gate (the Action
 *   Engine enforces per-Action conditions; kept in the union for completeness).
 * - `no_actions`: a non-future/non-composite Reward translated to zero configs
 *   — nothing to do.
 */
export type RewardRejectionReason =
	| "unknown_type"
	| "invalid_config"
	| "conditions_unmet"
	| "no_actions";

/**
 * Result of `grant` / `grantById` (SPEC-013 "Pipeline"). On `resolved`,
 * `results` are the per-config Action Engine results, in config order (empty for
 * a `future` no-op). On `rejected`, `reason` is the rejection category.
 */
export type GrantRewardResult =
	| {
			readonly status: "resolved";
			readonly rewardId: string;
			readonly results: readonly ExecutionResult[];
	  }
	| {
			readonly status: "rejected";
			readonly rewardId: string;
			readonly reason: RewardRejectionReason;
	  };

/**
 * JSON-safe snapshot of the Resolver for the Runtime snapshot (SPEC-013): the
 * Resolver is largely stateless (it only translates and delegates), so the
 * snapshot is minimal — the tournament id and how many Reward definitions the
 * registry holds.
 */
export interface RewardResolverSnapshot {
	readonly tournamentId: string;
	readonly rewardCount: number;
}
