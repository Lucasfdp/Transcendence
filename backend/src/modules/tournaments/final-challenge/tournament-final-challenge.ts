/**
 * tournament-final-challenge.ts — the Final Challenge System (SPEC-021).
 *
 * ONE INSTANCE PER TOURNAMENT. The LAST PHASE of the match (SPEC-021
 * "Filosofía": not a combat) — started automatically after the Boss intro (the
 * Boss is ONLY the trigger; full decoupling), it runs the v1 victory condition:
 * MINIGAME SUDDEN DEATH (SPEC-021 "Mecánica v1") through EXACTLY the SPEC-015
 * pipeline port — one minigame with every active player, relaunched on tie /
 * no-winner until a unique winner emerges. Boss Rules stay active throughout.
 *
 * On victory (SPEC-021 "Victoria"): VictoryConditionReached → the Shell Reward
 * through the Reward Resolver (never a special implementation) → the frozen
 * final ranking (1º Shell holder, 2º+ Leaderboard order) →
 * FinalChallengeFinished (the State-Machine event towards VICTORY). The system
 * never manages economy/inventories/matchmaking/minigames and never controls
 * the Boss (SPEC-021 "Restricciones").
 *
 * Error policy (SPEC-021 "Casos límite"): a minigame that cannot run
 * (skipped/cancelled) is LOGGED and the challenge STAYS ACTIVE — `resume()`
 * re-enters the sudden death. A tie relaunches immediately.
 *
 * Determinism (SPEC-028): no own randomness (minigame selection is seeded
 * inside the SPEC-015 coordinator); time comes only from the injected clock.
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
import {
	createFinalChallengeRegistry,
	V1_FINAL_CHALLENGE_ID,
} from "./final-challenge-registry";
import {
	FinalChallengeActionRunner,
	FinalChallengeContextFactory,
	FinalChallengeDefinition,
	FinalChallengeLifecycle,
	FinalChallengeMinigamePort,
	FinalChallengeRankingPort,
	FinalChallengeRewardGranter,
	FinalChallengeRuleController,
	FinalChallengeRunResult,
	FinalChallengeSnapshot,
} from "./final-challenge.types";

export interface TournamentFinalChallengeOptions {
	readonly tournamentId: string;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	/** The SPEC-015 pipeline the sudden death runs through (SPEC-021 "Mecánica v1"). */
	readonly minigame: FinalChallengeMinigamePort;
	/** Grants the Shell Reward — ALWAYS the Reward Resolver (SPEC-021). */
	readonly rewardGranter: FinalChallengeRewardGranter;
	/** Freezes the final ranking (SPEC-021 "Clasificación final"). */
	readonly ranking: FinalChallengeRankingPort;
	/** Players still in the match — seated in every sudden-death minigame. */
	readonly getActivePlayers: () => readonly number[];
	/** Which challenge to load (defaults to the v1 sudden death). */
	readonly challengeId?: string;
	readonly registry?: Registry<FinalChallengeDefinition>;
	/** Challenge-specific Rules/Actions seams (v1 content is empty). */
	readonly ruleController?: FinalChallengeRuleController;
	readonly actionRunner?: FinalChallengeActionRunner;
	readonly makeContext?: FinalChallengeContextFactory;
	readonly getRound?: () => number;
}

const NOOP_RULES: FinalChallengeRuleController = {
	activate: () => null,
	remove: () => undefined,
};
const NOOP_RUNNER: FinalChallengeActionRunner = { run: () => [] };

export class TournamentFinalChallenge {
	private readonly tournamentId: string;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly minigame: FinalChallengeMinigamePort;
	private readonly rewardGranter: FinalChallengeRewardGranter;
	private readonly ranking: FinalChallengeRankingPort;
	private readonly getActivePlayers: () => readonly number[];
	private readonly definition: FinalChallengeDefinition;
	private readonly ruleController: FinalChallengeRuleController;
	private readonly actionRunner: FinalChallengeActionRunner;
	private readonly makeContext: FinalChallengeContextFactory;
	private readonly getRound: () => number;

	private state: FinalChallengeLifecycle = "idle";
	private attempts = 0;
	private winnerId: number | null = null;
	private activeRuleIds: string[] = [];
	/** Re-entrancy guard: one sudden-death loop at a time. */
	private running = false;

	constructor(options: TournamentFinalChallengeOptions) {
		this.tournamentId = options.tournamentId;
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("FinalChallenge") ??
			new TournamentLogger({ tournamentId: this.tournamentId, system: "FinalChallenge" });
		this.minigame = options.minigame;
		this.rewardGranter = options.rewardGranter;
		this.ranking = options.ranking;
		this.getActivePlayers = options.getActivePlayers;
		const registry = options.registry ?? createFinalChallengeRegistry({ seed: true });
		this.definition = registry.get(options.challengeId ?? V1_FINAL_CHALLENGE_ID);
		this.ruleController = options.ruleController ?? NOOP_RULES;
		this.actionRunner = options.actionRunner ?? NOOP_RUNNER;
		this.getRound = options.getRound ?? (() => 0);
		this.makeContext =
			options.makeContext ??
			((input) => ({
				tournamentId: this.tournamentId,
				playerId: input.playerId,
				round: input.round,
				eventBus: this.bus,
				services: {} as never,
				clock: this.clock,
			}));
	}

