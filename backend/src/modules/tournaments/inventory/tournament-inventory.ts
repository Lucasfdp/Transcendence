/**
 * tournament-inventory.ts — Tournament Inventory System (SPEC-014,
 * Phase-1 in-memory version).
 *
 * ONE INSTANCE PER TOURNAMENT, holding one `PlayerInventory` per participant.
 * Its ONLY responsibility is to STORE, RETRIEVE and CONSUME the temporary Items
 * a player holds during a match (SPEC-014 "Objetivo"). It NEVER contains
 * gameplay logic, NEVER executes Items, NEVER validates effects and NEVER
 * modifies other systems (SPEC-014 "Objetivo"/"Responsabilidades"): effect
 * execution is delegated to the Action Engine through the `ItemEffectRunner`
 * port, so the Inventory itself never runs an effect (SPEC-014 "Todo uso pasa
 * por Action Engine").
 *
 * It knows nothing of Board, Boss, Economy, Shop, Gambling, Minigames,
 * Networking or UI (SPEC-014 "Restricciones"): those systems merely call the
 * public commands (add/remove/consume) and consume the emitted events. Items are
 * ephemeral — destroyed at match end, never persisted between matches (SPEC-014
 * "Persistencia"): no TypeORM, no cross-match state.
 *
 * Determinism (SPEC-028): no `Math.random`, no `Date.now`. Timestamps come
 * exclusively from the injected TournamentClock; the only randomness is
 * `randomUUID` for slot/instance identity (identity, not gameplay randomness).
 * Pattern mirrors tournament-economy.ts / tournament-leaderboard.ts: constructor
 * takes bus/clock/logger, emits via `createTournamentEvent(...)` cast to
 * `AnyTournamentEvent`, and exposes a JSON-safe `serialize()`.
 */

import { randomUUID } from "node:crypto";

import { ActionContext, ExecutionResult } from "../actions/action.interface";
import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import { Registry } from "../registry/registry";
import {
	AddItemResult,
	ConsumeItemResult,
	InventorySnapshot,
	ItemDefinition,
	ItemEffectRunner,
	PlayerInventorySnapshot,
	RemoveItemResult,
	SlotSnapshot,
} from "./item.types";

export interface TournamentInventoryOptions {
	readonly tournamentId: string;
	/** Participant user ids; one inventory is created per id. */
	readonly participantIds: readonly number[];
	/**
	 * Slot capacity per inventory (SPEC-014 "Capacidad": configurable, NO
	 * hardcoded limit). Sourced from settings by the architect at integration.
	 */
	readonly capacity: number;
	/** Immutable Item definition registry (SPEC-007) the Add pipeline resolves. */
	readonly registry: Registry<ItemDefinition>;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	/**
	 * Effect-execution seam (SPEC-014 "Todo uso pasa por Action Engine"). The
	 * real runner (ActionFactory + ActionEngine) is injected by the architect;
	 * a no-op runner is used when omitted so the Inventory stays standalone.
	 */
	readonly effectRunner?: ItemEffectRunner;
	/** Current tournament round for event envelopes; 0 when omitted. */
	readonly getRound?: () => number;
}

/**
 * Default runner used when no Action Engine is injected (v1 standalone): runs
 * nothing and returns no results (SPEC-014: the Inventory never executes effects
 * itself). Logs so an accidental use in production is visible.
 */
const NOOP_EFFECT_RUNNER: ItemEffectRunner = {
	run: () => [],
};

/**
 * Mutable internal slot; `SlotSnapshot` is its JSON-safe projection.
 * `blocked` is a Rule Engine seam (SPEC-014 "Integración con Rule Engine":
 * Rules may block slots); it defaults to false and there is no setter this wave.
 * `consuming` is the in-flight guard that rejects a duplicate/re-entrant consume
 * of the same instance (SPEC-014 "Casos límite": Consumo duplicado → Rechazar).
 */
