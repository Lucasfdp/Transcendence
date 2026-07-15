/**
 * final-challenge-registry.ts — the immutable Final Challenge definition
 * registry (SPEC-021) plus the v1 sudden-death challenge.
 *
 * A Final Challenge definition is pure content (SPEC-021 "Configuración": todo
 * mediante configuración, nunca mediante código), so it lives in the generic
 * deep-freezing `Registry<T>` (SPEC-025). The v1 challenge implements the
 * DEFINED mechanic (SPEC-021 "Mecánica v1": minigame sudden death — not a
 * pending design item); theme/visuals/extra rules are D-pending content and can
 * land later without touching this system.
 */

import { Registry } from "../registry/registry";
import { FinalChallengeDefinition } from "./final-challenge.types";

/** Validator (SPEC-025 / SPEC-021): a name and at least one victory condition. */
export const validateFinalChallengeDefinition = (
	definition: FinalChallengeDefinition,
): string[] => {
	const errors: string[] = [];
	if (!definition.name || definition.name.trim() === "") {
		errors.push("name must be a non-empty string");
	}
	if (!Array.isArray(definition.rules)) {
		errors.push("rules must be an array of RuleConfig");
	}
	if (!Array.isArray(definition.actions)) {
		errors.push("actions must be an array of ActionConfig");
	}
	if (
		!Array.isArray(definition.victoryConditions) ||
		definition.victoryConditions.length === 0
	) {
		errors.push("victoryConditions must be a non-empty array");
	}
	return errors;
};

/** Builds a fresh registry; `seed: true` pre-registers the v1 sudden death. */
export const createFinalChallengeRegistry = (
	options: { seed?: boolean } = {},
): Registry<FinalChallengeDefinition> => {
	const registry = new Registry<FinalChallengeDefinition>(
		"FinalChallengeRegistry",
		validateFinalChallengeDefinition,
	);
	if (options.seed) {
		registry.register(V1_FINAL_CHALLENGE);
	}
	return registry;
};

/**
 * Id of the v1 Final Challenge. OWNED here (the challenge is fully decoupled
 * from the Boss, SPEC-021 "Filosofía"); the Boss definition points at it.
 */
export const V1_FINAL_CHALLENGE_ID = "suddenDeath";

/**
 * The v1 Final Challenge (SPEC-021 "Mecánica v1"): a minigame sudden death with
 * every player, relaunched on tie/no-result until a unique winner emerges. No
 * challenge-specific Rules (the Boss Rules stay active) and no presentation
 * Actions yet (F7 content).
 */
const V1_FINAL_CHALLENGE: FinalChallengeDefinition = {
	id: V1_FINAL_CHALLENGE_ID,
	name: "Sudden Death",
	description:
		"One minigame, every player, one winner. Ties relaunch until someone claims THE PARROT'S SHELL.",
	rules: [],
	actions: [],
	victoryConditions: [{ kind: "suddenDeath" }],
};
