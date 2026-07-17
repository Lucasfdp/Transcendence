/**
 * tournament-minigame.ts — Minigame Integration coordinator (SPEC-015).
 *
 * ONE INSTANCE PER TOURNAMENT. Orchestrates ONE round's minigame end-to-end as a
 * pure CONSUMER of the existing platform (SPEC-015 "Objetivo"/"Principios"): it
 * selects a minigame with the tournament seed, launches a match through the
 * injected launcher (always `mode: casual`, server-initiated — the adapter's
 * job), enters a blocking logical wait on lifecycle events (NO polling, NO CPU
 * — SPEC-015 "Espera") backed by a reconciliation watchdog, awards outcome
 * points through the Reward Resolver (source Minigame), and returns the single
 * winner to feed Gambling. It NEVER implements gameplay, scoring, matchmaking or
 * synchronisation, and never imports the matchmaking module — only the ports.
 *
 * Determinism (SPEC-028): selection uses the seed only; all time (the watchdog,
 * event timestamps) comes from the injected clock. The minigame RESULT itself is
 * an external, non-deterministic fact that enters as an event (SPEC-000/015),
 * exactly like gambling.
 */

import { ActionContext } from "../actions/action.interface";
import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TimerHandle, TournamentClock } from "../infra/clock";
import { createSeededRng } from "../infra/seeded-rng";
import { TournamentLogger } from "../infra/tournament-logger";
import { GrantRewardResult, Reward } from "../rewards/reward.types";
import { EMPTY_MINIGAME_CATALOG } from "./minigame-catalog";
import {
	MinigameCatalogPort,
	MinigameFinalResult,
	MinigameLauncherPort,
	MinigameLifecyclePort,
	MinigameReconcilerPort,
	MinigameRewardSettings,
	MinigameRoundResult,
	MinigameSnapshot,
} from "./minigame.types";

/** Grants a Reward for a minigame outcome (satisfied by the Reward Resolver). */
export interface MinigameRewardGranter {
	grant(reward: Reward, context: ActionContext): GrantRewardResult;
}

/** Builds the ActionContext a minigame outcome Reward is granted against. */
export type MinigameContextFactory = (input: {
	playerId: number;
	round: number;
}) => ActionContext;

export interface TournamentMinigameOptions {
	readonly tournamentId: string;
	readonly seed: string;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	/** Points per outcome (SPEC-024 minigameReward). */
	readonly reward: MinigameRewardSettings;
	/** Reconciliation watchdog (SPEC-024 minigameWatchdogMinutes, in ms). */
	readonly watchdogMs: number;
	/** Platform ports — inert defaults make the coordinator standalone-testable. */
	readonly launcher?: MinigameLauncherPort;
	readonly lifecycle?: MinigameLifecyclePort;
	readonly reconciler?: MinigameReconcilerPort;
	readonly catalog?: MinigameCatalogPort;
	/** Outcome-point granting (defaults to a no-op granter). */
	readonly rewardGranter?: MinigameRewardGranter;
	readonly makeContext?: MinigameContextFactory;
	readonly getRound?: () => number;
}

/** Inert launcher: nothing to launch ⇒ the round skips its minigame. */
const NOOP_LAUNCHER: MinigameLauncherPort = {
	launch: async () => ({ status: "error", reason: "no_launcher" }),
};
const NOOP_LIFECYCLE: MinigameLifecyclePort = { subscribe: () => () => undefined };
const NOOP_RECONCILER: MinigameReconcilerPort = { reconcile: async () => null };
const NOOP_GRANTER: MinigameRewardGranter = {
	grant: () => ({ status: "resolved", rewardId: "noop", results: [] }),
};

export class TournamentMinigame {
	private readonly tournamentId: string;
	private readonly seed: string;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly reward: MinigameRewardSettings;
	private readonly watchdogMs: number;
	private readonly launcher: MinigameLauncherPort;
	private readonly lifecycle: MinigameLifecyclePort;
	private readonly reconciler: MinigameReconcilerPort;
	private readonly catalog: MinigameCatalogPort;
	private readonly rewardGranter: MinigameRewardGranter;
	private readonly makeContext: MinigameContextFactory;
	private readonly getRound: () => number;

