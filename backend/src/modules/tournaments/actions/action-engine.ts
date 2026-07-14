/**
 * action-engine.ts — the single Action Engine (SPEC-008).
 *
 * The ONE execution engine through which every Tournament behaviour runs
 * (SPEC-008 "Objetivo": "Existe un único motor de ejecución. No existirán
 * motores separados"). It drives the fixed pipeline for one Action:
 *
 *   conditions  →  validate()  →  execute()   (SPEC-008 "Pipeline"/"Flujo")
 *
 * and guarantees the two load-bearing invariants of SPEC-008 "Casos límite":
 *   • an Action NEVER throws out of `execute()` — any thrown error is caught,
 *     logged and turned into a `failed` result (the tournament never stops);
 *   • a condition that is not met SKIPS the Action without executing it.
 *
 * Automatic logging (SPEC-008 "Logging"): every run emits Start / Finish /
 * Duration / Result / Errors. Duration is measured with the injected
 * `TournamentClock` only — never `Date.now` (SPEC-028 determinism). The engine
 * is reusable across game modes (SPEC-008 acceptance criteria) and knows no
 * concrete system — only the `IAction`/`ActionContext` contracts.
 */

import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import {
	ActionContext,
	ExecutionResult,
	IAction,
	failedResult,
	skippedResult,
} from "./action.interface";

export interface ActionEngineOptions {
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
}

export class ActionEngine {
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;

	constructor(options: ActionEngineOptions) {
		this.clock = options.clock;
		this.logger =
			options.logger?.child("ActionEngine") ??
			new TournamentLogger({ tournamentId: "-", system: "ActionEngine" });
	}

	/**
	 * Runs one Action through the full pipeline and returns its real result
	 * (SPEC-008 "Pipeline"). This method NEVER throws: a thrown error anywhere
	 * in conditions/validate/execute becomes a logged `failed` result so the
	 * tournament keeps going (SPEC-008 "Casos límite": Error interno → Log →
	 * Continuar. Nunca detener Tournament).
	 */
	execute(action: IAction, ctx: ActionContext): ExecutionResult {
		const actionId = this.safeId(action);
		const startedAt = this.clock.now();
		// SPEC-008 "Logging": Start.
		this.logger.debug(`Action start: ${actionId}`, {
			playerId: ctx.playerId,
			metadata: { tournamentId: ctx.tournamentId, round: ctx.round },
		});

		let result: ExecutionResult;
		try {
			result = this.runPipeline(action, ctx);
		} catch (error) {
			// SPEC-008 "Logging": Errors + "Casos límite": Error interno → Log.
			this.logger.error(`Action error: ${actionId}`, {
				playerId: ctx.playerId,
				metadata: {
					error: error instanceof Error ? error.message : String(error),
				},
			});
			result = failedResult(`Action "${actionId}" threw during execution`, error);
		}

		const durationMs = this.clock.now() - startedAt;
		// SPEC-008 "Logging": Finish + Duration + Result.
		this.logger.debug(`Action finish: ${actionId}`, {
			playerId: ctx.playerId,
			metadata: {
				status: result.status,
				durationMs,
				reason: result.status === "success" ? undefined : result.reason,
			},
		});
		return result;
	}

	/**
	 * The ordered pipeline (SPEC-008 "Flujo"). Conditions first: any false →
	 * `skipped`, `execute()` is never reached. Then `validate()`: a non-success
	 * outcome is returned as-is. Only a passing validate reaches `execute()`.
	 * Throws propagate to `execute()`'s catch (→ `failed`).
	 */
	private runPipeline(action: IAction, ctx: ActionContext): ExecutionResult {
		const conditions = action.conditions?.() ?? [];
		for (const condition of conditions) {
			// A condition throwing is an internal error (→ caught → failed),
			// NOT a silent skip: only a clean `false` skips (SPEC-008 "Flujo").
			if (!condition.evaluate(ctx)) {
				return skippedResult(
					`condition "${this.safeConditionId(condition)}" not met`,
				);
			}
		}

		const outcome = action.validate(ctx);
		if (outcome.status !== "success") {
			// validate() may SKIP or FAIL (SPEC-008 "Validation").
			return outcome;
		}

		return action.execute(ctx);
	}

	private safeId(action: IAction): string {
		try {
			return action.id();
		} catch {
			return "<unknown-action>";
		}
	}

	private safeConditionId(condition: {
		id(): string;
	}): string {
		try {
			return condition.id();
		} catch {
			return "<unknown-condition>";
		}
	}
}
