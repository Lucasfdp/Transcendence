/**
 * rule.interface.ts — the v1 Game Rules Engine contract (SPEC-009).
 *
 * SPEC-009 "Alcance v1": v1 is NOT a generic rules engine. It is a set of
 * active modifiers with exactly FIVE fixed consultation points (dice, price,
 * reward, steal, flag), four durations (Permanent, Round, Turns, UntilRemoved)
 * and a simple numeric priority. This file defines the `IRule` contract, the
 * rule context, the value-operation shape and the lifecycle/duration types
 * every active rule obeys. The catalog of concrete rule *types* is intentionally
 * a single configuration-driven class (see configured-rule.ts); it grows only
 * when content demands it (SPEC-009 "el catálogo ... crece solo cuando el
 * contenido lo exija").
 *
 * `IRule` extends the bare SPEC-009 "Interface" list (id/priority/isActive/
 * validate/apply/remove/serialize) with the v1 consultation surface
 * (`descriptor`, `evaluateValue`, `evaluateBoolean`) and the Runtime-driven
 * duration hooks (`advanceRound`, `consumeTurn`) — these are the concrete
 * shape the five fixed consultation points and the four v1 durations require.
 */

import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	RuleComposition,
	RuleConsultationPoint,
} from "../events/tournament-event.types";

export { RuleComposition, RuleConsultationPoint };

/**
 * The lifecycle a rule walks (SPEC-009 "Ciclo de vida"):
 * Registered → Inactive → Activated → Running → Expired → Removed.
 * `Activated` is a transient step of `apply()`; a rule at rest is either
 * `Registered`/`Inactive` (not consulted) or `Running` (consulted).
 */
export type RuleLifecycleState =
	| "Registered"
	| "Inactive"
	| "Activated"
	| "Running"
	| "Expired"
	| "Removed";

/**
 * v1 durations (SPEC-009 "Alcance v1"). Seconds/BossPhase/FinalChallenge are
 * FUTURE direction and deliberately absent.
 * - Permanent / UntilRemoved: infinite — allowed as long as explicit
 *   (SPEC-009 "Casos límite": Rule infinita → Permitido).
 * - Round: expires after `rounds` round advances (default 1: the current round).
 * - Turns: expires after `turns` turn consumptions.
 */
export type RuleDuration =
	| { readonly kind: "Permanent" }
	| { readonly kind: "UntilRemoved" }
	| { readonly kind: "Round"; readonly rounds?: number }
	| { readonly kind: "Turns"; readonly turns: number };

/**
 * The data-only operation a value rule applies to a consulted number
 * (SPEC-009 "Las reglas son datos"). `set` is how an exclusive dice OVERRIDE
 * replaces the base roll; `add`/`multiply` are the stacking value modifiers.
 */
export type RuleValueOp =
	| { readonly kind: "add"; readonly amount: number }
	| { readonly kind: "multiply"; readonly factor: number }
	| { readonly kind: "set"; readonly value: number };

/**
 * A rule's immutable identity at its consultation point (SPEC-009 "Consulta"):
 * which of the five points it modifies and how it composes there.
 */
export interface RuleDescriptor {
	readonly point: RuleConsultationPoint;
	readonly composition: RuleComposition;
	/** Present only for `point === "flag"` — the flag name it answers for. */
	readonly flag?: string;
}

/**
 * Rule Context (SPEC-009 "Rule Context"). Only fields meaningful in v1 are
 * required; `board`/`runtime`/`inventory` are declared but OMITTED (typed as
 * `unknown`) — those systems do not exist yet and v1 rules never read them.
 * Passed by the querying system on every consultation.
 */
export interface RuleContext {
	readonly tournamentId: string;
	readonly round: number;
	/** Player the consultation is about, or null for tournament-wide queries. */
	readonly playerId?: number | null;
	readonly eventBus: TournamentEventBus;
	readonly metadata?: Readonly<Record<string, unknown>>;
	/** v1-omitted (future): the Board system is out of scope. */
	readonly board?: unknown;
	/** v1-omitted (future): rules never call the Runtime back. */
	readonly runtime?: unknown;
	/** v1-omitted (future): the Inventory system is out of scope. */
	readonly inventory?: unknown;
}

