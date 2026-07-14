/**
 * tournament-rule-engine.ts — the per-tournament Game Rules Engine (SPEC-009,
 * v1).
 *
 * One instance per tournament. Holds the ACTIVE rules (a mutable collection —
 * never the deep-freezing content Registry), drives their lifecycle
 * (Registered → Inactive → Activated → Running → Expired → Removed), and
 * answers the FIVE fixed consultation points (SPEC-009 "Alcance v1"). Systems
 * ask "is there a rule that modifies this?" — never "is the Boss active?"
 * (SPEC-009 "Filosofía"/"Consulta"). It is NOT wired into the Runtime here;
 * the architect wires the duration hooks and query calls later.
 *
 * Determinism (SPEC-028): no `Math.random`, no `Date.now`. Time comes only from
 * the injected TournamentClock; composition ties break deterministically by
 * rule id, never by registration/execution order (SPEC-009 "Prioridad y
 * composición": "Nunca comportamiento indefinido").
 */

import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	RuleConsultationPoint,
	RuleExpiryReason,
	RuleRemovalReason,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import { IRule, RuleContext, SerializedRule } from "./rule.interface";

/** The four events the Rule Engine owns (SPEC-009 "Eventos"). */
type RuleEventName = "RuleActivated" | "RuleUpdated" | "RuleExpired" | "RuleRemoved";

export interface TournamentRuleEngineOptions {
	readonly tournamentId: string;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	/** Lets events/queries carry the live round; defaults to 0. */
	readonly getRound?: () => number;
}

/** JSON-safe engine snapshot sufficient to restore active rules later. */
export interface SerializedRuleEngine {
	readonly tournamentId: string;
	readonly rules: readonly SerializedRule[];
}

export class TournamentRuleEngine {
	private readonly tournamentId: string;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly getRound: () => number;

	/**
	 * The active/registered rule instances — the SEPARATE mutable collection
	 * (SPEC-009): stateful rules never live in the deep-freezing Registry.
	 * Removed/expired rules are dropped from this map.
	 */
	private readonly rules = new Map<string, IRule>();

	constructor(options: TournamentRuleEngineOptions) {
		this.tournamentId = options.tournamentId;
		this.bus = options.bus;
		this.clock = options.clock;
		this.getRound = options.getRound ?? ((): number => 0);
		this.logger =
			options.logger ??
			new TournamentLogger({
				tournamentId: this.tournamentId,
				system: "RuleEngine",
			});
	}

	// ── Registration & lifecycle ─────────────────────────────────────────────

	/**
	 * Registers a rule instance (state stays `Registered`; not yet consulted).
	 * Duplicate id → logged and ignored (SPEC-009 "Casos límite": log +
	 * continue, never throw). Returns whether it was registered.
	 */
	register(rule: IRule): boolean {
		const id = rule.id();
		if (this.rules.has(id)) {
			this.logger.warn(`register: rule "${id}" already exists; ignored`);
			return false;
		}
		this.rules.set(id, rule);
		return true;
	}

	/**
	 * Activates a registered rule (Registered/Inactive → Running) and emits
	 * RuleActivated. Missing rule or failed `validate()` → logged and skipped
	 * (no throw). Returns whether the rule is now active.
	 */
	activate(id: string, ctx?: Partial<RuleContext>): boolean {
		const rule = this.rules.get(id);
		if (!rule) {
			this.logger.warn(`activate: unknown rule "${id}"; ignored`);
			return false;
		}
		const context = this.context(ctx);
		const issues = rule.validate(context);
		if (issues.length > 0) {
			this.logger.warn(
				`activate: rule "${id}" failed validation; not activated`,
				{ metadata: { issues } },
			);
			return false;
		}
		rule.apply(context);
		if (!rule.isActive()) {
			this.logger.warn(
				`activate: rule "${id}" did not become active (state ${rule.lifecycleState()})`,
			);
			return false;
		}
		const descriptor = rule.descriptor();
		this.emit(
			"RuleActivated",
			{
				ruleId: id,
				priority: rule.priority(),
				point: descriptor.point,
				composition: descriptor.composition,
				durationKind: rule.duration().kind,
				...(descriptor.flag !== undefined ? { flag: descriptor.flag } : {}),
			},
			rule.targetPlayerId(),
		);
		return true;
	}