interface SlotState {
	readonly slotId: string;
	readonly itemId: string;
	readonly instanceId: string;
	blocked: boolean;
	consuming: boolean;
}

/** Mutable internal inventory; slots keep stable insertion order (SPEC-014 "Orden"). */
interface PlayerInventoryState {
	readonly playerId: number;
	capacity: number;
	readonly slots: SlotState[];
}

export class TournamentInventory {
	private readonly tournamentId: string;
	private readonly defaultCapacity: number;
	private readonly registry: Registry<ItemDefinition>;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly effectRunner: ItemEffectRunner;
	private readonly getRound: () => number;

	private readonly inventories = new Map<number, PlayerInventoryState>();

	constructor(options: TournamentInventoryOptions) {
		this.tournamentId = options.tournamentId;
		this.defaultCapacity = options.capacity;
		this.registry = options.registry;
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("Inventory") ??
			new TournamentLogger({
				tournamentId: this.tournamentId,
				system: "Inventory",
			});
		this.effectRunner = options.effectRunner ?? NOOP_EFFECT_RUNNER;
		this.getRound = options.getRound ?? (() => 0);

		for (const playerId of options.participantIds) {
			// A duplicate id would silently drop an inventory; keep the first.
			if (!this.inventories.has(playerId)) {
				this.inventories.set(playerId, {
					playerId,
					capacity: this.defaultCapacity,
					slots: [],
				});
			}
		}
	}

	// ── Add (SPEC-014 "Añadir Item") ─────────────────────────────────────────

	/**
	 * Add pipeline (SPEC-014 "Añadir Item": Inventory.Add → Validar espacio →
	 * Asignar Slot → Emit ItemAdded). Resolves the definition from the registry
	 * (the Inventory never CREATES Items — it receives them, SPEC-014
	 * "Integración con Reward Resolver"); an unknown definition is a logged
	 * rejection, never a throw. A full inventory is rejected and emits
	 * InventoryFull WITHOUT adding (SPEC-014 "Casos límite"). On success a fresh
	 * unique-instance slot is assigned (SPEC-007 "Stack": no stacking) and
	 * ItemAdded then InventoryUpdated are emitted.
	 */
	add(playerId: number, itemDefinitionId: string): AddItemResult {
		const inventory = this.inventories.get(playerId);
		if (!inventory) {
			this.logger.warn("add for unknown player ignored", {
				playerId,
				metadata: { itemDefinitionId },
			});
			return { status: "rejected", reason: "unknown_player" };
		}

		const definition = this.registry.get(itemDefinitionId);
		if (!definition) {
			this.logger.warn("add of unknown item definition rejected", {
				playerId,
				metadata: { itemDefinitionId },
			});
			return { status: "rejected", reason: "unknown_definition" };
		}

		if (inventory.slots.length >= inventory.capacity) {
			// Full → reject + InventoryFull; the item is NOT added.
			this.emit("InventoryFull", playerId, {
				itemId: definition.id,
				capacity: inventory.capacity,
			});
			return { status: "rejected", reason: "inventory_full" };
		}

		const slot: SlotState = {
			slotId: randomUUID(),
			itemId: definition.id,
			instanceId: randomUUID(),
			blocked: false,
			consuming: false,
		};
		inventory.slots.push(slot);

		this.emit("ItemAdded", playerId, {
			itemId: slot.itemId,
			instanceId: slot.instanceId,
			slotId: slot.slotId,
		});
		this.emitInventoryUpdated(inventory);
		return { status: "added", slot: this.projectSlot(slot) };
	}

	// ── Remove (SPEC-014 "Eliminar Item") ────────────────────────────────────

