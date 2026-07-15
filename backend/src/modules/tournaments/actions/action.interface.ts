/**
 * action.interface.ts — the Action Engine contracts (SPEC-008).
 *
 * This file is the frozen contract every Tournament behaviour obeys: there is
 * ONE execution engine and every behaviour is an `IAction` run through it
 * (SPEC-008 "Objetivo"/"Qué es una Action"). It defines the `IAction` /
 * `ICondition` interfaces (SPEC-008 "Interface"/"Conditions"), the canonical
 * `ActionContext` (SPEC-008 "Context"), the `ActionServices` capability ports
 * (architect ruling F2-4, dependency inversion), the `ExecutionResult`
 * discriminated union (SPEC-008 "Resultado" — Success | Skipped | Failed; NO
 * Retry/Delay/Parallel in v1) and the config-driven build shapes (SPEC-008
 * "Configuración"/"Action Factory").
 *
 * Determinism (SPEC-008 "Reglas Fundamentales"): nothing here reads a clock or
 * randomness. Actions never know UI/Networking/DB/Frontend/other modules; they
 * only touch the public contracts exposed in `ActionContext.services`
 * (SPEC-008 "Restricciones"). `rollback()` is deliberately absent (SPEC-008
 * "Rollback": out of v1).
 */

import { TournamentEventBus } from "../events/tournament-event-bus";
import { TournamentClock } from "../infra/clock";
import {
	EconomyResult,
	EconomySource,
} from "../economy/tournament-economy";
import { RuleConfig } from "../rules/configured-rule";
import { IRule, RuleContext } from "../rules/rule.interface";

// ── Execution result (SPEC-008 "Resultado") ────────────────────────────────

/** The three terminal states of an Action in v1 (Retry is out of scope). */
export type ExecutionStatus = "success" | "skipped" | "failed";

/**
 * Discriminated result of running an Action (SPEC-008 "Resultado": Success |
 * Skipped | Failed — Retry/Delay/Parallel are explicitly out of v1).
 * - `success`: the Action performed its single responsibility.
 * - `skipped`: a condition was not met or `validate()` chose to skip — the
 *   Action did NOT run (SPEC-008 "Flujo": conditions false → Skipped).
 * - `failed`: `validate()` rejected, a driven command was rejected (SPEC-008
 *   "Comandos y Eventos": a rejected command is FAILED/SKIPPED, never
 *   SUCCESS), or an internal error was caught (SPEC-008 "Casos límite": Error
 *   interno → Log → Continuar — the engine turns the throw into this value,
 *   it never propagates).
 *
 * `reason` is a human-readable explanation; `detail` is JSON-safe structured
 * data (e.g. the mirrored command result); `error` is the caught error's
 * message (a string, never an `Error` instance — keeps the result JSON-safe).
 */
export type ExecutionResult =
	| {
			readonly status: "success";
			readonly detail?: Readonly<Record<string, unknown>>;
	  }
	| {
			readonly status: "skipped";
			readonly reason: string;
			readonly detail?: Readonly<Record<string, unknown>>;
	  }
	| {
			readonly status: "failed";
			readonly reason: string;
			readonly error?: string;
			readonly detail?: Readonly<Record<string, unknown>>;
	  };

/**
 * What `validate()` returns (SPEC-008 "Validation": SUCCESS | FAILED |
 * SKIPPED, never throws). Structurally identical to `ExecutionResult`; only a
 * `success` outcome lets the engine proceed to `execute()`.
 */
export type ExecutionOutcome = ExecutionResult;

/** Builds a `success` result (SPEC-008 "Resultado"). */
export const successResult = (
	detail?: Readonly<Record<string, unknown>>,
): ExecutionResult => (detail ? { status: "success", detail } : { status: "success" });

/** Builds a `skipped` result (SPEC-008 "Flujo": condition false → Skipped). */
export const skippedResult = (
	reason: string,
	detail?: Readonly<Record<string, unknown>>,
): ExecutionResult =>
	detail ? { status: "skipped", reason, detail } : { status: "skipped", reason };

/**
 * Builds a `failed` result (SPEC-008 "Casos límite"). `error` is normalised to
 * a message string so the result stays JSON-safe — the raw `Error` is never
 * carried through.
 */