	/**
	 * Starts the challenge (SPEC-021 "Inicio": automatically after the Boss —
	 * the Runtime calls this on BossIntroCompleted; never player-initiated).
	 * Emits FinalChallengeStarted, activates the challenge's own Rules, runs its
	 * start Actions, then enters the sudden death.
	 */
	async start(): Promise<FinalChallengeRunResult> {
		if (this.state === "finished") {
			return { status: "ignored", reason: "already_finished" };
		}
		if (this.state === "active") {
			return { status: "ignored", reason: "already_active" };
		}
		this.state = "active";
		const round = this.getRound();
		this.emit("FinalChallengeStarted", round, null, { challengeId: this.definition.id });

		// Challenge-specific Rules (Boss Rules remain active alongside, SPEC-021
		// "Desarrollo") and presentation Actions — v1 content is empty.
		for (const config of this.definition.rules) {
			const id = this.ruleController.activate(config);
			if (id) {
				this.activeRuleIds.push(id);
			}
		}
		try {
			this.actionRunner.run(
				this.definition.actions,
				this.makeContext({ playerId: 0, round }),
			);
		} catch (error) {
			this.logger.error("final challenge start actions threw; continuing", {
				metadata: { error: error instanceof Error ? error.message : String(error) },
			});
		}

		return this.runSuddenDeath();
	}

	/**
	 * Re-enters the sudden death after a stall (SPEC-021 "Error interno": the
	 * challenge stays active). Ignored while idle/finished or mid-loop.
	 */
	async resume(): Promise<FinalChallengeRunResult> {
		if (this.state !== "active" || this.running) {
			return {
				status: "ignored",
				reason: this.state === "finished" ? "already_finished" : "not_active",
			};
		}
		return this.runSuddenDeath();
	}

	/**
	 * The v1 victory condition (SPEC-021 "Mecánica v1"): launch one minigame with
	 * every active player through the SPEC-015 pipeline; a unique winner takes
	 * the Shell; a tie/no-winner relaunches; a minigame that cannot run stalls
	 * the challenge (kept active, resumable).
	 */
	private async runSuddenDeath(): Promise<FinalChallengeRunResult> {
		this.running = true;
		try {
			for (;;) {
				const players = this.getActivePlayers();
				const round = this.getRound();
				const result = await this.minigame.run(players, round);

				if (result.status !== "completed") {
					this.logger.error("sudden-death minigame could not run; challenge stays active", {
						metadata: { status: result.status, reason: result.reason },
					});
					return { status: "stalled", reason: result.reason };
				}

				this.attempts += 1;
				if (result.winnerId === null) {
					// Tie / no result → relaunch (SPEC-021 "Casos límite").
					this.logger.log("sudden death tied; relaunching", {
						metadata: { attempts: this.attempts, minigameId: result.minigameId },
					});
					continue;
				}
				return this.declareVictory(result.winnerId);
			}
		} finally {
			this.running = false;
		}
	}

	/**
	 * SPEC-021 "Victoria": VictoryConditionReached → Grant Shell Reward (Reward
	 * Resolver) → Generate Final Ranking → FinalChallengeFinished. The Runtime
	 * consumes FinalChallengeFinished to transition to VICTORY and emits
	 * TournamentFinished itself — never this system.
	 */
	private declareVictory(winnerId: number): FinalChallengeRunResult {
		const round = this.getRound();
		this.emit("VictoryConditionReached", round, winnerId, {
			challengeId: this.definition.id,
			winnerId,
			attempts: this.attempts,
		});

		// The ONLY reward is THE PARROT'S SHELL, via the Reward Resolver (SPEC-021
		// "Recompensa"/"Integración con Reward Resolver"). The Shell holder emits
		// ShellGranted. A failed grant is logged, never thrown (SPEC-013).
		const grant = this.rewardGranter.grant(
			{ id: "finalChallenge:shell", type: "shell" },
			this.makeContext({ playerId: winnerId, round }),
		);
		if (grant.status !== "resolved") {
			this.logger.error("shell reward grant was rejected", {
				playerId: winnerId,
				metadata: { reason: grant.reason },
			});
		}

		// Freeze the final ranking: 1º the Shell holder, 2º+ Leaderboard order.
		this.ranking.generateFinal(winnerId);

		// Remove the challenge's own Rules (Boss Rules belong to the Boss).
		for (const ruleId of this.activeRuleIds) {
			this.ruleController.remove(ruleId);
		}
		this.activeRuleIds = [];

		this.state = "finished";
		this.winnerId = winnerId;
		this.emit("FinalChallengeFinished", round, winnerId, {
			challengeId: this.definition.id,
			winnerId,
		});
		return { status: "finished", winnerId, attempts: this.attempts };
	}

	getState(): FinalChallengeLifecycle {
		return this.state;
	}

	getWinnerId(): number | null {
		return this.winnerId;
	}

	serialize(): FinalChallengeSnapshot {
		return {
			tournamentId: this.tournamentId,
			challengeId: this.definition.id,
			state: this.state,
			attempts: this.attempts,
			winnerId: this.winnerId,
			activeRuleIds: [...this.activeRuleIds],
		};
	}

	private emit<TName extends TournamentEventName>(
		name: TName,
		round: number,
		playerId: number | null,
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