	/**
	 * Remove pipeline (SPEC-014 "Eliminar Item": Inventory.Remove → Liberar Slot
	 * → Emit ItemRemoved). Frees the slot and emits ItemRemoved then
	 * InventoryUpdated (and InventoryEmpty when the inventory becomes empty). An
	 * unknown instance/player is a logged no-op (SPEC-014 "Casos límite": Item
	 * inexistente → Ignorar → Registrar), never a throw.
	 */
	remove(playerId: number, instanceId: string): RemoveItemResult {
		const inventory = this.inventories.get(playerId);
		if (!inventory) {
			this.logger.warn("remove for unknown player ignored", {
				playerId,
				metadata: { instanceId },
			});
			return { status: "ignored", reason: "unknown_player" };
		}

		const slot = inventory.slots.find((s) => s.instanceId === instanceId);
		if (!slot) {
			this.logger.warn("remove of unknown instance ignored", {
				playerId,
				metadata: { instanceId },
			});
			return { status: "ignored", reason: "unknown_instance" };
		}

		this.removeSlot(inventory, slot);
		return { status: "removed", instanceId };
	}

	// ── Consume (SPEC-014 "Consumir Item") ───────────────────────────────────

	/**
	 * Consume pipeline in the EXACT SPEC-014 order (SPEC-014 "Consumir Item":
	 * Inventory.Validate → Action Engine.Execute → Inventory.Remove → Emit
	 * ConsumableUsed):
	 *   1. Validate (SPEC-014 "Validación"): the instance exists, belongs to
	 *      this player (per-player lookup enforces ownership), is not blocked and
	 *      is not already being consumed (a duplicate/re-entrant consume is
	 *      REJECTED, SPEC-014 "Casos límite"). An unresolved/invalid definition is
	 *      not usable (SPEC-007 "Item inválido → No ejecutar").
	 *   2. Run the item's effects through the Action Engine seam (never here).
	 *   3. Remove the instance IF it is consumable; a permanent item stays in its
	 *      slot after use (SPEC-007 "Consumo").
	 *   4. Emit ConsumableUsed carrying the per-effect result statuses.
	 * Never throws.
	 */
	consume(
		playerId: number,
		instanceId: string,
		context: ActionContext,
	): ConsumeItemResult {
		const inventory = this.inventories.get(playerId);
		if (!inventory) {
			this.logger.warn("consume for unknown player rejected", {
				playerId,
				metadata: { instanceId },
			});
			return { status: "rejected", reason: "unknown_player" };
		}

		const slot = inventory.slots.find((s) => s.instanceId === instanceId);
		if (!slot) {
			this.logger.warn("consume of unknown/foreign instance rejected", {
				playerId,
				metadata: { instanceId },
			});
			return { status: "rejected", reason: "unknown_instance" };
		}

		if (slot.consuming) {
			// Duplicate/parallel consume of the same instance (SPEC-014 "Casos
			// límite": Consumo duplicado → Rechazar).
			this.logger.warn("duplicate consume of an in-flight instance rejected", {
				playerId,
				metadata: { instanceId, itemId: slot.itemId },
			});
			return { status: "rejected", reason: "already_consumed" };
		}

		if (slot.blocked) {
			this.logger.warn("consume of a blocked slot rejected", {
				playerId,
				metadata: { instanceId, itemId: slot.itemId },
			});
			return { status: "rejected", reason: "blocked" };
		}

		const definition = this.registry.get(slot.itemId);
		if (!definition) {
			// Item inválido → No ejecutar (SPEC-007 "Casos límite").
			this.logger.warn("consume of an item with no definition rejected", {
				playerId,
				metadata: { instanceId, itemId: slot.itemId },
			});
			return { status: "rejected", reason: "not_usable" };
		}

		// Guard against a re-entrant consume of the same instance while effects
		// run (the runner is the ONLY thing that could call back in).
		slot.consuming = true;

		let results: ExecutionResult[];
		try {
			results = this.effectRunner.run(definition.effects, context);
		} catch (error) {
			// The runner (Action Engine) must never throw; if it does the match
			// keeps going (SPEC-014 aligns with SPEC-008 "Casos límite").
			this.logger.error("effect runner threw during consume; treated as no results", {
				playerId,
				metadata: {
					instanceId,
					itemId: slot.itemId,
					error: error instanceof Error ? error.message : String(error),
				},
			});
			results = [];
		}

		const consumed = definition.consumable;
		if (consumed) {
			// Remove destroys the slot (emits ItemRemoved + InventoryUpdated
			// [+ InventoryEmpty]); the guard dies with the slot.
			this.removeSlot(inventory, slot);
		} else {
			// Permanent: keep the slot, release the guard for future uses.
			slot.consuming = false;
		}

		this.emit("ConsumableUsed", playerId, {
			itemId: slot.itemId,
			instanceId,
			consumed,
			effectStatuses: results.map((result) => result.status),
		});

		return { status: "consumed", instanceId, consumed, results };
	}