export const failedResult = (
	reason: string,
	error?: unknown,
	detail?: Readonly<Record<string, unknown>>,
): ExecutionResult => {
	const result: {
		status: "failed";
		reason: string;
		error?: string;
		detail?: Readonly<Record<string, unknown>>;
	} = { status: "failed", reason };
	if (error !== undefined) {
		result.error = error instanceof Error ? error.message : String(error);
	}
	if (detail) {
		result.detail = detail;
	}
	return result;
};

// ── Capability ports (SPEC-008 "Context"/"Restricciones", ruling F2-4) ──────

/**
 * Economy capability port — the subset of `TournamentEconomy` an Action may
 * drive (SPEC-008 "Comandos y Eventos": mutations go through the owner
 * system's public command API). Declared here and satisfied STRUCTURALLY by
 * the concrete engine, so action files never import `TournamentEconomy`; the
 * `EconomyResult`/`EconomySource` TYPES are a public contract, safe to import.
 * Signatures mirror `TournamentEconomy` exactly. `getBalance` is the read used
 * by `HasEnoughPoints` (SPEC-008 "Conditions").
 */
export interface EconomyCommands {
	award(
		playerId: number,
		amount: number,
		reason: string,
		source: EconomySource,
	): EconomyResult;
	remove(
		playerId: number,
		amount: number,
		reason: string,
		source: EconomySource,
	): EconomyResult;
	transfer(
		fromPlayerId: number,
		toPlayerId: number,
		amount: number,
		reason: string,
		source: EconomySource,
	): EconomyResult;
	/** Current balance, or undefined for an unknown player. */
	getBalance(playerId: number): number | undefined;
}

/**
 * Rule Engine capability port — the subset of `TournamentRuleEngine` an Action
 * may drive (SPEC-009 "Integración con Action Engine": an Action may
 * activate/deactivate/remove/register rules). Satisfied structurally by the
 * concrete engine; the `IRule`/`RuleContext` TYPES are the public contract.
 */
export interface RuleCommands {
	register(rule: IRule): boolean;
	activate(id: string, ctx?: Partial<RuleContext>): boolean;
	/**
	 * Builds and activates a PLAYER-SCOPED rule from a definition (SPEC-009 "Rule
	 * Context: Player") — the seam a per-player effect Item drives (e.g. a shield
	 * that protects only its holder). The engine binds the instance to `playerId`
	 * and gives it a per-player unique id.
	 */
	applyForPlayer(
		config: RuleConfig,
		playerId: number,
		ctx?: Partial<RuleContext>,
	): boolean;
	deactivate(id: string): boolean;
	remove(id: string): boolean;
}

// Optional ports for systems that do not exist yet — declared only so
// `ActionServices` matches the SPEC-008 "Context" field list. Base actions in
// this wave must NOT depend on them; they are narrowed when the systems land.

/**
 * Inventory capability port (SPEC-014) — the subset of `TournamentInventory` an
 * Action may drive. Narrowed now that the Inventory system exists (F2): the
 * `grantItem` Action calls `add(...)` to place a reward Item in a player's
 * inventory. Declared here and satisfied STRUCTURALLY by the concrete
 * `TournamentInventory` (whose `add` returns a richer `AddItemResult` assignable
 * to this looser shape), so action files never import the Inventory. The result
 * carries only the discriminant + optional reject reason the Action needs.
 */
export interface InventoryCommands {
	add(
		playerId: number,
		itemDefinitionId: string,
	): { readonly status: "added" | "rejected"; readonly reason?: string };
}
export type InventoryPort = InventoryCommands;
/**
 * Board capability port (SPEC-002) — the subset of `TournamentBoard` an Action
 * may drive (SPEC-006 TeleportAction/MovePlayerAction). Narrowed now that the
 * Board exists (F3): declared here and satisfied STRUCTURALLY by the concrete
 * `TournamentBoard` (whose commands return a richer `MovementResult` assignable
 * to this looser shape), so action files never import the Board. Only the
 * discriminant the Action needs is exposed.
 */
