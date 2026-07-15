/**
 * tournament-boss.ts — the Boss System (SPEC-020).
 *
 * ONE INSTANCE PER TOURNAMENT. A pure ORCHESTRATOR (SPEC-020 "Filosofía"): it
 * appears ONLY when every Key Item is unlocked, plays an intro through Actions,
 * alters the game ONLY by activating Rules through the Rule Engine, and emits
 * BossIntroCompleted so the State Machine goes BOSS_EVENT → FINAL_CHALLENGE
 * (SPEC-003). It never rewards, never decides a winner, never touches Economy /
 * Inventory / Board (SPEC-020 "Restricciones") — all of that is Rules and
 * Actions. When the match resolves it removes its Rules and finishes.
 *
 * Determinism (SPEC-028): the Boss carries no randomness; time (event stamps)
 * comes only from the injected clock.
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
import { createBossRegistry, V1_BOSS_ID } from "./boss-registry";
import {
	BossActionRunner,
	BossContextFactory,
	BossDefinition,
	BossKeyItemGate,
	BossLifecycle,
	BossRuleController,
	BossSnapshot,
	BossSpawnResult,
} from "./boss.types";

export interface TournamentBossOptions {
	readonly tournamentId: string;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	readonly keyItems: BossKeyItemGate;
	readonly ruleController: BossRuleController;
	/** Which Boss to load (defaults to the v1 placeholder). */
	readonly bossId?: string;
	readonly registry?: Registry<BossDefinition>;
	/** Intro Action runner + context (default: a no-op runner). */
	readonly introRunner?: BossActionRunner;
	readonly makeContext?: BossContextFactory;
	readonly getRound?: () => number;
}

const NOOP_RUNNER: BossActionRunner = { run: () => [] };

export class TournamentBoss {
	private readonly tournamentId: string;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly keyItems: BossKeyItemGate;
	private readonly ruleController: BossRuleController;
	private readonly definition: BossDefinition;
	private readonly introRunner: BossActionRunner;
	private readonly makeContext: BossContextFactory;
	private readonly getRound: () => number;

	private state: BossLifecycle = "idle";
	private activeRuleIds: string[] = [];

	constructor(options: TournamentBossOptions) {
		this.tournamentId = options.tournamentId;
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("Boss") ??
			new TournamentLogger({ tournamentId: this.tournamentId, system: "Boss" });
		this.keyItems = options.keyItems;
		this.ruleController = options.ruleController;
		const registry = options.registry ?? createBossRegistry({ seed: true });
		this.definition = registry.get(options.bossId ?? V1_BOSS_ID);
		this.introRunner = options.introRunner ?? NOOP_RUNNER;
		this.getRound = options.getRound ?? (() => 0);
		this.makeContext =
			options.makeContext ??
			((input) => ({
				tournamentId: this.tournamentId,
				playerId: 0,
				round: input.round,
				eventBus: this.bus,
				services: {} as never,
				clock: this.clock,
			}));
	}

	/**
	 * Spawns the Boss (SPEC-020 "Inicio"): guarded by "all Key Items unlocked"
	 * (SPEC-020 "Aparición") and single-spawn. Plays the intro (best-effort — an
	 * intro error is logged and the pipeline continues, SPEC-020 "Casos límite"),
	 * activates the Boss Rules, then emits BossIntroCompleted (the State-Machine
	 * event) carrying the Final Challenge to start.
	 */
	spawn(round?: number): BossSpawnResult {
		if (this.state !== "idle") {
			return { status: "ignored", reason: "already_active" };
		}
		if (!this.keyItems.isComplete()) {
			this.logger.warn("boss spawn rejected: Key Items incomplete");
			return { status: "rejected", reason: "key_items_incomplete" };
		}

		const bossId = this.definition.id;
		const roundNumber = round ?? this.getRound();
		this.emit("BossSpawnRequested", roundNumber, { bossId });
		this.state = "active";
		this.emit("BossSpawned", roundNumber, { bossId, name: this.definition.name });

		// Intro presentation Actions (SPEC-020): never allowed to break the pipeline.
		try {
			this.introRunner.run(this.definition.introSequence, this.makeContext({ round: roundNumber }));
		} catch (error) {
			this.logger.error("boss intro sequence threw; continuing to Final Challenge", {
				metadata: { bossId, error: error instanceof Error ? error.message : String(error) },
			});
		}

		// Activate the Boss Rules — the ONLY way the Boss alters the game (SPEC-020).
		this.activeRuleIds = [];
		for (const config of this.definition.activeRules) {
			const id = this.ruleController.activate(config);
			if (id) {
				this.activeRuleIds.push(id);
			}
		}
		this.emit("BossRulesActivated", roundNumber, { bossId, ruleIds: [...this.activeRuleIds] });

		this.emit("BossIntroCompleted", roundNumber, {
			bossId,
			finalChallengeId: this.definition.finalChallengeId,
		});
		return { status: "spawned", finalChallengeId: this.definition.finalChallengeId };
	}

	/**
	 * Finishes the Boss when the match resolves (SPEC-020 "Finalización"): removes
	 * every Boss Rule and emits BossRulesRemoved + BossFinished. Idempotent — a
	 * finish while not active is ignored.
	 */
	finish(round?: number): void {
		if (this.state !== "active") {
			return;
		}
		const bossId = this.definition.id;
		const roundNumber = round ?? this.getRound();
		const removed = [...this.activeRuleIds];
		for (const ruleId of removed) {
			this.ruleController.remove(ruleId);
		}
		this.activeRuleIds = [];
		this.emit("BossRulesRemoved", roundNumber, { bossId, ruleIds: removed });
		this.state = "finished";
		this.emit("BossFinished", roundNumber, { bossId });
	}

	/** The Final Challenge the Boss starts (SPEC-020 "Final Challenge"). */
	getFinalChallengeId(): string {
		return this.definition.finalChallengeId;
	}

	getState(): BossLifecycle {
		return this.state;
	}

	serialize(): BossSnapshot {
		return {
			tournamentId: this.tournamentId,
			bossId: this.definition.id,
			state: this.state,
			activeRuleIds: [...this.activeRuleIds],
		};
	}

	private emit<TName extends TournamentEventName>(
		name: TName,
		round: number,
		payload: TournamentEventPayloadMap[TName],
	): void {
		const event = createTournamentEvent({
			name,
			tournamentId: this.tournamentId,
			round,
			playerId: null,
			payload,
			timestamp: this.clock.now(),
		});
		this.bus.emit(event as AnyTournamentEvent);
	}
}