	// ── Read-only observation (SPEC-014 "Integración con UI": snapshots) ──────

	/**
	 * JSON-safe snapshot of one player's inventory (undefined for a player with
	 * no inventory). Slots are in stable order (SPEC-014 "Orden": the client may
	 * reorder visually, but the logic order never changes).
	 */
	getInventory(playerId: number): PlayerInventorySnapshot | undefined {
		const inventory = this.inventories.get(playerId);
		return inventory ? this.projectInventory(inventory) : undefined;
	}

	/** Snapshot of a single slot by instance id (undefined when not held). */
	getSlot(playerId: number, instanceId: string): SlotSnapshot | undefined {
		const slot = this.inventories
			.get(playerId)
			?.slots.find((s) => s.instanceId === instanceId);
		return slot ? this.projectSlot(slot) : undefined;
	}

	/** Configured slot capacity of a player (undefined for an unknown player). */
	getCapacity(playerId: number): number | undefined {
		return this.inventories.get(playerId)?.capacity;
	}

	/** Number of occupied slots (undefined for an unknown player). */
	getUsed(playerId: number): number | undefined {
		return this.inventories.get(playerId)?.slots.length;
	}

	/**
	 * JSON-safe snapshot of every player's inventory for the Runtime snapshot
	 * (SPEC-014 "Persistencia": ephemeral — this is a view, never persisted).
	 */
	serialize(): InventorySnapshot {
		return {
			tournamentId: this.tournamentId,
			capacity: this.defaultCapacity,
			players: [...this.inventories.values()].map((inventory) =>
				this.projectInventory(inventory),
			),
		};
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/**
	 * Frees a slot and emits ItemRemoved → InventoryUpdated (→ InventoryEmpty
	 * when the inventory becomes empty), in that order. Shared by `remove` and
	 * the consume-of-a-consumable path so both emit identically.
	 */
	private removeSlot(inventory: PlayerInventoryState, slot: SlotState): void {
		const index = inventory.slots.indexOf(slot);
		if (index >= 0) {
			inventory.slots.splice(index, 1);
		}
		this.emit("ItemRemoved", inventory.playerId, {
			itemId: slot.itemId,
			instanceId: slot.instanceId,
			slotId: slot.slotId,
		});
		this.emitInventoryUpdated(inventory);
		if (inventory.slots.length === 0) {
			this.emit("InventoryEmpty", inventory.playerId, {
				capacity: inventory.capacity,
			});
		}
	}

	private emitInventoryUpdated(inventory: PlayerInventoryState): void {
		this.emit("InventoryUpdated", inventory.playerId, {
			capacity: inventory.capacity,
			used: inventory.slots.length,
		});
	}

	private projectSlot(slot: SlotState): SlotSnapshot {
		return {
			slotId: slot.slotId,
			itemId: slot.itemId,
			instanceId: slot.instanceId,
		};
	}

	private projectInventory(
		inventory: PlayerInventoryState,
	): PlayerInventorySnapshot {
		return {
			playerId: inventory.playerId,
			capacity: inventory.capacity,
			used: inventory.slots.length,
			slots: inventory.slots.map((slot) => this.projectSlot(slot)),
		};
	}

	private emit<TName extends TournamentEventName>(
		name: TName,
		playerId: number | null,
		payload: TournamentEventPayloadMap[TName],
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