export interface BoardCommands {
	movePlayer(
		playerId: number,
		steps: number,
	): { readonly status: "moved" | "rejected" };
	teleportPlayer(
		playerId: number,
		tileId: string,
	): { readonly status: "moved" | "rejected" };
}
export type BoardPort = BoardCommands;
/** TODO SPEC-013 (Reward Resolver): reward-granting port lands later. */
export type RewardsPort = unknown;

/**
 * Random Events capability port (SPEC-019) — the command a `RandomEventAction`
 * issues to trigger a seeded random event for a player. Satisfied structurally
 * by `TournamentRandomEvents.trigger`; the system owns selection + execution, so
 * the Action stays a thin request (no clock, no RNG in the Action).
 */
export interface RandomEventCommands {
	trigger(playerId: number, round: number): void;
}

/**
 * Steal capability port (SPEC-006 "AttemptStealAction") — the primitives the
 * steal Action needs that it must not own itself: the eligible victims (the
 * roster ∩ players with points > 0, minus the thief), a seeded deterministic
 * pick, and the StealPrevention Rule query (SPEC-009). The composition provides
 * the adapter (roster + Economy balances + seeded RNG + Rule Engine); the Action
 * sequences them, calls `economy.transfer`, and emits the Steal* facts.
 */
export interface StealServices {
	/** Eligible victims for `thiefId` (other players with points > 0). */
	candidates(thiefId: number): readonly number[];
	/** Deterministic index in [0, count) from the tournament seed (advances). */
	pickIndex(count: number): number;
	/** True when `victimId` is protected by a StealPrevention Rule (SPEC-009). */
	isProtected(victimId: number): boolean;
}

/**
 * Shop capability port (SPEC-012 "Protocolo": OpenShopAction emits ShopRequested
 * / opens the session). The Action only REQUESTS the shop; the Shop System owns
 * the session, so the Action needs no clock/catalog. Satisfied by the
 * composition's adapter over `TournamentShop.open`.
 */
export interface ShopCommands {
	open(playerId: number, round: number): void;
}

/**
 * Key Item Progression capability port (SPEC-017 "Obtención": a Key Item unlocks
 * ONLY through the Reward Resolver's `unlockKeyItem` Action). The Action just
 * REQUESTS the next unlock; Key Item Progression owns ordering, the global state
 * and the KeyItemUnlocked fact. `unlockedBy` is the player whose Reward triggered
 * it (for UI/analytics only). A `rejected` result means progress was already
 * complete — a case the callers (Gambling/Shop) prevent upstream. Satisfied by
 * the composition's adapter over `TournamentKeyItems.unlock`.
 */
export interface KeyItemCommands {
	unlock(unlockedBy: number | null): { readonly status: "unlocked" | "rejected" };
}

/**
 * Shell match-state capability port (SPEC-013 "ShellReward" / SPEC-021
 * "Recompensa": THE ONE Shell, granted exclusively through the Reward
 * Resolver's `grantShell` Action). The Action only REQUESTS the grant; the
 * Shell holder owns single-grant enforcement and the ShellGranted fact.
 * Satisfied by the composition's adapter over `TournamentShell.grant`.
 */
export interface ShellCommands {
	grant(winnerId: number): { readonly status: "granted" | "rejected" };
}

/**
 * The capability bundle exposed to every Action (SPEC-008 "Context": Services
 * exposes only the public contracts of the owner systems — Economy, Inventory,
 * Board, Rule Engine, Reward Resolver — never the Runtime/Board directly). Only
 * `economy` and `rules` exist in this wave; the rest are optional placeholders.
 */
export interface ActionServices {
	readonly economy: EconomyCommands;
	readonly rules: RuleCommands;
	readonly inventory?: InventoryPort;
	readonly board?: BoardPort;
	readonly rewards?: RewardsPort;
	readonly randomEvents?: RandomEventCommands;
	readonly steal?: StealServices;
	readonly shop?: ShopCommands;
	readonly keyItems?: KeyItemCommands;
	readonly shell?: ShellCommands;
}

// ── Context (SPEC-008 "Context") ────────────────────────────────────────────

/**
 * The canonical `ActionContext` — every Action receives EXACTLY this shape
 * (SPEC-008 "Context", referenced by SPEC-006). Only identifiers and
 * capabilities (`services`) cross the boundary; never a direct Runtime/Board
 * reference (SPEC-008 "Restricciones").
 */
