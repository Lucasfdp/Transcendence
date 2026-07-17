/**
 * key-item.types.ts — data model for Key Item Progression (SPEC-017).
 *
 * Key Items are the GLOBAL progress of a match: they belong to the Tournament,
 * never to a player, and never revert to Locked (SPEC-017 "Filosofía"/"Estado").
 * A definition is pure content (id/name/description/icon/order/metadata) and
 * lives in the deep-freezing `Registry<T>` (SPEC-025) like items/dice/boards;
 * the mutable Locked/Unlocked state lives only in the progression system.
 */

/** Immutable Key Item definition (SPEC-017 "Definición"). Pure content. */
export interface KeyItemDefinition {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly icon: string;
	/** Unlock order (1-based); KeyItemReward always unlocks the next locked one. */
	readonly order: number;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Lifecycle of one Key Item (SPEC-017 "Estado"): never returns to Locked. */
export type KeyItemStatus = "locked" | "unlocked";

/**
 * Result of an unlock request (SPEC-017 "Obtención"/"Duplicados"). `unlocked`
 * carries the item that was unlocked; `rejected` means no locked Key Item
 * remained — a case that must never be reached (Gambling and the Key Item Offer
 * stop being offered once progress is complete), so it is a logged rejection,
 * never a throw.
 */
export type UnlockKeyItemResult =
	| {
			readonly status: "unlocked";
			readonly keyItemId: string;
			readonly order: number;
			readonly unlockedCount: number;
			readonly required: number;
			readonly complete: boolean;
	  }
	| { readonly status: "rejected"; readonly reason: "already_complete" };

/** JSON-safe snapshot of Key Item progression (SPEC-017). */
export interface KeyItemProgressionSnapshot {
	readonly tournamentId: string;
	readonly required: number;
	readonly items: readonly {
		readonly id: string;
		readonly order: number;
		readonly status: KeyItemStatus;
	}[];
}
