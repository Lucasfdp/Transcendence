/**
 * configured-rule.ts — the v1 rule type, constructed from CONFIGURATION.
 *
 * SPEC-009 "Configuración": every rule must be constructable from configuration
 * / data, NEVER via bespoke code paths. Because v1's whole rule surface is the
 * five fixed consultation points with simple value/boolean effects, ONE
 * configuration-driven class covers all of them — a Lucky Dice (+2), a Double
 * Dice (×2), an active-dice OVERRIDE, Half Points, Free Shop and NoSteal are
 * all just different `RuleConfig` records. New concrete rule *types* are added
 * as content demands (SPEC-009 "Alcance v1"), not by subclassing here.
 *
 * Statefulness (lifecycle + duration counters) lives on the instance; the
 * frozen `RuleConfig` is only read, never mutated.
 */

import {
	IRule,
	RuleComposition,
	RuleConsultationPoint,
	RuleContext,
	RuleDescriptor,
	RuleDuration,
	RuleLifecycleState,
	RuleValueOp,
	SerializedRule,
} from "./rule.interface";

/**
 * Data record a rule is built from (SPEC-009 "Las reglas son datos"). Stored
 * frozen in the definition Registry; the engine builds a fresh stateful
 * `ConfiguredRule` per activation.
 */
export interface RuleConfig {
	readonly id: string;
	readonly priority: number;
	readonly point: RuleConsultationPoint;
	readonly composition: RuleComposition;
	readonly duration: RuleDuration;
	/** Value operation for `dice`/`price`/`reward` (and dice OVERRIDE). */
	readonly value?: RuleValueOp;
	/** Asserted boolean for `steal`/`flag` points (defaults to true). */
	readonly boolean?: boolean;
	/** Flag name — REQUIRED when `point === "flag"`. */
	readonly flag?: string;
	/** Optional player binding (Turns scoping / targeting). */
	readonly playerId?: number | null;
}

const VALUE_POINTS: readonly RuleConsultationPoint[] = ["dice", "price", "reward"];
const BOOLEAN_POINTS: readonly RuleConsultationPoint[] = ["steal", "flag"];

/**
 * A single active modifier built from `RuleConfig` (SPEC-009). Implements the
 * full `IRule` v1 contract: descriptor, value/boolean effect, lifecycle and
 * duration bookkeeping.
 */
export class ConfiguredRule implements IRule {
	private readonly _id: string;
	private readonly _priority: number;
	private readonly _point: RuleConsultationPoint;
	private readonly _composition: RuleComposition;
	private readonly _duration: RuleDuration;
	private readonly _value: RuleValueOp | null;
	private readonly _boolean: boolean | null;
	private readonly _flag: string | null;
	private readonly _target: number | null;

	private _state: RuleLifecycleState = "Registered";
	private _remainingRounds: number | null = null;
	private _remainingTurns: number | null = null;

	constructor(config: RuleConfig) {
		this._id = config.id;
		this._priority = config.priority;
		this._point = config.point;
		this._composition = config.composition;
		this._duration = config.duration;
		this._value = config.value ?? null;
		this._flag = config.flag ?? null;
		this._target = config.playerId ?? null;
		this._boolean = BOOLEAN_POINTS.includes(config.point)
			? config.boolean ?? true
			: null;
	}

	id(): string {
		return this._id;
	}

	priority(): number {
		return this._priority;
	}

	isActive(): boolean {
		return this._state === "Running";
	}

	lifecycleState(): RuleLifecycleState {
		return this._state;
	}

	descriptor(): RuleDescriptor {
		return this._flag !== null
			? { point: this._point, composition: this._composition, flag: this._flag }
			: { point: this._point, composition: this._composition };
	}

	duration(): RuleDuration {
		return this._duration;
	}

	targetPlayerId(): number | null {
		return this._target;
	}