export interface ActionContext {
	readonly tournamentId: string;
	readonly playerId: number;
	readonly round: number;
	/** The tile the Action operates on, when applicable (SPEC-008 "Context"). */
	readonly tileId?: string;
	readonly eventBus: TournamentEventBus;
	readonly services: ActionServices;
	/**
	 * Deterministic time source for Actions that emit their OWN facts (SPEC-006:
	 * StealStarted, *Requested, presentation events). Optional and backward-
	 * compatible: Actions that only drive owner systems never need it (the owner
	 * emits with its clock). The engine composition always provides it; a bare
	 * context may omit it, so emitting Actions must tolerate its absence.
	 */
	readonly clock?: TournamentClock;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

// ── Serialized shapes (SPEC-008 `serialize()` / "Configuración") ────────────

/** JSON-safe snapshot of a condition (SPEC-008 "Conditions"). */
export interface SerializedCondition {
	readonly type: string;
	readonly parameters?: Readonly<Record<string, unknown>>;
}

/** JSON-safe snapshot of an action (SPEC-008 `serialize()`/"Configuración"). */
export interface SerializedAction {
	readonly type: string;
	readonly parameters?: Readonly<Record<string, unknown>>;
	readonly conditions?: readonly SerializedCondition[];
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly priority?: number;
}

// ── Interfaces (SPEC-008 "Interface"/"Conditions") ──────────────────────────

/**
 * A Condition gates an Action (SPEC-008 "Conditions"/"Flujo"). Pure and
 * deterministic: it reads only the context and returns a boolean; it NEVER
 * mutates state and NEVER throws for control flow (a throw is treated by the
 * engine as an internal error → `failed`).
 */
export interface ICondition {
	/** Stable identifier for logging/serialisation. */
	id(): string;
	/** True → the gate is open. Reads only `ctx`; no side effects. */
	evaluate(ctx: ActionContext): boolean;
	/** Optional JSON-safe snapshot. */
	serialize?(): SerializedCondition;
}

/**
 * An Action is one atomic behaviour (SPEC-008 "Qué es una Action": exactly ONE
 * responsibility). It is reusable, deterministic and knows nothing of
 * UI/Networking/DB/Frontend/other modules (SPEC-008 "Reglas Fundamentales").
 *
 * `rollback()` is intentionally absent (SPEC-008 "Rollback": out of v1). An
 * Action NEVER throws out and NEVER stops the tournament — every failure is a
 * returned `ExecutionResult` value the engine logs (SPEC-008 "Casos límite").
 */
export interface IAction {
	/** Stable identifier (the registered `type` in v1). */
	id(): string;
	/** The conditions the engine checks before executing (SPEC-008 "Flujo"). */
	conditions(): readonly ICondition[];
	/**
	 * Coherence/pre-flight check (SPEC-008 "Validation"). Returns SUCCESS to
	 * proceed, or SKIPPED/FAILED to stop before `execute()`. Never throws.
	 */
	validate(ctx: ActionContext): ExecutionOutcome;
	/**
	 * Performs the single responsibility (SPEC-008 "Pipeline"). Drives owner
	 * systems only through `ctx.services`; the `ExecutionResult` MIRRORS the
	 * real command result (SPEC-008 "Comandos y Eventos"). Never throws out.
	 */
	execute(ctx: ActionContext): ExecutionResult;
	/** JSON-safe snapshot (SPEC-008 `serialize()`). */
	serialize(): SerializedAction;
}

// ── Config-driven construction (SPEC-008 "Configuración") ───────────────────

/** One condition entry in an action config (SPEC-008 "Configuración"). */
export interface ConditionConfig {
	readonly type: string;
	readonly parameters?: Record<string, unknown>;
}

/**
 * The declarative shape the Action Factory builds from (SPEC-008
 * "Configuración": type/parameters/conditions/metadata/priority). Actions are
 * NEVER constructed with `new` outside a registered builder (SPEC-008 "Action
 * Registry").
 */
export interface ActionConfig {
	readonly type: string;
	readonly parameters?: Record<string, unknown>;
	readonly conditions?: readonly ConditionConfig[];
	readonly metadata?: Record<string, unknown>;
	readonly priority?: number;
}
