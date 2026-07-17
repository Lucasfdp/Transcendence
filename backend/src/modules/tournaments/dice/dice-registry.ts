/**
 * dice-registry.ts — the immutable dice definition registry (SPEC-010) plus the
 * v1 catalog (SPEC-010 "Dados disponibles v1").
 *
 * Dice definitions are pure, immutable content, so they live in the generic
 * deep-freezing `Registry<T>` (SPEC-025) exactly like items/boards — never a
 * bespoke store. Every die is a list of numbers (D8); the catalog faces mirror
 * `settings.catalog.ts` alternate dice. `createDiceRegistry({ seed })` builds
 * one, optionally pre-seeded with the v1 catalog.
 */

import { Registry } from "../registry/registry";
import { DiceDefinition } from "./dice.types";

/** The default die every player rolls unless a die-Item overrides it (SPEC-010). */
export const DEFAULT_DICE_ID = "normal";

/**
 * Validator for the dice registry (SPEC-025 "validate", SPEC-010 "Casos
 * límite": a die without faces / invalid config is not registered): faces must
 * be a non-empty list of finite numbers.
 */
export const validateDiceDefinition = (definition: DiceDefinition): string[] => {
	const errors: string[] = [];
	if (!definition.name || definition.name.trim() === "") {
		errors.push("name must be a non-empty string");
	}
	if (!Array.isArray(definition.faces) || definition.faces.length === 0) {
		errors.push("faces must be a non-empty array of numbers");
	} else if (
		definition.faces.some((face) => typeof face !== "number" || !Number.isFinite(face))
	) {
		errors.push("faces must contain only finite numbers");
	}
	return errors;
};

/**
 * Builds a fresh dice registry (SPEC-025). Pass `seed: true` to pre-register the
 * v1 catalog below.
 */
export const createDiceRegistry = (
	options: { seed?: boolean } = {},
): Registry<DiceDefinition> => {
	const registry = new Registry<DiceDefinition>("DiceRegistry", validateDiceDefinition);
	if (options.seed) {
		for (const definition of V1_DICE_DEFINITIONS) {
			registry.register(definition);
		}
	}
	return registry;
};

// ── v1 catalog (SPEC-010 "Dados disponibles v1") ────────────────────────────

/** Ids of the v1 dice, exported for tests/integration/shop offers. */
export const V1_DICE_IDS = {
	normal: DEFAULT_DICE_ID,
	chiquito: "chiquito",
	grande: "grande",
	op: "op",
} as const;

/**
 * The v1 dice (SPEC-010 "Dados disponibles v1"): `normal` is the default die of
 * every player every turn; `chiquito`/`grande`/`op` are obtained ONLY as
 * shop Item consumables (faces mirror `settings.catalog.ts` alternateDice). Ids
 * + presentation metadata only — no behaviour (D8: a die is a list of numbers).
 */
const NORMAL_DIE: DiceDefinition = {
	id: V1_DICE_IDS.normal,
	name: "Normal",
	icon: "🎲",
	description: "The standard six-sided die.",
	faces: [1, 2, 3, 4, 5, 6],
};

const CHIQUITO_DIE: DiceDefinition = {
	id: V1_DICE_IDS.chiquito,
	name: "Chiquito",
	icon: "🎲",
	description: "A low die that rolls 1 to 3.",
	faces: [1, 2, 3],
	metadata: { theme: "placeholder" },
};

const GRANDE_DIE: DiceDefinition = {
	id: V1_DICE_IDS.grande,
	name: "Grande",
	icon: "🎲",
	description: "A high die that rolls 4 to 6.",
	faces: [4, 5, 6],
	metadata: { theme: "placeholder" },
};

const OP_DIE: DiceDefinition = {
	id: V1_DICE_IDS.op,
	name: "OP",
	icon: "🎲",
	description: "An overpowered die that rolls 6 to 10.",
	faces: [6, 7, 8, 9, 10],
	metadata: { theme: "placeholder" },
};

/** The full v1 dice catalog. */
export const V1_DICE_DEFINITIONS: readonly DiceDefinition[] = [
	NORMAL_DIE,
	CHIQUITO_DIE,
	GRANDE_DIE,
	OP_DIE,
];