	/** Monotonic selection index, namespaced into the seed (part of snapshot). */
	private selectionCount = 0;
	/** The match currently awaited (for the snapshot / a single in-flight run). */
	private pendingMatchId: string | null = null;

	constructor(options: TournamentMinigameOptions) {
		this.tournamentId = options.tournamentId;
		this.seed = options.seed;
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("Minigame") ??
			new TournamentLogger({ tournamentId: this.tournamentId, system: "Minigame" });
		this.reward = options.reward;
		this.watchdogMs = options.watchdogMs;
		this.launcher = options.launcher ?? NOOP_LAUNCHER;
		this.lifecycle = options.lifecycle ?? NOOP_LIFECYCLE;
		this.reconciler = options.reconciler ?? NOOP_RECONCILER;
		this.catalog = options.catalog ?? EMPTY_MINIGAME_CATALOG;
		this.rewardGranter = options.rewardGranter ?? NOOP_GRANTER;
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
	 * Runs one round's minigame for the ACTIVE players (SPEC-015 "Pipeline").
	 * Returns `completed` with the single winner (null on a tie) to feed Gambling,
	 * or `skipped`/`cancelled` when the round must continue with no winner. Never
	 * throws — any platform error resolves to `cancelled` (SPEC-015 "Errores").
	 */
	async run(activePlayerIds: readonly number[], round?: number): Promise<MinigameRoundResult> {
		const roundNumber = round ?? this.getRound();
		const active = [...activePlayerIds];

		// Fewer than two active players → skip (SPEC-015 "Selección").
		if (active.length < 2) {
			return this.skip("insufficient_active_players", active, roundNumber, 0);
		}

		const candidates = this.catalog.candidates(active.length);
		this.emit("MinigameSelectionStarted", null, roundNumber, {
			activePlayers: active,
			candidateCount: candidates.length,
		});
		if (candidates.length === 0) {
			this.logger.warn("no minigame supports the active player count; skipping", {
				metadata: { activeCount: active.length },
			});
			return this.skip("no_candidate_minigame", active, roundNumber, candidates.length);
		}

		// Deterministic selection from the seed (SPEC-000/015 "Selección").
		const minigameId = this.selectSeeded(candidates);
		this.emit("MinigameSelected", null, roundNumber, { minigameId });

		// Launch through the platform (SPEC-015 "Match Creation"): errors cancel.
		let launch;
		try {
			launch = await this.launcher.launch({
				tournamentId: this.tournamentId,
				round: roundNumber,
				minigameId,
				playerIds: active,
			});
		} catch (error) {
			return this.cancel("launch_threw", roundNumber, { minigameId, error });
		}
		if (launch.status !== "launched") {
			return this.cancel(`launch_error:${launch.reason}`, roundNumber, { minigameId });
		}

		const matchId = launch.matchId;
		this.pendingMatchId = matchId;
		this.emit("MinigameLoading", null, roundNumber, { minigameId, matchId });

		// Blocking logical wait on lifecycle events + reconciliation watchdog.
		const result = await this.awaitResult(matchId, minigameId, roundNumber);
		this.pendingMatchId = null;

		// Result-less match (cancelled / watchdog found nothing) → cancel the round.
		if (!result) {
			return this.cancel("no_result", roundNumber, { minigameId, matchId });
		}

		// Award outcome points to every ACTIVE player through the Reward Resolver
		// (SPEC-015 "Resultado"; passives/disconnected already excluded).
		this.awardOutcomePoints(active, result, roundNumber);

		const tie = result.winnerId === null;
		this.emit("MinigameFinished", result.winnerId, roundNumber, {
			minigameId,
			matchId,
			winnerId: result.winnerId,
			tie,
		});
		return { status: "completed", minigameId, matchId, winnerId: result.winnerId, tie };
	}

	getPendingMatchId(): string | null {
		return this.pendingMatchId;
	}

	serialize(): MinigameSnapshot {
		return {
			tournamentId: this.tournamentId,
			selectionCount: this.selectionCount,
			pendingMatchId: this.pendingMatchId,
		};
	}

	// ── Internals ──────────────────────────────────────────────────────────────

	/** Picks a candidate deterministically from the seed (advances the counter). */
	private selectSeeded(candidates: readonly string[]): string {
		const rng = createSeededRng(`${this.seed}:minigame:${this.selectionCount}`);
		this.selectionCount += 1;
		const index = Math.floor(rng() * candidates.length) % candidates.length;
		return candidates[index];
	}

	/**
	 * Awaits the FIRST of: a finished/abandoned lifecycle signal for this match,
	 * or the watchdog (SPEC-015 "Espera"/"Watchdog"). The watchdog reconciles the
	 * `matches` table ONCE; a missing result resolves to null (⇒ cancelled). A
	 * `started` signal emits MinigameStarted. Subscriptions and the timer are
	 * always cleaned up on settle.
	 */
	private awaitResult(
		matchId: string,
		minigameId: string,
		round: number,
	): Promise<MinigameFinalResult | null> {
		return new Promise((resolve) => {
			let settled = false;
			let startedEmitted = false;
			let timer: TimerHandle | undefined;
			let unsubscribe: () => void = () => undefined;

			const settle = (result: MinigameFinalResult | null): void => {
				if (settled) {
					return;
				}
				settled = true;
				unsubscribe();
				if (timer) {
					this.clock.cancel(timer);
				}
				resolve(result);
			};

			unsubscribe = this.lifecycle.subscribe((signal) => {
				if (signal.matchId !== matchId) {
					return;
				}
				if (signal.type === "started") {
					if (!startedEmitted) {
						startedEmitted = true;
						this.emit("MinigameStarted", null, round, { minigameId, matchId });
					}
					return;
				}
				if (signal.type === "finished" || signal.type === "abandoned") {
					settle(signal.result ?? null);
				} else if (signal.type === "cancelled") {
					settle(null);
				}
			});

			timer = this.clock.schedule(this.watchdogMs, () => {
				// One reconciliation against the durable `matches` table (SPEC-015).
				this.reconciler
					.reconcile(matchId)
					.then((reconciled) => {
						this.logger.warn("minigame watchdog fired; reconciled once", {
							metadata: { matchId, found: reconciled !== null },
						});
						settle(reconciled);
					})
					.catch((error) => {
						this.logger.error("minigame reconciliation failed; treating as no result", {
							metadata: {
								matchId,
								error: error instanceof Error ? error.message : String(error),
							},
						});
						settle(null);
					});
			});
		});
	}

	/**
	 * Grants a PointsReward per active player through the Reward Resolver: the
	 * winner gets `reward.winner`, everyone else `reward.participant` (SPEC-015
	 * "Resultado", source Minigame). Rewards flow through the one resolver so
	 * rules/leaderboard react exactly as for any other points.
	 */
	private awardOutcomePoints(
		active: readonly number[],
		result: MinigameFinalResult,
		round: number,
	): void {
		for (const playerId of active) {
			const isWinner = result.winnerId !== null && playerId === result.winnerId;
			const amount = isWinner ? this.reward.winner : this.reward.participant;
			if (amount <= 0) {
				continue;
			}
			this.rewardGranter.grant(
				{
					id: `minigame:${isWinner ? "winner" : "participant"}`,
					type: "points",
					payload: {
						amount,
						source: "minigame",
						reason: isWinner ? "minigame:winner" : "minigame:participant",
					},
				},
				this.makeContext({ playerId, round }),
			);
		}
	}

	private skip(
		reason: string,
		_active: readonly number[],
		round: number,
		_candidateCount: number,
	): MinigameRoundResult {
		this.emit("MinigameCancelled", null, round, { reason });
		return { status: "skipped", reason };
	}

	private cancel(
		reason: string,
		round: number,
		metadata?: Readonly<Record<string, unknown>>,
	): MinigameRoundResult {
		this.pendingMatchId = null;
		this.logger.warn(`minigame round cancelled: ${reason}`, { metadata });
		this.emit("MinigameCancelled", null, round, { reason });
		return { status: "cancelled", reason };
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