	/**
	 * SPEC-009 `validate()`: pure coherence check of the configured shape. Never
	 * throws (SPEC-009 "Casos límite": problems are logged, flow continues).
	 */
	validate(_ctx?: RuleContext): string[] {
		const issues: string[] = [];
		if (!this._id || this._id.trim() === "") {
			issues.push("rule id must be a non-empty string");
		}
		if (!Number.isFinite(this._priority)) {
			issues.push("priority must be a finite number");
		}

		const isValuePoint = VALUE_POINTS.includes(this._point);
		const isBooleanPoint = BOOLEAN_POINTS.includes(this._point);

		if (isValuePoint) {
			if (!this._value) {
				issues.push(`value point "${this._point}" requires a value operation`);
			} else if (this._composition === "exclusive" && this._value.kind !== "set") {
				issues.push(
					`exclusive value point "${this._point}" requires a "set" operation`,
				);
			} else if (this._composition === "value" && this._value.kind === "set") {
				issues.push(
					`value modifier at "${this._point}" must use add/multiply, not set`,
				);
			}
		}

		if (isBooleanPoint) {
			if (this._composition !== "exclusive") {
				issues.push(`boolean point "${this._point}" must be exclusive`);
			}
			if (this._point === "flag" && !this._flag) {
				issues.push('flag rules require a "flag" name');
			}
		}

		if (this._duration.kind === "Turns" && !Number.isFinite(this._duration.turns)) {
			issues.push("Turns duration requires a finite turns count");
		}

		return issues;
	}

	/** SPEC-009 `apply()`: Registered/Inactive → Running (+ init counters). */
	apply(_ctx?: RuleContext): void {
		if (this._state !== "Registered" && this._state !== "Inactive") {
			return;
		}
		this._state = "Activated";
		if (this._duration.kind === "Round") {
			this._remainingRounds = this._duration.rounds ?? 1;
		} else if (this._duration.kind === "Turns") {
			this._remainingTurns = this._duration.turns;
		}
		this._state = "Running";
	}

	deactivate(): void {
		if (this._state === "Running") {
			this._state = "Inactive";
		}
	}

	expire(): void {
		if (this._state === "Running") {
			this._state = "Expired";
		}
	}

	remove(_ctx?: RuleContext): void {
		this._state = "Removed";
	}

	/** SPEC-009 "Modificadores de valor" / dice OVERRIDE (`set`). */
	evaluateValue(current: number, _ctx: RuleContext): number {
		if (!this._value) {
			return current;
		}
		switch (this._value.kind) {
			case "add":
				return current + this._value.amount;
			case "multiply":
				return current * this._value.factor;
			case "set":
				return this._value.value;
		}
	}

	/** SPEC-009 "Parámetros exclusivos" (boolean flags). */
	evaluateBoolean(_ctx: RuleContext): boolean {
		return this._boolean ?? false;
	}

	advanceRound(): boolean {
		if (this._state !== "Running" || this._duration.kind !== "Round") {
			return false;
		}
		if (this._remainingRounds === null) {
			return false;
		}
		this._remainingRounds -= 1;
		return this._remainingRounds <= 0;
	}

	consumeTurn(playerId?: number | null): boolean {
		if (this._state !== "Running" || this._duration.kind !== "Turns") {
			return false;
		}
		// Player-bound Turns rules only tick on their owner's turn.
		if (
			this._target !== null &&
			playerId !== undefined &&
			playerId !== null &&
			playerId !== this._target
		) {
			return false;
		}
		if (this._remainingTurns === null) {
			return false;
		}
		this._remainingTurns -= 1;
		return this._remainingTurns <= 0;
	}

	serialize(): SerializedRule {
		return {
			id: this._id,
			priority: this._priority,
			point: this._point,
			composition: this._composition,
			duration: this._duration,
			state: this._state,
			flag: this._flag,
			targetPlayerId: this._target,
			value: this._value,
			boolean: this._boolean,
			remainingRounds: this._remainingRounds,
			remainingTurns: this._remainingTurns,
		};
	}
}

/**
 * Factory (SPEC-009 "Configuración"): the ONLY way a rule is built — from data.
 * A fresh stateful instance is returned per call so the same frozen definition
 * can seed many independent activations.
 */
export function createRule(config: RuleConfig): ConfiguredRule {
	return new ConfiguredRule(config);
}