	/** Convenience: register a rule and immediately activate it. */
	registerAndActivate(rule: IRule, ctx?: Partial<RuleContext>): boolean {
		return this.register(rule) && this.activate(rule.id(), ctx);
	}

	/**
	 * Suspends an active rule (Running → Inactive) and emits RuleUpdated.
	 * Missing rule → logged and ignored. Returns whether it was deactivated.
	 */
	deactivate(id: string): boolean {
		const rule = this.rules.get(id);
		if (!rule) {
			this.logger.warn(`deactivate: unknown rule "${id}"; ignored`);
			return false;
		}
		if (!rule.isActive()) {
			return false;
		}
		rule.deactivate();
		this.emit(
			"RuleUpdated",
			{
				ruleId: id,
				priority: rule.priority(),
				durationKind: rule.duration().kind,
				change: "deactivated",
			},
			rule.targetPlayerId(),
		);
		return true;
	}

	/**
	 * Removes a rule from the active set (any state → Removed) and emits
	 * RuleRemoved. Missing rule → logged and ignored (SPEC-009 "Casos límite").
	 * Returns whether it existed.
	 */
	remove(id: string, reason: RuleRemovalReason = "manual"): boolean {
		const rule = this.rules.get(id);
		if (!rule) {
			this.logger.warn(`remove: unknown rule "${id}"; ignored`);
			return false;
		}
		const priority = rule.priority();
		const target = rule.targetPlayerId();
		rule.remove(this.context());
		this.rules.delete(id);
		this.emit("RuleRemoved", { ruleId: id, priority, reason }, target);
		return true;
	}

	// ── Duration advance hooks (driven by the Runtime, not this engine) ──────

	/**
	 * SPEC-009 "Duración: Round". The Runtime calls this when a round advances;
	 * every Running Round rule ticks and any that reach zero EXPIRE (RuleExpired
	 * then transition to Removed). This engine never decides when a round
	 * advances — it only reacts.
	 */
	onRoundAdvanced(): void {
		for (const rule of [...this.rules.values()]) {
			if (rule.advanceRound()) {
				this.expireRule(rule, "Round");
			}
		}
	}

	/**
	 * SPEC-009 "Duración: Turns". The Runtime calls this when a turn is
	 * consumed; every Running Turns rule ticks (player-bound rules only on their
	 * owner's turn) and any that reach zero EXPIRE. `playerId` identifies whose
	 * turn was consumed (omit for a global tick).
	 */
	onTurnConsumed(playerId?: number | null): void {
		for (const rule of [...this.rules.values()]) {
			if (rule.consumeTurn(playerId)) {
				this.expireRule(rule, "Turns");
			}
		}
	}

	private expireRule(rule: IRule, reason: RuleExpiryReason): void {
		const id = rule.id();
		const priority = rule.priority();
		const target = rule.targetPlayerId();
		rule.expire();
		this.emit("RuleExpired", { ruleId: id, priority, reason }, target);
		rule.remove(this.context());
		this.rules.delete(id);
	}

	// ── Consultation points (SPEC-009 "Alcance v1": the FIVE fixed points) ───

	/**
	 * DiceModifier (SPEC-009). An active-dice OVERRIDE (exclusive) replaces the
	 * base roll first — highest priority wins, only ONE applies; then every
	 * value DiceModifier stacks in descending priority (SPEC-009 example: Lucky
	 * Dice +2 and Double Dice ×2 both apply). Resolved ambiguity: dice mixes an
	 * exclusive override and value modifiers at the same point, so the override
	 * is applied as the base a value modifier then stacks on.
	 */
	queryDiceModifier(ctx: RuleContext, baseValue: number): number {
		return this.resolveValue("dice", baseValue, ctx);
	}

	/** PriceModifier (SPEC-009): value modifiers stack in descending priority. */
	queryPriceModifier(ctx: RuleContext, basePrice: number): number {
		return this.resolveValue("price", basePrice, ctx);
	}

	/** RewardMultiplier (SPEC-009): value modifiers stack in descending priority. */
	queryRewardMultiplier(ctx: RuleContext, baseAmount: number): number {
		return this.resolveValue("reward", baseAmount, ctx);
	}

	/** StealPrevention (SPEC-009): highest-priority steal rule decides; else false. */
	isStealPrevented(ctx: RuleContext): boolean {
		return this.resolveBoolean("steal", ctx);
	}

