/**
 * item.types.ts — Item Framework contracts (SPEC-007) + Inventory runtime
 * shapes (SPEC-014).
 *
 * SPEC-007 "Filosofía": an Item is NOT an object — it is a list of Effects, the
 * exact way a Tile is a list of Actions. There is therefore no behaviour on the
 * Item itself: an `ItemDefinition` is pure data, and every Effect is an
 * `ActionConfig` run through the ONE Action Engine (SPEC-007 "Item Effects":
 * "No existe un segundo motor ni un segundo registro"). This file imports ONLY
 * the public Action Engine TYPES (`ActionConfig`/`ActionContext`/
 * `ExecutionResult`) — never the concrete engine/factory (SPEC-014
 * "Restricciones"): effect execution is delegated through the `ItemEffectRunner`
 * port below, which the architect fills with the real engine at integration.
 */

import {
	ActionConfig,
	ActionContext,
	ExecutionResult,
} from "../actions/action.interface";

// ── Item definition (SPEC-007 "Definición") ─────────────────────────────────

/**
 * The immutable definition of an Item (SPEC-007 "Definición": id, name, rarity,
 * icon, description, effects[], metadata — "Nada más"). Registered once in the
 * item registry and deep-frozen; the same definition backs every instance a
 * player holds. It carries NO behaviour (SPEC-007 "Nunca": todo comportamiento
 * vive en Effects).
 *
 * - `effects`: the ActionConfigs run through the Action Engine when the Item is
 *   used (SPEC-007 "Item Effects"). An Effect IS an Action; there is no separate
 *   effect engine or registry.
 * - `consumable`: whether the instance is destroyed after use (SPEC-007
 *   "Consumo": Consumible o Permanente — "La decisión pertenece a
 *   configuración"). It is config, not code.
 * - `trigger`: optional activation trigger metadata (SPEC-007 "Trigger":
 *   OnTurnStart/OnDiceRoll/…). The Inventory never interprets it — it only
 *   stores it; a Trigger system decides when an automatic item activates
 *   (SPEC-014 "Activación": "El Inventory no decide cuándo ocurre").
 */
export interface ItemDefinition {
	readonly id: string;
	readonly name: string;
	/** Rarity tier (content decides the exact vocabulary). */
	readonly rarity: string;
	readonly icon: string;
	readonly description: string;
	/** The Effects run through the Action Engine on use (SPEC-007). */
	readonly effects: readonly ActionConfig[];
	/** True → destroyed after use; false → permanent (SPEC-007 "Consumo"). */
	readonly consumable: boolean;
	/** Optional activation trigger, purely descriptive (SPEC-007 "Trigger"). */
	readonly trigger?: string;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

// ── Runtime instance + slot shapes (SPEC-014 "Slots") ───────────────────────

/**
 * A live, unique instance of an Item held by a player (SPEC-007 "Stack": cada
 * slot contiene una instancia; dos Escudos → dos Items, never Escudo x2). The
 * `instanceId` is a fresh `randomUUID` per Add, so two of the same definition
 * are distinct instances.
 */
export interface ItemInstance {
	/** Unique per-instance id (identity, never gameplay randomness). */
	readonly instanceId: string;
	/** The `ItemDefinition.id` this instance is a copy of. */
	readonly definitionId: string;
}

/**
 * A JSON-safe snapshot of one slot (SPEC-014 "Slot": slotId, itemId,
 * instanceId, metadata). One slot holds exactly one Item instance.
 */
export interface SlotSnapshot {
	readonly slotId: string;
	/** The held item's definition id (SPEC-014 "Slot": itemId). */
	readonly itemId: string;
	readonly instanceId: string;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A JSON-safe snapshot of one player's inventory (SPEC-014 "Player Inventory":
 * playerId, slots[], capacity, metadata). `used` is `slots.length`, exposed for
 * the client so it never derives occupancy itself.
 */
export interface PlayerInventorySnapshot {
	readonly playerId: number;
	readonly capacity: number;
	readonly used: number;
	readonly slots: readonly SlotSnapshot[];
}

/** JSON-safe snapshot of every player's inventory (SPEC-014 "Persistencia":
 * ephemeral — embedded in the Runtime snapshot, never persisted). */
export interface InventorySnapshot {
	readonly tournamentId: string;
	readonly capacity: number;
	readonly players: readonly PlayerInventorySnapshot[];
}

// ── Effect-runner port (dependency inversion, SPEC-014 "Todo uso pasa por
//    Action Engine") ────────────────────────────────────────────────────────

/**
 * The seam through which the Inventory delegates effect execution to the Action
 * Engine WITHOUT importing it (mirrors Economy's `RewardRuleApplier`). SPEC-014
 * "Consumir Item" routes every use through the Action Engine, but SPEC-014
 * "Responsabilidades" forbids the Inventory from ever executing effects itself.
 * This port reconciles the two: the Inventory calls `run(...)`; the architect
 * injects the concrete runner (built from `ActionFactory` + `ActionEngine`)
 * later. `run` returns one `ExecutionResult` per effect, in effect order, and
 * (like the engine) never throws.
 */
export interface ItemEffectRunner {
	run(
		effects: readonly ActionConfig[],
		context: ActionContext,
	): ExecutionResult[];
}

// ── Public command results (discriminated unions) ───────────────────────────

/** Why an Add was rejected (SPEC-014 "Añadir Item" / "Casos límite"). */
export type AddRejectionReason =
	| "inventory_full"
	| "unknown_definition"
	| "unknown_player";

/** Result of `add` (SPEC-014 "Añadir Item"). */
export type AddItemResult =
	| { readonly status: "added"; readonly slot: SlotSnapshot }
	| { readonly status: "rejected"; readonly reason: AddRejectionReason };

/** Why a Remove was ignored (SPEC-014 "Casos límite": Item inexistente → Ignorar). */
export type RemoveIgnoredReason = "unknown_instance" | "unknown_player";

/** Result of `remove` (SPEC-014 "Eliminar Item"). */
export type RemoveItemResult =
	| { readonly status: "removed"; readonly instanceId: string }
	| { readonly status: "ignored"; readonly reason: RemoveIgnoredReason };

/** Why a Consume was rejected (SPEC-014 "Validación" / "Casos límite"). */
export type ConsumeRejectionReason =
	| "unknown_player"
	| "unknown_instance"
	| "already_consumed"
	| "blocked"
	| "not_usable";

/**
 * Result of `consume` (SPEC-014 "Consumir Item"). On success `consumed` is true
 * when the instance was destroyed (a consumable) and false when a permanent
 * item stayed in its slot; `results` are the per-effect Action Engine results.
 */
export type ConsumeItemResult =
	| {
			readonly status: "consumed";
			readonly instanceId: string;
			readonly consumed: boolean;
			readonly results: readonly ExecutionResult[];
	  }
	| { readonly status: "rejected"; readonly reason: ConsumeRejectionReason };