/** JSON-safe snapshot of one rule (SPEC-009 `serialize()`). */
export interface SerializedRule {
	readonly id: string;
	readonly priority: number;
	readonly point: RuleConsultationPoint;
	readonly composition: RuleComposition;
	readonly duration: RuleDuration;
	readonly state: RuleLifecycleState;
	/** Flag name for flag rules, else null. */
	readonly flag: string | null;
	/** Player the rule is bound to (Turns scoping / targeting), else null. */
	readonly targetPlayerId: number | null;
	/** Value operation for value/override rules, else null. */
	readonly value: RuleValueOp | null;
	/** Asserted boolean for steal/flag rules, else null. */
	readonly boolean: boolean | null;
	/** Remaining rounds for a Round rule while Running, else null. */
	readonly remainingRounds: number | null;
	/** Remaining turns for a Turns rule while Running, else null. */
	readonly remainingTurns: number | null;
}

/**
 * IRule — a single active modifier (SPEC-009 "Interface"/"Definición"). A rule
 * represents a temporary modification of game behaviour, never business logic.
 * Rules never call other modules, never contain UI/Networking/render/Boss
 * logic (SPEC-009 "Restricciones").
 *
 * Instances are STATEFUL (lifecycle + duration counters) and therefore never
 * live in the deep-freezing content Registry — they live in the engine's own
 * mutable collection.
 */
export interface IRule {
	/** Stable unique id; also the deterministic priority tie-breaker. */
	id(): string;
	/** Numeric priority (SPEC-009 "Prioridad": higher wins for exclusives). */
	priority(): number;
	/** True only while `Running` (the sole state the engine consults). */
	isActive(): boolean;
	/** Current lifecycle state (SPEC-009 "Ciclo de vida"). */
	lifecycleState(): RuleLifecycleState;
	/** Consultation-point identity (SPEC-009 "Consulta"). */
	descriptor(): RuleDescriptor;
	/** Configured duration (SPEC-009 "Duración"). */
	duration(): RuleDuration;
	/** Player this rule is bound to (Turns scoping / targeting), or null. */
	targetPlayerId(): number | null;

	/**
	 * Coherence check against the context (SPEC-009 `validate()`). Returns a
	 * list of human-readable problems; empty means valid. Never throws.
	 */
	validate(ctx?: RuleContext): string[];
	/**
	 * Activation hook (SPEC-009 `apply()`): Registered/Inactive → Running,
	 * initialising the duration counters. No-op from any other state.
	 */
	apply(ctx?: RuleContext): void;
	/** Running → Inactive (temporarily suspended, may be re-activated). */
	deactivate(): void;
	/** Running → Expired (a bounded duration elapsed). */
	expire(): void;
	/** Removal hook (SPEC-009 `remove()`): any state → Removed. */
	remove(ctx?: RuleContext): void;

	/**
	 * Applies this rule's value operation to `current` (SPEC-009 "Modificadores
	 * de valor"). For a value modifier it stacks (add/multiply); for an
	 * exclusive dice override it replaces (`set`). Non-numeric points return
	 * `current` unchanged.
	 */
	evaluateValue(current: number, ctx: RuleContext): number;
	/**
	 * Resolves this rule's boolean assertion (SPEC-009 "Parámetros
	 * exclusivos": NoSteal, FreeShop, ...). Numeric points return false.
	 */
	evaluateBoolean(ctx: RuleContext): boolean;

	/**
	 * Runtime-driven duration hook (SPEC-009 "Duración: Round"). Decrements a
	 * Round rule; returns true when it has just expired. No-op (false) for
	 * other durations or when not Running. The Runtime — not this engine —
	 * decides WHEN a round advances and calls the engine hook that fans out
	 * here.
	 */
	advanceRound(): boolean;
	/**
	 * Runtime-driven duration hook (SPEC-009 "Duración: Turns"). Decrements a
	 * Turns rule; returns true when it has just expired. When the rule is bound
	 * to a player, only that player's turn decrements it. No-op (false)
	 * otherwise.
	 */
	consumeTurn(playerId?: number | null): boolean;

	/** JSON-safe snapshot sufficient to describe the rule (SPEC-009). */
	serialize(): SerializedRule;
}
