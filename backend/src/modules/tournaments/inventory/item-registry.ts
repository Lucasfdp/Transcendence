/**
 * item-registry.ts — the immutable Item definition registry (SPEC-007) plus a
 * TINY v1 seed set used ONLY as test/integration fixtures.
 *
 * SPEC-007 "Definición": Item definitions are pure, immutable content, so they
 * live in the generic deep-freezing `Registry<T>` (SPEC-025) exactly like
 * boards/tiles/dice — never a bespoke store. `createItemRegistry()` builds one,
 * optionally pre-seeded.
 *
 * The seed set below is NOT the Item content catalog (that is a later phase). It
 * is the minimum needed to exercise the framework: one CONSUMABLE item whose
 * effects are `activateRule` + `awardPoints` ActionConfigs, and one PERMANENT
 * item. The Inventory never executes these — it only stores/consumes and
 * delegates the effects to the Action Engine — so the exact action `type`
 * strings here are placeholders for real registered Actions (SPEC-032 `*Action`
 * suffix), not a claim that those Actions exist yet.
 */

import { Registry } from "../registry/registry";
import { ItemDefinition } from "./item.types";

/**
 * Validator for the item registry (SPEC-025 "validate"): an Item must have a
 * name, a boolean `consumable`, and an `effects` array (SPEC-007 "Definición" —
 * behaviour lives ONLY in effects, so the array is mandatory even when empty).
 */
export const validateItemDefinition = (definition: ItemDefinition): string[] => {
	const errors: string[] = [];
	if (!definition.name || definition.name.trim() === "") {
		errors.push("name must be a non-empty string");
	}
	if (typeof definition.consumable !== "boolean") {
		errors.push("consumable must be a boolean");
	}
	if (!Array.isArray(definition.effects)) {
		errors.push("effects must be an array of ActionConfig");
	}
	return errors;
};

/**
 * Builds a fresh item registry (SPEC-025). Pass `seed: true` to pre-register the
 * v1 seed fixtures below (used by tests/integration only).
 */
export const createItemRegistry = (
	options: { seed?: boolean } = {},
): Registry<ItemDefinition> => {
	const registry = new Registry<ItemDefinition>("ItemRegistry", validateItemDefinition);
	if (options.seed) {
		for (const definition of SEED_ITEM_DEFINITIONS) {
			registry.register(definition);
		}
	}
	return registry;
};

// ── v1 seed / test fixtures (NOT the content catalog) ───────────────────────

/** Ids of the seed fixtures, exported so tests/integration can reference them. */
export const SEED_ITEM_IDS = {
	/** Consumable — the SPEC-007 "Lucky Dice" example. */
	luckyDice: "luckyDice",
	/** Permanent — a passive badge kept across uses. */
	goldenParrotBadge: "goldenParrotBadge",
	/** Consumable — a PERSONAL StealPrevention shield (real, functional effect). */
	shellShield: "shellShield",
	/** Consumable — a PERSONAL dice value-override (next roll set to 6). */
	loadedDie: "loadedDie",
} as const;

/**
 * CONSUMABLE seed (SPEC-007 "Ejemplos": Lucky Dice). Its effects are ordinary
 * ActionConfigs — an `activateRuleAction` (a +2 dice rule) followed by an
 * `awardPointsAction` — that the Action Engine runs on use. `consumable: true`
 * → destroyed after use (SPEC-007 "Consumo"); `trigger: OnDiceRoll` is
 * descriptive metadata only (SPEC-007 "Trigger").
 */
const LUCKY_DICE: ItemDefinition = {
	id: SEED_ITEM_IDS.luckyDice,
	name: "Lucky Dice",
	rarity: "rare",
	icon: "🎲",
	description: "Adds +2 to your next roll and grants a small point bonus.",
	consumable: true,
	trigger: "OnDiceRoll",
	effects: [
		{
			type: "activateRuleAction",
			parameters: { ruleId: "luckyDicePlusTwo", point: "dice", amount: 2 },
		},
		{
			type: "awardPointsAction",
			parameters: { amount: 2, reason: "luckyDice", source: "future" },
		},
	],
};

/**
 * PERMANENT seed (SPEC-007 "Consumo": Permanente). Stays in its slot after use
 * and can be used repeatedly; its single effect activates a passive reward rule.
 */
const GOLDEN_PARROT_BADGE: ItemDefinition = {
	id: SEED_ITEM_IDS.goldenParrotBadge,
	name: "Golden Parrot Badge",
	rarity: "legendary",
	icon: "🦜",
	description: "A passive badge that keeps a reward bonus active.",
	consumable: false,
	effects: [
		{
			type: "activateRuleAction",
			parameters: { ruleId: "goldenParrotBonus", point: "reward" },
		},
	],
};

/**
 * CONSUMABLE, FUNCTIONAL (SPEC-007 + SPEC-009): the "Shell Shield" — a personal
 * StealPrevention. Unlike the two fixtures above (whose effects use placeholder
 * action strings), this item's single effect is a REAL registered Action:
 * `activatePlayerRule` builds a steal-prevention Rule bound to the consumer, so
 * — with player-scoped rule consultation — it protects ONLY its holder from
 * `attemptSteal`, never the whole table. `UntilRemoved` so it persists until
 * broken/cleared. `consumable: true` → the Item is spent when used.
 */
const SHELL_SHIELD: ItemDefinition = {
	id: SEED_ITEM_IDS.shellShield,
	name: "Shell Shield",
	rarity: "uncommon",
	icon: "🛡️",
	description: "Blocks the next steal attempt against you until it breaks.",
	consumable: true,
	trigger: "OnUse",
	effects: [
		{
			type: "activatePlayerRule",
			parameters: {
				rule: {
					id: "shellShieldNoSteal",
					priority: 20,
					point: "steal",
					composition: "exclusive",
					duration: { kind: "UntilRemoved" },
					boolean: true,
				},
			},
		},
	],
};

/**
 * CONSUMABLE, FUNCTIONAL (SPEC-007 + SPEC-009/SPEC-010): the "Loaded Die" — a
 * personal dice value-OVERRIDE. Its effect activates a player-scoped exclusive
 * DiceModifier (`set` → 6) via `activatePlayerRule`; because consultation is
 * player-scoped, only the consumer's own roll is forced to 6. `Turns: 1` (a
 * player-bound Turns rule) so the override applies to the holder's next turn and
 * then expires. This is the value-override die item (NOT a die-swap, which would
 * need the Dice `ActiveDieResolver` seam and a separate ADR).
 */
const LOADED_DIE: ItemDefinition = {
	id: SEED_ITEM_IDS.loadedDie,
	name: "Loaded Die",
	rarity: "rare",
	icon: "🎯",
	description: "Forces your next roll to a 6.",
	consumable: true,
	trigger: "OnDiceRoll",
	effects: [
		{
			type: "activatePlayerRule",
			parameters: {
				rule: {
					id: "loadedDieSet",
					priority: 100,
					point: "dice",
					composition: "exclusive",
					duration: { kind: "Turns", turns: 1 },
					value: { kind: "set", value: 6 },
				},
			},
		},
	],
};

/** The full v1 seed set (fixtures + the first functional content items). */
export const SEED_ITEM_DEFINITIONS: readonly ItemDefinition[] = [
	LUCKY_DICE,
	GOLDEN_PARROT_BADGE,
	SHELL_SHIELD,
	LOADED_DIE,
];
