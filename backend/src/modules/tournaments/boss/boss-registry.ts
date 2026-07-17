/**
 * boss-registry.ts — the immutable Boss definition registry (SPEC-020) plus a v1
 * PLACEHOLDER Boss.
 *
 * A Boss definition is pure content (SPEC-020 "Definición"), so it lives in the
 * generic deep-freezing `Registry<T>` (SPEC-025) like every other catalog. The
 * v1 Boss below is NOT final content (theme/narrative/visuals + the concrete
 * Rules are a D11/content decision, SPEC-020 "Pendiente de definición") — it is
 * the minimum to exercise the pipeline: an empty intro (presentation Actions are
 * F7) and two GLOBAL Boss Rules reused from the seed rule catalog (No Robbery +
 * Double Dice), pointing at the v1 sudden-death Final Challenge.
 */

import { Registry } from "../registry/registry";
import { SEED_RULE_CONFIGS } from "../rules/rule-registry";
import { V1_FINAL_CHALLENGE_ID } from "../final-challenge/final-challenge-registry";
import { BossDefinition } from "./boss.types";

/** Validator (SPEC-025 / SPEC-020): a non-empty name and a Final Challenge id. */
export const validateBossDefinition = (definition: BossDefinition): string[] => {
	const errors: string[] = [];
	if (!definition.name || definition.name.trim() === "") {
		errors.push("name must be a non-empty string");
	}
	if (!definition.finalChallengeId || definition.finalChallengeId.trim() === "") {
		errors.push("finalChallengeId must be a non-empty string");
	}
	if (!Array.isArray(definition.activeRules)) {
		errors.push("activeRules must be an array of RuleConfig");
	}
	if (!Array.isArray(definition.introSequence)) {
		errors.push("introSequence must be an array of ActionConfig");
	}
	return errors;
};

/** Builds a fresh Boss registry; `seed: true` pre-registers the v1 placeholder. */
export const createBossRegistry = (
	options: { seed?: boolean } = {},
): Registry<BossDefinition> => {
	const registry = new Registry<BossDefinition>("BossRegistry", validateBossDefinition);
	if (options.seed) {
		registry.register(V1_BOSS);
	}
	return registry;
};

/** Id of the v1 placeholder Boss, for tests/integration. */
export const V1_BOSS_ID = "parrotKing";
/**
 * Re-exported for convenience: the Final Challenge id is OWNED by the Final
 * Challenge registry (SPEC-021: the challenge is fully decoupled from the
 * Boss); the v1 Boss definition merely points at it.
 */
export { V1_FINAL_CHALLENGE_ID };

/**
 * The v1 placeholder Boss (fixtures only). Empty intro (presentation Actions are
 * F7); two GLOBAL Boss Rules — "No Robbery" (noSteal) and "Double Dice" — reused
 * from the seed rule catalog, proving the Boss alters the game ONLY through the
 * Rule Engine (SPEC-020 "Boss Rules").
 */
const V1_BOSS: BossDefinition = {
	id: V1_BOSS_ID,
	name: "The Parrot King",
	description: "The keeper of the Shell rises once every fragment is claimed.",
	icon: "🦜",
	introSequence: [],
	activeRules: [SEED_RULE_CONFIGS.noSteal, SEED_RULE_CONFIGS.doubleDice],
	finalChallengeId: V1_FINAL_CHALLENGE_ID,
};
