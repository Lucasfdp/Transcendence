/**
 * base-actions.ts — the v1 base Actions (SPEC-008 "Reglas Fundamentales").
 *
 * Each Action is one atomic behaviour that drives ONLY the two owner systems
 * that already exist — Economy (SPEC-011) and the Rule Engine (SPEC-009) —
 * through the public capability ports in `ctx.services` (SPEC-008 "Comandos y
 * Eventos"/"Restricciones"). Facts (PointsAwarded, RuleActivated, …) are
 * emitted by those owner systems, NOT by the Action. Every `ExecutionResult`
 * MIRRORS the real command result: a rejected command is `failed`, never
 * `success` (SPEC-008 "Comandos y Eventos"). No Action throws out; no Action
 * reads UI/Networking/DB/another system's internals.
 *
 * All Actions are config-driven builders registered via `registerBaseActions`;
 * gameplay code never `new`s them (SPEC-008 "Action Registry").
 *
 * Config `type` + `parameters`:
 *   - "awardPoints"    → { amount: number, playerId?: number,
 *                          reason?: string, source?: EconomySource }
 *   - "removePoints"   → { amount: number, playerId?: number,
 *                          reason?: string, source?: EconomySource }
 *   - "transferPoints" → { amount: number, toPlayerId: number,
 *                          fromPlayerId?: number, reason?: string,
 *                          source?: EconomySource }
 *   - "activateRule"   → { ruleId: string }
 *   - "deactivateRule" → { ruleId: string }
 *   - "composite"      → { children: ActionConfig[] }
 *
 * `playerId`/`fromPlayerId` default to the acting `ctx.playerId`. `source`
 * defaults to "rule" (award/remove) or "steal" (transfer — its v1 consumer is
 * AttemptStealAction, SPEC-006); these are the SPEC-faithful defaults chosen
 * for the ambiguous "source" field and can always be overridden in config.
 */

import { EconomyResult, EconomySource } from "../economy/tournament-economy";
import { ActionEngine } from "./action-engine";
import {
	ActionBuildContext,
	ActionRegistry,
	ConditionRegistry,
} from "./action-registry";
import {
	ActionConfig,
	ActionContext,
	ExecutionOutcome,
	ExecutionResult,
	IAction,
	ICondition,
	SerializedAction,
	SerializedCondition,
	failedResult,
	skippedResult,
	successResult,
} from "./action.interface";
import { registerBaseConditions } from "./base-conditions";

// ── Param helpers ───────────────────────────────────────────────────────────

