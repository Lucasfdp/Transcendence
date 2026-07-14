/**
 * action-registry.ts — ActionRegistry + ConditionRegistry + ActionFactory
 * (SPEC-008 "Action Registry"/"Action Factory"/"Configuración").
 *
 * Every Action and Condition type is REGISTERED as a builder keyed by a `type`
 * string; instances are built from configuration through the factory, never
 * with `new XAction()` in gameplay code (SPEC-008 "Action Registry": "Nunca
 * utilizar new AwardPointsAction()"). Registration happens at boot: a
 * duplicate/blank type THROWS there (a bad catalog must abort the load, same
 * policy as `Registry`). BUILDING from config never throws — an unknown type
 * or invalid config is logged and yields `null` (a Skip sentinel), so a bad
 * config entry can never crash a running tournament (SPEC-008 "Casos límite":
 * Action desconocida → Log → Skip; Configuración inválida → Skip → Log).
 */

import { TournamentLogger } from "../infra/tournament-logger";
import type { ActionEngine } from "./action-engine";
import {
	ActionConfig,
	ConditionConfig,
	IAction,
	ICondition,
} from "./action.interface";

/**
 * Everything a builder receives to construct one Action from its config entry
 * (SPEC-008 "Configuración"). `factory`/`engine` are provided so a composite
 * builder can build its children and run them through the same engine
 * (SPEC-008 "Composite Actions").
 */
export interface ActionBuildContext {
	readonly type: string;
	readonly parameters: Readonly<Record<string, unknown>>;
	readonly conditions: readonly ICondition[];
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly priority?: number;
	/** The factory itself, for building nested/child actions. */
	readonly factory: ActionFactory;
	/** The engine children run through (composites only). */
	readonly engine?: ActionEngine;
}

/** Builds one Action instance from its config (SPEC-008 "Action Factory"). */
export type ActionBuilder = (build: ActionBuildContext) => IAction;

/** Builds one Condition instance from its parameters (SPEC-008 "Conditions"). */
export type ConditionBuilder = (
	parameters: Readonly<Record<string, unknown>>,
) => ICondition;

/**
 * Registry of Action-type builders (SPEC-008 "Action Registry"). A small
 * purpose-built map rather than the deep-freezing `Registry<T>`: the values are
 * builder functions keyed by type, not `{ id }` content definitions.
 */
export class ActionRegistry {
	private readonly builders = new Map<string, ActionBuilder>();

	/**
	 * Registers a builder for an action `type`. Throws on a blank or duplicate
	 * type (boot-time misconfiguration must fail loudly). This is the ONLY
	 * place action types become buildable.
	 */
	register(type: string, builder: ActionBuilder): void {
		if (!type || type.trim() === "") {
			throw new Error("[ActionRegistry] cannot register a blank action type");
		}
		if (this.builders.has(type)) {
			throw new Error(`[ActionRegistry] duplicate action type "${type}"`);
		}
		this.builders.set(type, builder);
	}

	has(type: string): boolean {
		return this.builders.has(type);
	}

	get(type: string): ActionBuilder | undefined {
		return this.builders.get(type);
	}
}

/** Registry of Condition-type builders (SPEC-008 "Conditions"). */
export class ConditionRegistry {
	private readonly builders = new Map<string, ConditionBuilder>();

	register(type: string, builder: ConditionBuilder): void {
		if (!type || type.trim() === "") {
			throw new Error(
				"[ConditionRegistry] cannot register a blank condition type",
			);
		}
		if (this.builders.has(type)) {
			throw new Error(`[ConditionRegistry] duplicate condition type "${type}"`);
		}
		this.builders.set(type, builder);
	}

	has(type: string): boolean {
		return this.builders.has(type);
	}

	get(type: string): ConditionBuilder | undefined {
		return this.builders.get(type);
	}
}

export interface ActionFactoryOptions {
	/** The engine composites run their children through (SPEC-008 "Composite"). */
	readonly engine?: ActionEngine;
	readonly logger?: TournamentLogger;
}

/**
 * Builds Actions (and their Conditions) from configuration (SPEC-008 "Action
 * Factory": "Construir Actions desde configuración. Nunca mediante código
 * manual"). `create` NEVER throws: unknown type or invalid config → logged +
 * `null` (Skip sentinel), which callers treat as "no Action" (SPEC-008 "Casos
 * límite").
 */
export class ActionFactory {
	private readonly actions: ActionRegistry;
	private readonly conditions: ConditionRegistry;
	private readonly engine?: ActionEngine;
	private readonly logger: TournamentLogger;

	constructor(
		actions: ActionRegistry,
		conditions: ConditionRegistry,
		options: ActionFactoryOptions = {},
	) {
		this.actions = actions;
		this.conditions = conditions;
		this.engine = options.engine;
		this.logger =
			options.logger?.child("ActionFactory") ??
			new TournamentLogger({ tournamentId: "-", system: "ActionFactory" });
	}

	/**
	 * Builds an Action from its config, or returns `null` when it cannot be
	 * built safely (SPEC-008 "Casos límite"). A condition that fails to build is
	 * dropped (logged) rather than failing the whole action — a missing gate is
	 * safer than a crash; the action still runs its remaining conditions.
	 */
	create(config: ActionConfig): IAction | null {
		if (!config || typeof config.type !== "string" || config.type.trim() === "") {
			this.logger.warn("create: invalid action config (missing type); skipped", {
				metadata: { config: this.describe(config) },
			});
			return null;
		}

		const builder = this.actions.get(config.type);
		if (!builder) {
			this.logger.warn(`create: unknown action type "${config.type}"; skipped`);
			return null;
		}

		const conditions: ICondition[] = [];
		for (const conditionConfig of config.conditions ?? []) {
			const condition = this.createCondition(conditionConfig);
			if (condition) {
				conditions.push(condition);
			}
		}

		try {
			return builder({
				type: config.type,
				parameters: config.parameters ?? {},
				conditions,
				metadata: config.metadata,
				priority: config.priority,
				factory: this,
				engine: this.engine,
			});
		} catch (error) {
			// A builder should never throw, but if it does the tournament must
			// not stop (SPEC-008 "Casos límite": Configuración inválida → Skip).
			this.logger.error(
				`create: builder for "${config.type}" threw; skipped`,
				{
					metadata: {
						error: error instanceof Error ? error.message : String(error),
					},
				},
			);
			return null;
		}
	}

	/** Builds a Condition from its config, or `null` (logged) if unbuildable. */
	createCondition(config: ConditionConfig): ICondition | null {
		if (!config || typeof config.type !== "string" || config.type.trim() === "") {
			this.logger.warn("createCondition: invalid condition config; dropped", {
				metadata: { config: this.describe(config) },
			});
			return null;
		}
		const builder = this.conditions.get(config.type);
		if (!builder) {
			this.logger.warn(
				`createCondition: unknown condition type "${config.type}"; dropped`,
			);
			return null;
		}
		try {
			return builder(config.parameters ?? {});
		} catch (error) {
			this.logger.error(
				`createCondition: builder for "${config.type}" threw; dropped`,
				{
					metadata: {
						error: error instanceof Error ? error.message : String(error),
					},
				},
			);
			return null;
		}
	}

	/** JSON-safe, truncation-tolerant description of a config for logs. */
	private describe(config: unknown): unknown {
		try {
			return JSON.parse(JSON.stringify(config ?? null));
		} catch {
			return String(config);
		}
	}
}
