/**
 * random-event.types.ts — Random Events System contracts (SPEC-019).
 *
 * A Random Event contains NO logic — it is a content definition (SPEC-019
 * "Filosofía"): a weight, optional conditions and a list of Actions run through
 * the ONE Action Engine (SPEC-019 "Ejecución"). The Actions are exactly the same
 * ones Tiles/Items/Boss/Dice/Rewards use — there are never Random-Event-only
 * Actions (SPEC-019 "Reutilización").
 *
 * This file imports ONLY the public Action Engine TYPES (`ActionConfig`/
 * `ActionContext`/`ConditionConfig`/`ExecutionResult`) — never the concrete
 * engine: execution is delegated through the `RandomEventActionRunner` port
 * (identical in shape to the Reward/Tile runners, so ONE adapter satisfies them
 * all at integration).
 */

import {
	ActionConfig,
	ActionContext,
	ConditionConfig,
	ExecutionResult,
} from "../actions/action.interface";

/**
 * The immutable definition of a random event (SPEC-019 "Definición": id, name,
 * description, weight, conditions[], actions[], metadata). `weight` drives the
 * seeded weighted selection (SPEC-019 "Selección": probability is never
 * hardcoded). Behaviour lives entirely in `actions` (SPEC-019 "Filosofía").
 */
export interface RandomEventDefinition {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	/** Selection weight (> 0); higher = more likely (SPEC-019 "Selección"). */
	readonly weight: number;
	/** Optional gating conditions, attached to every generated leaf config. */
	readonly conditions?: readonly ConditionConfig[];
	/** Actions run through the Action Engine (SPEC-019 "Ejecución"). */
	readonly actions: readonly ActionConfig[];
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The seam through which the Random Events System runs an event's Actions
 * through the Action Engine WITHOUT importing it (SPEC-019 "Arquitectura":
 * Random Event System → Action Engine). Identical in shape to the Reward/Tile
 * runners — one concrete adapter satisfies them all. Returns one result per
 * Action, in order; never throws.
 */
export interface RandomEventActionRunner {
	run(
		actions: readonly ActionConfig[],
		context: ActionContext,
	): ExecutionResult[];
}

/** Builds the ActionContext an event's Actions run against (SPEC-008 "Context"). */
export type RandomEventContextFactory = (input: {
	playerId: number;
	round: number;
}) => ActionContext;

/** JSON-safe snapshot of the Random Events System (SPEC-019): the seed counter. */
export interface RandomEventsSnapshot {
	readonly tournamentId: string;
	readonly seed: string;
	readonly selectionCount: number;
}
