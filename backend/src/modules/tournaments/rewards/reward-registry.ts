/**
 * reward-registry.ts — the immutable Reward definition registry (SPEC-013) plus
 * a TINY seed set used ONLY as test/integration fixtures.
 *
 * SPEC-013 "Reward": Rewards are pure DATA definitions referenced by id, so they
 * live in the generic deep-freezing `Registry<T>` (SPEC-025) exactly like
 * items/boards/tiles — never a bespoke store. `createRewardRegistry()` builds
 * one, optionally pre-seeded.
 *
 * The seed set below is NOT the Reward content catalog (that is a later phase /
 * belongs to the content-owning systems that hand Rewards to the Resolver). It
 * is the minimum needed to exercise the Resolver: one `points` Reward and one
 * `composite` Reward bundling points + item. The Resolver never executes these —
 * it only TRANSLATES them into ActionConfigs and delegates to the Action Engine.
 */

import { Registry } from "../registry/registry";
import {
	RewardDefinition,
	isRewardType,
} from "./reward.types";

/**
 * Validator for the reward registry (SPEC-025 "validate", SPEC-013
 * "Validación"): a Reward must have a non-empty id and a known `type`. Payload
 * shape is validated per-type at translation time (SPEC-013 "Configuración
 * correcta"), not here, so a content typo fails cleanly at grant rather than
 * refusing to register.
 */
export const validateReward = (definition: RewardDefinition): string[] => {
	const errors: string[] = [];
	if (!definition.id || definition.id.trim() === "") {
		errors.push("id must be a non-empty string");
	}
	if (!isRewardType(definition.type)) {
		errors.push(`type must be a known RewardType (got "${String(definition.type)}")`);
	}
	return errors;
};

/**
 * Builds a fresh reward registry (SPEC-025). Pass `seed: true` to pre-register
 * the fixtures below (used by tests/integration only, NEVER the content
 * catalog).
 */
export const createRewardRegistry = (
	options: { seed?: boolean } = {},
): Registry<RewardDefinition> => {
	const registry = new Registry<RewardDefinition>("RewardRegistry", validateReward);
	if (options.seed) {
		for (const definition of SEED_REWARD_DEFINITIONS) {
			registry.register(definition);
		}
	}
	return registry;
};

// ── v1 seed / test fixtures (NOT the content catalog) ───────────────────────

/** Ids of the seed fixtures, exported so tests/integration can reference them. */
export const SEED_REWARD_IDS = {
	/** A plain `points` Reward (SPEC-013 "PointsReward"). */
	victoryPoints: "victoryPoints",
	/** A `composite` Reward bundling points + item (SPEC-013 "Composite Reward"). */
	victoryBundle: "victoryBundle",
} as const;

/**
 * `points` seed (SPEC-013 "PointsReward"). `payload` carries the amount/reason/
 * source the `points` translator reads to build a single `awardPoints`
 * ActionConfig.
 */
const VICTORY_POINTS: RewardDefinition = {
	id: SEED_REWARD_IDS.victoryPoints,
	type: "points",
	payload: { amount: 500, reason: "victory", source: "minigame" },
};

/**
 * `composite` seed (SPEC-013 "Composite Reward": una recompensa puede contener
 * varias). The child Rewards live in `payload.rewards`; the composite translator
 * flattens each child's configs (SPEC-013 "Composite Reward" example: points +
 * item). The `item` child is a forward seam (`grantItem`) that resolves cleanly
 * today (SPEC-008: unknown action type → skipped).
 */
const VICTORY_BUNDLE: RewardDefinition = {
	id: SEED_REWARD_IDS.victoryBundle,
	type: "composite",
	payload: {
		rewards: [
			{
				id: "victoryBundle:points",
				type: "points",
				payload: { amount: 100, reason: "victoryBundle", source: "minigame" },
			},
			{
				id: "victoryBundle:item",
				type: "item",
				payload: { itemId: "luckyDice" },
			},
		],
	},
};

/** The full seed set (fixtures only). */
export const SEED_REWARD_DEFINITIONS: readonly RewardDefinition[] = [
	VICTORY_POINTS,
	VICTORY_BUNDLE,
];
