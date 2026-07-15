/**
 * key-item-registry.ts — the immutable Key Item definition registry (SPEC-017)
 * plus a v1 PLACEHOLDER catalog.
 *
 * Key Item definitions are pure content (SPEC-017 "Definición"), so they live in
 * the generic deep-freezing `Registry<T>` (SPEC-025) like items/dice/boards. The
 * v1 catalog below is NOT final content (theme/names/icons are a D11 content
 * session, SPEC-039): it is four ordered placeholders so the progression toward
 * the Final Challenge can be exercised end-to-end.
 */

import { Registry } from "../registry/registry";
import { KeyItemDefinition } from "./key-item.types";

/**
 * Validator (SPEC-025 / SPEC-017): a non-empty name and a positive integer
 * `order` (the unlock sequence). Icons/descriptions are free-form placeholders.
 */
export const validateKeyItemDefinition = (definition: KeyItemDefinition): string[] => {
	const errors: string[] = [];
	if (!definition.name || definition.name.trim() === "") {
		errors.push("name must be a non-empty string");
	}
	if (
		typeof definition.order !== "number" ||
		!Number.isInteger(definition.order) ||
		definition.order <= 0
	) {
		errors.push("order must be a positive integer");
	}
	return errors;
};

/** Builds a fresh Key Item registry; `seed: true` pre-registers the v1 set. */
export const createKeyItemRegistry = (
	options: { seed?: boolean } = {},
): Registry<KeyItemDefinition> => {
	const registry = new Registry<KeyItemDefinition>(
		"KeyItemRegistry",
		validateKeyItemDefinition,
	);
	if (options.seed) {
		for (const definition of V1_KEY_ITEMS) {
			registry.register(definition);
		}
	}
	return registry;
};

/** Ids of the v1 placeholder Key Items, exported for tests/integration. */
export const V1_KEY_ITEM_IDS = {
	first: "keyItem1",
	second: "keyItem2",
	third: "keyItem3",
	fourth: "keyItem4",
} as const;

/**
 * v1 placeholder Key Items (fixtures only) — four fragments of "The Parrot's
 * Shell", ordered 1–4. Names/icons are provisional (D11).
 */
const V1_KEY_ITEMS: readonly KeyItemDefinition[] = [
	{
		id: V1_KEY_ITEM_IDS.first,
		name: "Shell Fragment I",
		description: "The first fragment of the Parrot's Shell.",
		icon: "🐚",
		order: 1,
	},
	{
		id: V1_KEY_ITEM_IDS.second,
		name: "Shell Fragment II",
		description: "The second fragment of the Parrot's Shell.",
		icon: "🐚",
		order: 2,
	},
	{
		id: V1_KEY_ITEM_IDS.third,
		name: "Shell Fragment III",
		description: "The third fragment of the Parrot's Shell.",
		icon: "🐚",
		order: 3,
	},
	{
		id: V1_KEY_ITEM_IDS.fourth,
		name: "Shell Fragment IV",
		description: "The final fragment of the Parrot's Shell.",
		icon: "🐚",
		order: 4,
	},
];
