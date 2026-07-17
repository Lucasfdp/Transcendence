/**
 * rule-registry.ts — the Rule DEFINITION registry (SPEC-009 "Registro").
 *
 * SPEC-009 "Registro": all rules live registered. This wraps the generic
 * content Registry (SPEC-025) with the `RuleConfig` definition type, so rule
 * definitions are stored deep-frozen and validated at load. It holds only
 * immutable DEFINITIONS (data); the stateful active instances the engine
 * manages are built from these via `createRule` and never stored here (the
 * Registry deep-freezes — a live, mutating rule must not go in it).
 *
 * The seed set below is the minimal v1 fixture set demonstrating each of the
 * five consultation points and both compositions. It is NOT a content catalog
 * (that is future F4–F6 work); it exists so composition can be exercised.
 */

import { Registry } from "../registry/registry";
import { ConfiguredRule, RuleConfig, createRule } from "./configured-rule";

/**
 * Validator run by the Registry on register (SPEC-025: an invalid configuration
 * never loads). Reuses ConfiguredRule's own coherence check so definition-time
 * and instance-time validation cannot drift.
 */
const validateRuleConfig = (config: RuleConfig): string[] =>
	new ConfiguredRule(config).validate();

/** Creates an empty rule-definition registry. */
export function createRuleDefinitionRegistry(): Registry<RuleConfig> {
	return new Registry<RuleConfig>("RuleDefinitions", validateRuleConfig);
}

/**
 * v1 seed rules (SPEC-009 "Ejemplos"): each is pure configuration, proving
 * rules are data, not code.
 */
export const SEED_RULE_CONFIGS: Readonly<Record<string, RuleConfig>> = {
	/** Lucky Dice — a value DiceModifier that stacks (+2). */
	luckyDice: {
		id: "lucky_dice",
		priority: 10,
		point: "dice",
		composition: "value",
		duration: { kind: "UntilRemoved" },
		value: { kind: "add", amount: 2 },
	},
	/** Double Dice — a value DiceModifier that stacks (×2). */
	doubleDice: {
		id: "double_dice",
		priority: 20,
		point: "dice",
		composition: "value",
		duration: { kind: "Round", rounds: 1 },
		value: { kind: "multiply", factor: 2 },
	},
	/** Loaded Dice — an EXCLUSIVE active-dice override (roll becomes 6). */
	loadedDice: {
		id: "loaded_dice",
		priority: 100,
		point: "dice",
		composition: "exclusive",
		duration: { kind: "Turns", turns: 3 },
		value: { kind: "set", value: 6 },
	},
	/** Half Points — a value RewardMultiplier (×0.5). */
	halfPoints: {
		id: "half_points",
		priority: 10,
		point: "reward",
		composition: "value",
		duration: { kind: "Permanent" },
		value: { kind: "multiply", factor: 0.5 },
	},
	/** Free Shop — a value PriceModifier forcing prices to zero (×0). */
	freeShop: {
		id: "free_shop",
		priority: 50,
		point: "price",
		composition: "value",
		duration: { kind: "Round", rounds: 1 },
		value: { kind: "multiply", factor: 0 },
	},
	/** No Steal — a boolean StealPrevention flag. */
	noSteal: {
		id: "no_steal",
		priority: 10,
		point: "steal",
		composition: "exclusive",
		duration: { kind: "UntilRemoved" },
		boolean: true,
	},
	/** Fog — a named boolean Flag rule. */
	fog: {
		id: "fog",
		priority: 10,
		point: "flag",
		composition: "exclusive",
		duration: { kind: "Round", rounds: 1 },
		flag: "fog",
		boolean: true,
	},
};

/** Builds a fresh stateful instance of a seed rule (SPEC-009 "Configuración"). */
export function createSeedRule(key: keyof typeof SEED_RULE_CONFIGS): ConfiguredRule {
	return createRule(SEED_RULE_CONFIGS[key]);
}
