/**
 * tournament-key-items.ts — Key Item Progression (SPEC-017).
 *
 * ONE INSTANCE PER TOURNAMENT. Tracks the GLOBAL match progress: an ordered set
 * of Key Items, each Locked or Unlocked (never back to Locked). It is the SOLE
 * emitter of KeyItemUnlocked / KeyItemProgressUpdated / AllKeyItemsUnlocked /
 * FinalChallengeUnlocked (SPEC-017 "Eventos" / SPEC-004 canonical owner): other
 * systems (Gambling, Shop, Reward Resolver) REQUEST an unlock, they never
 * announce it.
 *
 * An unlock is driven only through the Reward Resolver's `unlockKeyItem` Action
 * (SPEC-017 "Obtención": no other path) via `ctx.services.keyItems.unlock`, so a
 * Key Item can only be a KeyItemReward outcome — a gambling win or a shop
 * purchase. `unlock()` always unlocks the NEXT locked item by `order`, never one
 * chosen by the caller (SPEC-017 "Duplicados"): duplicates are structurally
 * impossible.
 *
 * Determinism (SPEC-028): no `Math.random`, no `Date.now`; time comes only from
 * the injected TournamentClock. The progression carries no randomness.
 */

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
import { createKeyItemRegistry } from "./key-item-registry";
import {
	KeyItemDefinition,
	KeyItemProgressionSnapshot,
	KeyItemStatus,
	UnlockKeyItemResult,
} from "./key-item.types";

export interface TournamentKeyItemsOptions {
	readonly tournamentId: string;
	/** How many Key Items unlock the Final Challenge (SPEC-024 keyItemsRequired). */
	readonly required: number;
	readonly registry?: Registry<KeyItemDefinition>;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	readonly getRound?: () => number;
}

/** One tracked Key Item slot (ordered, mutable status). */
interface KeyItemSlot {
	readonly id: string;
	readonly order: number;
	status: KeyItemStatus;
}

export class TournamentKeyItems {
	private readonly tournamentId: string;
	private readonly required: number;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly getRound: () => number;

	/** Key Items in unlock order (ascending `order`). */
	private readonly slots: KeyItemSlot[];
	private unlockedCount = 0;

	constructor(options: TournamentKeyItemsOptions) {
		this.tournamentId = options.tournamentId;
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("KeyItems") ??
			new TournamentLogger({ tournamentId: this.tournamentId, system: "KeyItems" });
		this.getRound = options.getRound ?? (() => 0);

		const registry = options.registry ?? createKeyItemRegistry({ seed: true });
		this.slots = registry
			.getAll()
			.map((definition) => ({
				id: definition.id,
				order: definition.order,
				status: "locked" as KeyItemStatus,
			}))
			.sort((a, b) => a.order - b.order);

		// `required` can never exceed the number of defined Key Items; cap and warn
		// rather than promise a Final Challenge that can never be reached.
		if (options.required > this.slots.length) {
			this.logger.warn(
				`required (${options.required}) exceeds defined Key Items (${this.slots.length}); capping`,
			);
		}
		this.required = Math.min(options.required, this.slots.length);
	}

	/**
	 * Unlocks the NEXT locked Key Item by order (SPEC-017 "Obtención"). Emits
	 * KeyItemUnlocked + KeyItemProgressUpdated, then AllKeyItemsUnlocked +
	 * FinalChallengeUnlocked once the required count is reached. If progress is
	 * already complete, the request is REJECTED (logged, never thrown) — a case
	 * that must never be reached (SPEC-017 "Duplicados"). `unlockedBy` is the
	 * player whose Reward triggered it (a gambling winner / shop buyer), for
	 * UI/analytics only; Key Items belong to the Tournament, not the player.
	 */
	unlock(unlockedBy: number | null = null): UnlockKeyItemResult {
		if (this.unlockedCount >= this.required) {
			this.logger.warn("unlock requested but progress is already complete; rejected", {
				metadata: { unlockedCount: this.unlockedCount, required: this.required },
			});
			return { status: "rejected", reason: "already_complete" };
		}

		const slot = this.slots.find((s) => s.status === "locked");
		if (!slot) {
			// Unreachable while required <= slots.length, but stay safe.
			this.logger.warn("unlock requested but no locked Key Item remains; rejected");
			return { status: "rejected", reason: "already_complete" };
		}

		slot.status = "unlocked";
		this.unlockedCount += 1;
		const complete = this.unlockedCount >= this.required;
		const round = this.getRound();

		this.emit("KeyItemUnlocked", unlockedBy, round, {
			keyItemId: slot.id,
			order: slot.order,
			unlockedCount: this.unlockedCount,
			required: this.required,
			unlockedBy,
		});
		this.emit("KeyItemProgressUpdated", null, round, {
			unlockedCount: this.unlockedCount,
			required: this.required,
			completion: this.required === 0 ? 1 : this.unlockedCount / this.required,
		});
		if (complete) {
			this.emit("AllKeyItemsUnlocked", null, round, { required: this.required });
			this.emit("FinalChallengeUnlocked", null, round, { required: this.required });
		}

		return {
			status: "unlocked",
			keyItemId: slot.id,
			order: slot.order,
			unlockedCount: this.unlockedCount,
			required: this.required,
			complete,
		};
	}

	/** How many Key Items are required for the Final Challenge. */
	getRequired(): number {
		return this.required;
	}

	/** How many Key Items are currently unlocked. */
	getUnlockedCount(): number {
		return this.unlockedCount;
	}

	/** True once every required Key Item is unlocked (Final Challenge available). */
	isComplete(): boolean {
		return this.unlockedCount >= this.required;
	}

	/**
	 * True while at least one Key Item remains lockable — the gate Gambling and
	 * the Shop's Key Item Offer consult before offering an unlock (SPEC-016,
	 * SPEC-012): once complete they must stop offering it.
	 */
	hasLockedRemaining(): boolean {
		return this.unlockedCount < this.required;
	}

	serialize(): KeyItemProgressionSnapshot {
		return {
			tournamentId: this.tournamentId,
			required: this.required,
			items: this.slots.map((s) => ({ id: s.id, order: s.order, status: s.status })),
		};
	}

	private emit<TName extends TournamentEventName>(
		name: TName,
		playerId: number | null,
		round: number,
		payload: TournamentEventPayloadMap[TName],
	): void {
		const event = createTournamentEvent({
			name,
			tournamentId: this.tournamentId,
			round,
			playerId,
			payload,
			timestamp: this.clock.now(),
		});
		this.bus.emit(event as AnyTournamentEvent);
	}
}