const readNumber = (
	parameters: Readonly<Record<string, unknown>>,
	key: string,
): number | undefined => {
	const value = parameters[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const readString = (
	parameters: Readonly<Record<string, unknown>>,
	key: string,
): string | undefined => {
	const value = parameters[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readSource = (
	parameters: Readonly<Record<string, unknown>>,
	fallback: EconomySource,
): EconomySource => (readString(parameters, "source") as EconomySource) ?? fallback;

/** JSON-safe snapshot of one condition (uses `serialize()` when present). */
const serializeCondition = (condition: ICondition): SerializedCondition =>
	condition.serialize?.() ?? { type: condition.id() };

/**
 * Mirrors an Economy command result into an ExecutionResult (SPEC-008
 * "Comandos y Eventos"): success → `success` (carrying the transaction id);
 * a rejection → `failed` (carrying the rejection reason) — NEVER `success`.
 */
const mirrorEconomy = (result: EconomyResult): ExecutionResult => {
	if (result.status === "success") {
		return successResult({
			transactionId: result.transaction.id,
			amount: result.transaction.amount,
		});
	}
	return failedResult(`economy rejected: ${result.rejection}`, undefined, {
		rejection: result.rejection,
	});
};

// ── Base action ───────────────────────────────────────────────────────────

/**
 * Shared plumbing for the base Actions (SPEC-008 "Interface"): stores the
 * config-derived identity/parameters/conditions and provides a default
 * `validate()` (SUCCESS) and a JSON-safe `serialize()`. `id()` is the
 * registered `type` in v1.
 */
export abstract class BaseAction implements IAction {
	protected readonly type: string;
	protected readonly parameters: Readonly<Record<string, unknown>>;
	private readonly _conditions: readonly ICondition[];
	protected readonly metadata?: Readonly<Record<string, unknown>>;
	protected readonly priority?: number;

	protected constructor(build: ActionBuildContext) {
		this.type = build.type;
		this.parameters = build.parameters;
		this._conditions = build.conditions;
		this.metadata = build.metadata;
		this.priority = build.priority;
	}

	id(): string {
		return this.type;
	}

	conditions(): readonly ICondition[] {
		return this._conditions;
	}

	validate(_ctx: unknown): ExecutionOutcome {
		return successResult();
	}

	abstract execute(ctx: ActionContext): ExecutionResult;

	serialize(): SerializedAction {
		const serialized: {
			type: string;
			parameters?: Readonly<Record<string, unknown>>;
			conditions?: readonly SerializedCondition[];
			metadata?: Readonly<Record<string, unknown>>;
			priority?: number;
		} = { type: this.type };
		if (Object.keys(this.parameters).length > 0) {
			serialized.parameters = this.parameters;
		}
		if (this._conditions.length > 0) {
			serialized.conditions = this._conditions.map(serializeCondition);
		}
		if (this.metadata !== undefined) {
			serialized.metadata = this.metadata;
		}
		if (this.priority !== undefined) {
			serialized.priority = this.priority;
		}
		return serialized;
	}
}

// ── Economy actions (SPEC-011 via ctx.services.economy) ─────────────────────

/**
 * AwardPoints (SPEC-008 "Ejemplos": AwardPoints → PointsAwarded). Drives
 * `economy.award`; the Economy emits the PointsAwarded fact. Result mirrors
 * the command (a rejected award ⇒ `failed`).
 */
export class AwardPointsAction extends BaseAction {
	private readonly amount?: number;
	private readonly reason: string;
	private readonly source: EconomySource;
	private readonly explicitPlayerId?: number;

	constructor(build: ActionBuildContext) {
		super(build);
		this.amount = readNumber(build.parameters, "amount");
		this.reason = readString(build.parameters, "reason") ?? "action:awardPoints";
		this.source = readSource(build.parameters, "rule");
		this.explicitPlayerId = readNumber(build.parameters, "playerId");
	}

	validate(): ExecutionOutcome {
		if (this.amount === undefined || this.amount < 0) {
			return failedResult("awardPoints requires a non-negative numeric `amount`");
		}
		return successResult();
	}

	execute(ctx: ActionContext): ExecutionResult {
		const playerId = this.explicitPlayerId ?? ctx.playerId;
		return mirrorEconomy(
			ctx.services.economy.award(playerId, this.amount, this.reason, this.source),
		);
	}
}

/** RemovePoints — drives `economy.remove`; result mirrors the command. */
export class RemovePointsAction extends BaseAction {
	private readonly amount?: number;
	private readonly reason: string;
	private readonly source: EconomySource;
	private readonly explicitPlayerId?: number;

	constructor(build: ActionBuildContext) {
		super(build);
		this.amount = readNumber(build.parameters, "amount");
		this.reason = readString(build.parameters, "reason") ?? "action:removePoints";
		this.source = readSource(build.parameters, "rule");
		this.explicitPlayerId = readNumber(build.parameters, "playerId");
	}

	validate(): ExecutionOutcome {
		if (this.amount === undefined || this.amount < 0) {
			return failedResult("removePoints requires a non-negative numeric `amount`");
		}
		return successResult();
	}

	execute(ctx: ActionContext): ExecutionResult {
		const playerId = this.explicitPlayerId ?? ctx.playerId;
		return mirrorEconomy(
			ctx.services.economy.remove(playerId, this.amount, this.reason, this.source),
		);
	}
}

/**
 * TransferPoints — drives `economy.transfer` (the base AttemptStealAction
 * builds on, SPEC-006). `fromPlayerId` defaults to the acting player; result
 * mirrors the command.
 */
export class TransferPointsAction extends BaseAction {
	private readonly amount?: number;
	private readonly toPlayerId?: number;
	private readonly reason: string;
	private readonly source: EconomySource;
	private readonly explicitFromPlayerId?: number;

	constructor(build: ActionBuildContext) {
		super(build);
		this.amount = readNumber(build.parameters, "amount");
		this.toPlayerId = readNumber(build.parameters, "toPlayerId");
		this.reason = readString(build.parameters, "reason") ?? "action:transferPoints";
		this.source = readSource(build.parameters, "steal");
		this.explicitFromPlayerId = readNumber(build.parameters, "fromPlayerId");
	}

	validate(): ExecutionOutcome {
		if (this.amount === undefined || this.amount < 0) {
			return failedResult(
				"transferPoints requires a non-negative numeric `amount`",
			);
		}
		if (this.toPlayerId === undefined) {
			return failedResult("transferPoints requires a numeric `toPlayerId`");
		}
		return successResult();
	}

	execute(ctx: ActionContext): ExecutionResult {
		const fromPlayerId = this.explicitFromPlayerId ?? ctx.playerId;
		return mirrorEconomy(
			ctx.services.economy.transfer(
				fromPlayerId,
				this.toPlayerId,
				this.amount,
				this.reason,
				this.source,
			),
		);
	}
}

// ── Rule actions (SPEC-009 via ctx.services.rules) ──────────────────────────

/**
 * ActivateRule (SPEC-009 "Integración con Action Engine"). Drives
 * `rules.activate`; the Rule Engine emits RuleActivated. A rejected activation
 * (unknown rule / failed validate) ⇒ `failed`.
 */
export class ActivateRuleAction extends BaseAction {
	private readonly ruleId?: string;

	constructor(build: ActionBuildContext) {
		super(build);
		this.ruleId = readString(build.parameters, "ruleId");
	}

	validate(): ExecutionOutcome {
		if (this.ruleId === undefined) {
			return failedResult("activateRule requires a non-empty `ruleId`");
		}
		return successResult();
	}

	execute(ctx: ActionContext): ExecutionResult {
		const activated = ctx.services.rules.activate(this.ruleId, {
			round: ctx.round,
			playerId: ctx.playerId,
		});
		return activated
			? successResult({ ruleId: this.ruleId })
			: failedResult(`rule "${this.ruleId}" was not activated`, undefined, {
					ruleId: this.ruleId,
			  });
	}
}

/**
 * DeactivateRule (SPEC-009). Drives `rules.deactivate`. A no-op (rule unknown
 * or already inactive) ⇒ `skipped` — a benign "nothing to do", not a failure.
 */
export class DeactivateRuleAction extends BaseAction {
	private readonly ruleId?: string;

	constructor(build: ActionBuildContext) {
		super(build);
		this.ruleId = readString(build.parameters, "ruleId");
	}

	validate(): ExecutionOutcome {
		if (this.ruleId === undefined) {
			return failedResult("deactivateRule requires a non-empty `ruleId`");
		}
		return successResult();
	}

	execute(ctx: ActionContext): ExecutionResult {
		const deactivated = ctx.services.rules.deactivate(this.ruleId);
		return deactivated
			? successResult({ ruleId: this.ruleId })
			: skippedResult(`rule "${this.ruleId}" was not active`, {
					ruleId: this.ruleId,
			  });
	}
}

// ── Inventory actions (SPEC-014 via ctx.services.inventory) ─────────────────

/**
 * GrantItem (SPEC-013 "ItemReward" → SPEC-014): places one Item instance in a
 * player's inventory via `ctx.services.inventory.add`. This is the real backing
 * for the Reward Resolver's `grantItem` forward-seam config. The Inventory emits
 * the ItemAdded fact; the result mirrors the command — a rejected add (full /
 * unknown definition / unknown player) ⇒ `failed`, never `success`. When no
 * Inventory service is wired the Action is `skipped` (a benign no-op), so a
 * grantItem in a context without inventory can never crash the tournament.
 *
 * Config `type` + `parameters`:
 *   - "grantItem" → { itemId: string, playerId?: number }
 * `playerId` defaults to the acting `ctx.playerId`.
 */
export class GrantItemAction extends BaseAction {
	private readonly itemId?: string;
	private readonly explicitPlayerId?: number;

	constructor(build: ActionBuildContext) {
		super(build);
		this.itemId = readString(build.parameters, "itemId");
		this.explicitPlayerId = readNumber(build.parameters, "playerId");
	}

	validate(): ExecutionOutcome {
		if (this.itemId === undefined) {
			return failedResult("grantItem requires a non-empty `itemId`");
		}
		return successResult();
	}

	execute(ctx: ActionContext): ExecutionResult {
		const inventory = ctx.services.inventory;
		if (!inventory) {
			return skippedResult("grantItem: no inventory service in context");
		}
		const playerId = this.explicitPlayerId ?? ctx.playerId;
		const result = inventory.add(playerId, this.itemId as string);
		return result.status === "added"
			? successResult({ itemId: this.itemId })
			: failedResult(
					`inventory rejected grantItem: ${result.reason ?? "unknown"}`,
					undefined,
					{ itemId: this.itemId, reason: result.reason },
			  );
	}
}

// ── Composite (SPEC-008 "Composite Actions") ────────────────────────────────

/**
 * CompositeAction (SPEC-008 "Composite Actions"): an ordered list of child
 * Actions run through the SAME engine as ONE Action.
 *
 * Child-failure policy (documented decision, no rollback in v1 — SPEC-008
 * "Rollback"): ALL children run in order (no short-circuit); the composite
 * aggregates to `failed` if ANY child failed, otherwise `success`. `skipped`
 * children are benign and do NOT fail the composite. The per-child statuses are
 * returned in `detail.children`.
 */
export class CompositeAction extends BaseAction {
	private readonly children: readonly IAction[];
	private readonly engine?: ActionEngine;

	constructor(build: ActionBuildContext) {
		super(build);
		this.engine = build.engine;
		const childConfigs = Array.isArray(build.parameters.children)
			? (build.parameters.children as ActionConfig[])
			: [];
		const children: IAction[] = [];
		for (const childConfig of childConfigs) {
			const child = build.factory.create(childConfig);
			// An unbuildable child is dropped (already logged by the factory),
			// mirroring the safe-skip policy (SPEC-008 "Casos límite").
			if (child) {
				children.push(child);
			}
		}
		this.children = children;
	}

	execute(ctx: ActionContext): ExecutionResult {
		if (!this.engine) {
			return failedResult("composite has no engine to run its children");
		}
		const statuses: string[] = [];
		let anyFailed = false;
		for (const child of this.children) {
			const result = this.engine.execute(child, ctx);
			statuses.push(result.status);
			if (result.status === "failed") {
				anyFailed = true;
			}
		}
		const detail = { children: statuses, count: this.children.length };
		return anyFailed
			? failedResult("one or more child actions failed", undefined, detail)
			: successResult(detail);
	}

	/** Reflects the BUILT children (not the raw config) in the snapshot. */
	serialize(): SerializedAction {
		const base = super.serialize();
		return {
			...base,
			parameters: {
				...(base.parameters ?? {}),
				children: this.children.map((child) => child.serialize()),
			},
		};
	}
}

// ── Registration (SPEC-008 "Action Registry") ──────────────────────────────

/**
 * Registers every base Action builder (SPEC-008 "Action Registry"). Builders
 * only construct; validation of parameters happens in each Action's
 * `validate()` so a bad-parameter Action fails cleanly at run time rather than
 * refusing to build (SPEC-008 "Validation").
 */
export function registerBaseActions(registry: ActionRegistry): void {
	registry.register("awardPoints", (build) => new AwardPointsAction(build));
	registry.register("removePoints", (build) => new RemovePointsAction(build));
	registry.register("transferPoints", (build) => new TransferPointsAction(build));
	registry.register("activateRule", (build) => new ActivateRuleAction(build));
	registry.register("deactivateRule", (build) => new DeactivateRuleAction(build));
	registry.register("composite", (build) => new CompositeAction(build));
}

/**
 * Registers the Inventory-driving Actions (SPEC-014). Kept SEPARATE from
 * `registerBaseActions` so the base set stays exactly the six economy/rule/
 * composite Actions: `grantItem` is only registered where an Inventory service
 * is actually wired into `ctx.services` (the F2 engine composition), so contexts
 * without an Inventory never expose an Action that has nothing to drive.
 */
export function registerInventoryActions(registry: ActionRegistry): void {
	registry.register("grantItem", (build) => new GrantItemAction(build));
}

/** Convenience: register every base Action AND base Condition in one call. */
export function registerBaseActionsAndConditions(
	actions: ActionRegistry,
	conditions: ConditionRegistry,
): void {
	registerBaseActions(actions);
	registerBaseConditions(conditions);
}
