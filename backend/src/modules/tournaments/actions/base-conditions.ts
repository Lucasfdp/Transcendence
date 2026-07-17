/**
 * base-conditions.ts — the v1 base Conditions (SPEC-008 "Conditions").
 *
 * A small set of deterministic, side-effect-free gates that exercise the
 * condition pipeline (SPEC-008 "Flujo": Conditions → ¿Todas OK? → Execute /
 * Skipped). They read ONLY the `ActionContext` (and, for the balance check,
 * the Economy read port) — never another system's internal state (SPEC-008
 * "Restricciones"). Registered as config-driven builders via
 * `registerBaseConditions`, never `new`-ed by gameplay code.
 *
 * Config `type` + `parameters`:
 *   - "alwaysTrue"      → {}                              (trivial gate)
 *   - "hasEnoughPoints" → { amount: number, playerId?: number }
 *   - "currentRoundIs"  → { round: number }
 *   - "minRound"        → { round: number }
 */

import {
	ActionContext,
	ICondition,
	SerializedCondition,
} from "./action.interface";
import { ConditionRegistry } from "./action-registry";

/** Reads a finite number from a params bag, or undefined when absent/invalid. */
const readNumber = (
	parameters: Readonly<Record<string, unknown>>,
	key: string,
): number | undefined => {
	const value = parameters[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

/**
 * AlwaysTrue — the trivial gate (SPEC-008 "Conditions"). Useful as a default
 * and to prove the condition pipeline runs.
 */
export class AlwaysTrueCondition implements ICondition {
	id(): string {
		return "alwaysTrue";
	}

	evaluate(): boolean {
		return true;
	}

	serialize(): SerializedCondition {
		return { type: "alwaysTrue" };
	}
}

/**
 * HasEnoughPoints (SPEC-008 "Conditions" example). Reads the balance through
 * the Economy read port (`getBalance`) — never the wallet's internals — and
 * checks it covers `amount`. An unknown wallet (undefined balance) fails
 * closed. Defaults to the acting player when `playerId` is omitted.
 */
export class HasEnoughPointsCondition implements ICondition {
	constructor(
		private readonly amount: number,
		private readonly playerId?: number,
	) {}

	id(): string {
		return "hasEnoughPoints";
	}

	evaluate(ctx: ActionContext): boolean {
		const playerId = this.playerId ?? ctx.playerId;
		const balance = ctx.services.economy.getBalance(playerId);
		return typeof balance === "number" && balance >= this.amount;
	}

	serialize(): SerializedCondition {
		return {
			type: "hasEnoughPoints",
			parameters:
				this.playerId === undefined
					? { amount: this.amount }
					: { amount: this.amount, playerId: this.playerId },
		};
	}
}

/** CurrentRoundIs (SPEC-008 "Conditions": CurrentRound) — exact round match. */
export class CurrentRoundIsCondition implements ICondition {
	constructor(private readonly round: number) {}

	id(): string {
		return "currentRoundIs";
	}

	evaluate(ctx: ActionContext): boolean {
		return ctx.round === this.round;
	}

	serialize(): SerializedCondition {
		return { type: "currentRoundIs", parameters: { round: this.round } };
	}
}

/** MinRound (SPEC-008 "Conditions": CurrentRound) — gate opens from `round` on. */
export class MinRoundCondition implements ICondition {
	constructor(private readonly round: number) {}

	id(): string {
		return "minRound";
	}

	evaluate(ctx: ActionContext): boolean {
		return ctx.round >= this.round;
	}

	serialize(): SerializedCondition {
		return { type: "minRound", parameters: { round: this.round } };
	}
}

/**
 * Registers every base condition builder (SPEC-008 "Conditions"). Invalid
 * parameters throw at BUILD time inside the builder; the factory catches that
 * and drops the condition (logged) rather than crashing (SPEC-008 "Casos
 * límite").
 */
export function registerBaseConditions(registry: ConditionRegistry): void {
	registry.register("alwaysTrue", () => new AlwaysTrueCondition());

	registry.register("hasEnoughPoints", (parameters) => {
		const amount = readNumber(parameters, "amount");
		if (amount === undefined) {
			throw new Error("hasEnoughPoints requires a numeric `amount`");
		}
		return new HasEnoughPointsCondition(amount, readNumber(parameters, "playerId"));
	});

	registry.register("currentRoundIs", (parameters) => {
		const round = readNumber(parameters, "round");
		if (round === undefined) {
			throw new Error("currentRoundIs requires a numeric `round`");
		}
		return new CurrentRoundIsCondition(round);
	});

	registry.register("minRound", (parameters) => {
		const round = readNumber(parameters, "round");
		if (round === undefined) {
			throw new Error("minRound requires a numeric `round`");
		}
		return new MinRoundCondition(round);
	});
}
