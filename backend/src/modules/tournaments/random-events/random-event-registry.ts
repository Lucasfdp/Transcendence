/**
 * random-event-registry.ts — the immutable random-event definition registry
 * (SPEC-019) plus a tiny v1 PLACEHOLDER catalog.
 *
 * Random events are pure content, so they live in the generic deep-freezing
 * `Registry<T>` (SPEC-025) like items/dice/boards. The v1 catalog is NOT final
 * content (that is a D11 content session): it is the minimum needed to exercise
 * the system — a few events composed of the EXISTING Actions (award/remove/move),
 * with placeholder metadata only (SPEC-019 "Reutilización").
 */

import { Registry } from "../registry/registry";
import { RandomEventDefinition } from "./random-event.types";

/**
 * Validator (SPEC-025 / SPEC-019): a positive weight and a non-empty name; the
 * `actions` array is mandatory (behaviour lives only in actions, even if empty).
 */
export const validateRandomEventDefinition = (
	definition: RandomEventDefinition,
): string[] => {
	const errors: string[] = [];
	if (!definition.name || definition.name.trim() === "") {
		errors.push("name must be a non-empty string");
	}
	if (typeof definition.weight !== "number" || definition.weight <= 0) {
		errors.push("weight must be a positive number");
	}
	if (!Array.isArray(definition.actions)) {
		errors.push("actions must be an array of ActionConfig");
	}
	return errors;
};

/** Builds a fresh random-event registry; `seed: true` pre-registers the v1 set. */
export const createRandomEventRegistry = (
	options: { seed?: boolean } = {},
): Registry<RandomEventDefinition> => {
	const registry = new Registry<RandomEventDefinition>(
		"RandomEventRegistry",
		validateRandomEventDefinition,
	);
	if (options.seed) {
		for (const definition of V1_RANDOM_EVENTS) {
			registry.register(definition);
		}
	}
	return registry;
};

/** Ids of the v1 placeholder events, exported for tests/integration. */
export const V1_RANDOM_EVENT_IDS = {
	windfall: "windfall",
	misfortune: "misfortune",
	gust: "gust",
} as const;

/**
 * v1 placeholder events (fixtures only): a points windfall, a points loss and a
 * forced forward move — all built from existing Actions (SPEC-019 "Ejemplos").
 * Weights are provisional (D2). No artistic names beyond placeholder ids.
 */
const V1_RANDOM_EVENTS: readonly RandomEventDefinition[] = [
	{
		id: V1_RANDOM_EVENT_IDS.windfall,
		name: "Windfall",
		description: "A small point windfall.",
		weight: 3,
		actions: [
			{ type: "awardPoints", parameters: { amount: 20, reason: "randomEvent", source: "future" } },
		],
		metadata: { theme: "placeholder" },
	},
	{
		id: V1_RANDOM_EVENT_IDS.misfortune,
		name: "Misfortune",
		description: "A small point loss.",
		weight: 2,
		actions: [
			{ type: "removePoints", parameters: { amount: 15, reason: "randomEvent", source: "future" } },
		],
		metadata: { theme: "placeholder" },
	},
	{
		id: V1_RANDOM_EVENT_IDS.gust,
		name: "Gust",
		description: "A gust pushes the player one tile forward.",
		weight: 1,
		actions: [{ type: "movePlayer", parameters: { steps: 1 } }],
		metadata: { theme: "placeholder" },
	},
];