	/**
	 * Boolean Flags (SPEC-009, e.g. FreeShop/Fog): highest-priority rule for the
	 * named flag decides; absent → false.
	 */
	getFlag(ctx: RuleContext, flagName: string): boolean {
		return this.resolveBoolean("flag", ctx, flagName);
	}

	// ── Composition (SPEC-009 "Prioridad y composición") ─────────────────────

	private resolveValue(
		point: RuleConsultationPoint,
		base: number,
		ctx: RuleContext,
	): number {
		const rules = this.runningAt(point);
		let current = base;

		const exclusives = rules.filter(
			(r) => r.descriptor().composition === "exclusive",
		);
		if (exclusives.length > 0) {
			const winner = this.pickTop(exclusives);
			if (exclusives.length > 1) {
				this.warnConflict(point, exclusives, winner.id());
			}
			current = winner.evaluateValue(current, ctx);
		}

		const valueRules = rules
			.filter((r) => r.descriptor().composition === "value")
			.sort(this.byPriorityDescThenId);
		for (const rule of valueRules) {
			current = rule.evaluateValue(current, ctx);
		}
		return current;
	}

	private resolveBoolean(
		point: RuleConsultationPoint,
		ctx: RuleContext,
		flag?: string,
	): boolean {
		const rules = this.runningAt(point).filter(
			(r) => flag === undefined || r.descriptor().flag === flag,
		);
		if (rules.length === 0) {
			return false;
		}
		const winner = this.pickTop(rules);
		if (rules.length > 1) {
			this.warnConflict(point, rules, winner.id());
		}
		return winner.evaluateBoolean(ctx);
	}

	/** Running rules at a point (SPEC-009: only `Running` rules are consulted). */
	private runningAt(point: RuleConsultationPoint): IRule[] {
		const result: IRule[] = [];
		for (const rule of this.rules.values()) {
			if (rule.isActive() && rule.descriptor().point === point) {
				result.push(rule);
			}
		}
		return result;
	}

	/**
	 * Highest priority wins; ties break deterministically by lexicographic id
	 * (SPEC-009: "Empate de prioridad ... por id ... Nunca comportamiento
	 * indefinido").
	 */
	private pickTop(rules: readonly IRule[]): IRule {
		return [...rules].sort(this.byPriorityDescThenId)[0];
	}

	private readonly byPriorityDescThenId = (a: IRule, b: IRule): number => {
		if (b.priority() !== a.priority()) {
			return b.priority() - a.priority();
		}
		return a.id() < b.id() ? -1 : a.id() > b.id() ? 1 : 0;
	};

	private warnConflict(
		point: RuleConsultationPoint,
		competing: readonly IRule[],
		winnerId: string,
	): void {
		this.logger.warn(
			`conflict at "${point}": ${competing.length} exclusive rules compete; ` +
				`"${winnerId}" wins by priority`,
			{ metadata: { rules: competing.map((r) => r.id()) } },
		);
	}

	// ── Observation ──────────────────────────────────────────────────────────

	/** Read-only view of a rule's snapshot, or undefined if unknown. */
	getRule(id: string): SerializedRule | undefined {
		return this.rules.get(id)?.serialize();
	}

	/** True when a rule with this id is registered (any lifecycle state). */
	has(id: string): boolean {
		return this.rules.has(id);
	}

	/** JSON-safe snapshot of every rule the engine holds (SPEC-009 `serialize`). */
	serialize(): SerializedRuleEngine {
		return {
			tournamentId: this.tournamentId,
			rules: [...this.rules.values()].map((rule) => rule.serialize()),
		};
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/** Builds a full RuleContext from a caller partial, filling engine data. */
	private context(partial?: Partial<RuleContext>): RuleContext {
		return {
			tournamentId: this.tournamentId,
			round: partial?.round ?? this.getRound(),
			playerId: partial?.playerId ?? null,
			eventBus: this.bus,
			metadata: partial?.metadata,
			board: partial?.board,
			runtime: partial?.runtime,
			inventory: partial?.inventory,
		};
	}

	private emit<TName extends RuleEventName>(
		name: TName,
		payload: TournamentEventPayloadMap[TName],
		playerId: number | null = null,
	): void {
		const event = createTournamentEvent({
			name,
			tournamentId: this.tournamentId,
			round: this.getRound(),
			playerId,
			payload,
			timestamp: this.clock.now(),
		});
		this.bus.emit(event as AnyTournamentEvent);
	}
}
