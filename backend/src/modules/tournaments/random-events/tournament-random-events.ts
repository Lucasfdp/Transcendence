/**
 * tournament-random-events.ts — Tournament Random Events System (SPEC-019).
 *
 * ONE INSTANCE PER TOURNAMENT. It selects a random event with the tournament
 * SEED (deterministic, SPEC-000/019 "Selección": weighted, never hardcoded),
 * validates it and runs its Actions through the ONE Action Engine (SPEC-019
 * "Ejecución") — it NEVER modifies game state directly (SPEC-019
 * "Responsabilidades"). It reuses the exact same Actions as Tiles/Items/Rewards
 * (SPEC-019 "Reutilización"): a `movePlayer`/`teleport` event Action counts as a
 * forced relocation and respects the Board anti-loop limit (SPEC-002).
 *
 * Driven by a command (`trigger`) invoked by the `RandomEventAction` tile Action
 * through `ctx.services.randomEvents` — so the Action needs no clock and the
 * system owns its own (SPEC-028 determinism: seed + injected clock only, no
 * `Math.random`/`Date.now`).
 */

import { ActionConfig } from "../actions/action.interface";
import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	RandomEventActionStatus,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import { createSeededRng } from "../infra/seeded-rng";
import { Registry } from "../registry/registry";
import { createRandomEventRegistry } from "./random-event-registry";
import {
	RandomEventActionRunner,
	RandomEventContextFactory,
	RandomEventDefinition,
	RandomEventsSnapshot,
} from "./random-event.types";

export interface TournamentRandomEventsOptions {
	readonly tournamentId: string;
	readonly seed: string;
	readonly registry?: Registry<RandomEventDefinition>;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	/** Execution seam; a no-op runner is used when omitted (SPEC-019). */
	readonly actionRunner?: RandomEventActionRunner;
	/** Builds the ActionContext an event's Actions run against. */
	readonly makeContext?: RandomEventContextFactory;
	readonly getRound?: () => number;
}

const NOOP_ACTION_RUNNER: RandomEventActionRunner = { run: () => [] };

export class TournamentRandomEvents {
	private readonly tournamentId: string;
	private readonly seed: string;
	private readonly registry: Registry<RandomEventDefinition>;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly actionRunner: RandomEventActionRunner;
	private readonly makeContext: RandomEventContextFactory;
	private readonly getRound: () => number;

	/** Monotonic selection index, namespaced into the seed (part of snapshot). */
	private selectionCount = 0;

	constructor(options: TournamentRandomEventsOptions) {
		this.tournamentId = options.tournamentId;
		this.seed = options.seed;
		this.registry = options.registry ?? createRandomEventRegistry({ seed: true });
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("RandomEvents") ??
			new TournamentLogger({ tournamentId: this.tournamentId, system: "RandomEvents" });
		this.actionRunner = options.actionRunner ?? NOOP_ACTION_RUNNER;
		this.getRound = options.getRound ?? (() => 0);
		this.makeContext =
			options.makeContext ??
			((input) => ({
				tournamentId: this.tournamentId,
				playerId: input.playerId,
				round: input.round,
				eventBus: this.bus,
				services: {} as never,
			}));
	}

	/**
	 * Selects and runs one random event for a player (SPEC-019 "Ejecución"):
	 * RandomEventRequested → weighted seeded selection → RandomEventSelected →
	 * RandomEventStarted → run Actions via the engine → RandomEventFinished. An
	 * empty catalog emits RandomEventCancelled. Never throws.
	 */
	trigger(playerId: number, round: number = this.getRound()): void {
		const events = this.registry.getAll();
		this.emit("RandomEventRequested", playerId, round, {
			candidateCount: events.length,
		});
		if (events.length === 0) {
			this.emit("RandomEventCancelled", playerId, round, { reason: "no_events" });
			return;
		}

		const selected = this.selectWeighted(events);
		this.emit("RandomEventSelected", playerId, round, {
			eventId: selected.id,
			name: selected.name,
		});
		this.emit("RandomEventStarted", playerId, round, { eventId: selected.id });

		const configs = this.applyConditions(selected.actions, selected);
		let statuses: RandomEventActionStatus[] = [];
		try {
			const ctx = this.makeContext({ playerId, round });
			statuses = this.actionRunner
				.run(configs, ctx)
				.map((result) => result.status);
		} catch (error) {
			this.logger.error("random event runner threw; treated as no results", {
				playerId,
				metadata: {
					eventId: selected.id,
					error: error instanceof Error ? error.message : String(error),
				},
			});
		}

		this.emit("RandomEventFinished", playerId, round, {
			eventId: selected.id,
			actionStatuses: statuses,
		});
	}

	/** JSON-safe snapshot (SPEC-019): only the selection counter is state. */
	serialize(): RandomEventsSnapshot {
		return {
			tournamentId: this.tournamentId,
			seed: this.seed,
			selectionCount: this.selectionCount,
		};
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/**
	 * Weighted selection driven by the shared seeded PRNG, namespaced by the
	 * selection index so each pick is an independent, reproducible draw (SPEC-019
	 * "Selección" / SPEC-000). Advances the counter.
	 */
	private selectWeighted(
		events: readonly RandomEventDefinition[],
	): RandomEventDefinition {
		const rng = createSeededRng(`${this.seed}:randomEvent:${this.selectionCount}`);
		this.selectionCount += 1;
		const totalWeight = events.reduce((sum, event) => sum + event.weight, 0);
		let threshold = rng() * totalWeight;
		for (const event of events) {
			threshold -= event.weight;
			if (threshold < 0) {
				return event;
			}
		}
		// Floating-point guard: return the last event if the loop underflowed.
		return events[events.length - 1];
	}

	/**
	 * Attaches the event's `conditions` onto every Action config (like the Reward
	 * Resolver), so the existing engine gating enforces them — no second condition
	 * path (SPEC-019 "Validación").
	 */
	private applyConditions(
		configs: readonly ActionConfig[],
		event: RandomEventDefinition,
	): ActionConfig[] {
		if (!event.conditions || event.conditions.length === 0) {
			return [...configs];
		}
		return configs.map((config) => ({
			...config,
			conditions: [...(config.conditions ?? []), ...(event.conditions ?? [])],
		}));
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
