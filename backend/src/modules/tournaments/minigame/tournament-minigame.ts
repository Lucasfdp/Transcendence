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
	MinigameLaunchGateState,
	MinigameLauncherPort,
	MinigameLifecyclePort,
	MinigameReconcilerPort,
	MinigameRewardSettings,
	MinigameRoundResult,
	MinigameSnapshot,
	MinigameTieBreakState,
} from "./minigame.types";

/** Configuration of the pre-launch confirmation gate (SPEC-015 v2). */
export interface MinigameLaunchGateConfig {
	/** Minimum hold after the gate opens, even with every confirmation in. */
	readonly minMs: number;
	/** Hard deadline: the match launches anyway when it passes. */
	readonly timeoutMs: number;
	/** Seats that never need to confirm (CPUs, disconnected humans). */
	readonly isAutoReady: (playerId: number) => boolean;
}

/**
 * How long the tie-break roulette holds the round (SPEC-015 "Desempates", v2):
 * clients spin for ~4.4 s and reveal the winner; the coordinator resumes after
 * this window so every client finishes the presentation (and can actually READ
 * the result, ~3.5 s) before Gambling opens.
 */
export const TIE_BREAK_SPIN_MS = 8_000;

/**
 * Audience gate for the tie-break (SPEC-015 v2): after a tied minigame the
 * players are still riding the arena's CONTINUE screen back to the board, so
 * the roulette waits until everyone required is present (or the timeout) —
 * otherwise the spin would play to an empty room and the result would be gone
 * before anyone returned.
 */
export interface TieBreakGateConfig {
	/** Spin anyway when this passes (a player who never returns can't block). */
	readonly arrivalTimeoutMs: number;
	/** Seats that need no live board (CPUs); connected humans are present. */
	readonly isPresent: (playerId: number) => boolean;
}

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
	/**
	 * Pre-launch confirmation gate ("MINIGAME TIME!", SPEC-015 v2): when set,
	 * the selected minigame waits for every required player's `confirmLaunch`
	 * (or the deadline) before launching. Absent ⇒ launch immediately (the
	 * Phase-1 behaviour, and what standalone coordinator tests expect).
	 */
	readonly launchGate?: MinigameLaunchGateConfig;
	/**
	 * Audience gate for the tie-break roulette: when set, the spin waits for
	 * every player's board to be present (or the timeout). Absent ⇒ spin
	 * immediately (standalone coordinator tests).
	 */
	readonly tieBreakGate?: TieBreakGateConfig;
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
	private readonly launchGateConfig: MinigameLaunchGateConfig | null;
	private readonly tieBreakGateConfig: TieBreakGateConfig | null;
	/** Poked by `notifyPresenceChanged` while the tie-break audience gate waits. */
	private presenceWaiter: (() => void) | null = null;

	/** Monotonic selection index, namespaced into the seed (part of snapshot). */
	private selectionCount = 0;
	/** The match currently awaited (for the snapshot / a single in-flight run). */
	private pendingMatchId: string | null = null;
	/** The live tie-break roulette, while one is spinning (part of snapshot). */
	private tieBreak: MinigameTieBreakState | null = null;
	/** The live pre-launch gate, while one is open (part of snapshot). */
	private gateState: {
		minigameId: string;
		playerIds: readonly number[];
		readyPlayerIds: number[];
		deadlineAt: number;
		openedAt: number;
	} | null = null;
	/** Resolves the gate's hold; null when no gate is open / already closed. */
	private gateResolve: (() => void) | null = null;

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
		this.launchGateConfig = options.launchGate ?? null;
		this.tieBreakGateConfig = options.tieBreakGate ?? null;
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

		// "MINIGAME TIME!" (SPEC-015 v2): hold the launch until every required
		// player confirmed (or the deadline) — the round never jumps straight
		// from the last dice roll into the arena.
		if (this.launchGateConfig) {
			await this.awaitLaunchGate(minigameId, active, roundNumber);
		}

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

		// A tie never stands in tournament mode (SPEC-015 "Desempates", v2):
		// a seeded roulette among the tied players decides the round winner.
		// The winner is final the moment the tie-break opens — the spin the
		// clients play is pure presentation — and the round HOLDS until
		// `resolveAt` so everyone watches the roulette land before Gambling.
		let finalWinnerId = result.winnerId;
		if (finalWinnerId === null) {
			const tied = this.tiedCandidates(result, active);
			if (tied.length >= 2) {
				finalWinnerId = this.selectTieBreakWinner(tied, roundNumber, matchId);
				// The players are still riding the arena's CONTINUE screen back
				// to the board — wait for the audience (or the timeout) so the
				// spin plays IN SYNC for everyone instead of to an empty room.
				await this.awaitTieBreakAudience(active);
				const resolveAt = this.clock.now() + TIE_BREAK_SPIN_MS;
				this.tieBreak = { playerIds: tied, winnerId: finalWinnerId, resolveAt };
				this.emit("MinigameTieBreakStarted", finalWinnerId, roundNumber, {
					minigameId,
					matchId,
					playerIds: tied,
					winnerId: finalWinnerId,
					resolveAt,
				});
				await new Promise<void>((resolve) => {
					this.clock.schedule(TIE_BREAK_SPIN_MS, resolve);
				});
				this.tieBreak = null;
			}
		}

		// Award outcome points to every ACTIVE player through the Reward Resolver
		// (SPEC-015 "Resultado"; passives/disconnected already excluded). After a
		// tie-break the roulette winner takes the winner's reward.
		this.awardOutcomePoints(
			active,
			{ ...result, winnerId: finalWinnerId },
			roundNumber,
		);

		const tie = finalWinnerId === null;
		this.emit("MinigameFinished", finalWinnerId, roundNumber, {
			minigameId,
			matchId,
			winnerId: finalWinnerId,
			tie,
		});
		return { status: "completed", minigameId, matchId, winnerId: finalWinnerId, tie };
	}

	getPendingMatchId(): string | null {
		return this.pendingMatchId;
	}

	/**
	 * A player pressed "Let's go!" on the MINIGAME TIME! gate. Rejections are
	 * harmless (no gate open, not seated, double click); once every required
	 * player confirmed, the gate closes after its minimum hold and the match
	 * launches.
	 */
	confirmLaunch(
		playerId: number,
	):
		| { status: "ok" }
		| {
				status: "rejected";
				reason: "no_launch_gate" | "not_participant" | "already_ready";
		  } {
		const gate = this.gateState;
		if (!gate) {
			return { status: "rejected", reason: "no_launch_gate" };
		}
		if (!gate.playerIds.includes(playerId)) {
			return { status: "rejected", reason: "not_participant" };
		}
		if (gate.readyPlayerIds.includes(playerId)) {
			return { status: "rejected", reason: "already_ready" };
		}
		gate.readyPlayerIds.push(playerId);
		this.emit("MinigameLaunchConfirmed", playerId, this.getRound(), {
			minigameId: gate.minigameId,
			readyCount: gate.readyPlayerIds.length,
		});
		this.maybeCloseGate();
		return { status: "ok" };
	}

	serialize(): MinigameSnapshot {
		return {
			tournamentId: this.tournamentId,
			selectionCount: this.selectionCount,
			pendingMatchId: this.pendingMatchId,
			tieBreak: this.tieBreak,
			launchGate: this.gateState
				? {
						minigameId: this.gateState.minigameId,
						playerIds: [...this.gateState.playerIds],
						readyPlayerIds: [...this.gateState.readyPlayerIds],
						deadlineAt: this.gateState.deadlineAt,
					}
				: null,
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
	 * Opens the MINIGAME TIME! gate and holds until every required player
	 * confirmed (plus the minimum beat) or the deadline passed. Auto-ready
	 * seats (CPUs, disconnected humans) never block; the deadline guarantees
	 * the round always continues.
	 */
	private async awaitLaunchGate(
		minigameId: string,
		active: readonly number[],
		round: number,
	): Promise<void> {
		const config = this.launchGateConfig;
		if (!config) {
			return;
		}
		const openedAt = this.clock.now();
		const deadlineAt = openedAt + config.timeoutMs;
		this.gateState = {
			minigameId,
			playerIds: [...active],
			readyPlayerIds: [],
			deadlineAt,
			openedAt,
		};
		this.emit("MinigameLaunchGateOpened", null, round, {
			minigameId,
			playerIds: [...active],
			deadlineAt,
		});
		const deadlineTimer = this.clock.schedule(config.timeoutMs, () => {
			this.closeGate();
		});
		await new Promise<void>((resolve) => {
			this.gateResolve = resolve;
			// Every seat may already be auto-ready (all-CPU stretch): the gate
			// then closes after just the minimum hold.
			this.maybeCloseGate();
		});
		this.clock.cancel(deadlineTimer);
		this.gateState = null;
	}

	/**
	 * A player's board connected (or a seat became a CPU): re-check any
	 * waiting tie-break audience gate. Cheap no-op when nothing waits.
	 */
	notifyPresenceChanged(): void {
		this.presenceWaiter?.();
	}

	/** Holds the tie-break until every player is present or the timeout. */
	private async awaitTieBreakAudience(active: readonly number[]): Promise<void> {
		const gate = this.tieBreakGateConfig;
		if (!gate) {
			return;
		}
		const allPresent = (): boolean => active.every((id) => gate.isPresent(id));
		if (allPresent()) {
			return;
		}
		await new Promise<void>((resolve) => {
			let finished = false;
			const finish = (): void => {
				if (finished) return;
				finished = true;
				this.presenceWaiter = null;
				resolve();
			};
			const timer = this.clock.schedule(gate.arrivalTimeoutMs, finish);
			this.presenceWaiter = () => {
				if (allPresent()) {
					this.clock.cancel(timer);
					finish();
				}
			};
			// A board may have connected between the check above and the waiter
			// being installed — re-check once so that race can't stall the gate.
			this.presenceWaiter();
		});
	}

	/** Closes the gate once nobody required is missing (min hold respected). */
	private maybeCloseGate(): void {
		const gate = this.gateState;
		const config = this.launchGateConfig;
		if (!gate || !config || !this.gateResolve) {
			return;
		}
		const pending = gate.playerIds.filter(
			(id) =>
				!gate.readyPlayerIds.includes(id) && !config.isAutoReady(id),
		);
		if (pending.length > 0) {
			return;
		}
		const remaining = gate.openedAt + config.minMs - this.clock.now();
		if (remaining <= 0) {
			this.closeGate();
		} else {
			this.clock.schedule(remaining, () => this.closeGate());
		}
	}

	private closeGate(): void {
		const resolve = this.gateResolve;
		this.gateResolve = null;
		resolve?.();
	}

	/**
	 * Who spins in the tie-break: the platform's tied-for-top-score subset when
	 * it reported one, otherwise every active player — always intersected with
	 * `active` so nobody outside the round's seats can win it.
	 */
	private tiedCandidates(
		result: MinigameFinalResult,
		active: readonly number[],
	): number[] {
		const reported = result.tiedPlayerIds?.filter((id) => active.includes(id)) ?? [];
		return reported.length >= 2 ? reported : [...active];
	}

	/** Seeded roulette pick (SPEC-000: same seed + same match ⇒ same winner). */
	private selectTieBreakWinner(
		tied: readonly number[],
		round: number,
		matchId: string,
	): number {
		const rng = createSeededRng(`${this.seed}:tiebreak:${round}:${matchId}`);
		const index = Math.floor(rng() * tied.length) % tied.length;
		return tied[index];
	}

	/**
	 * Awaits the FIRST of: a finished/abandoned lifecycle signal for this match,
	 * or the watchdog (SPEC-015 "Espera"/"Watchdog"). When the watchdog fires it
	 * reconciles the `matches` table; a missing result normally resolves to null
	 * (⇒ cancelled), but while the reconciler reports the match as still LIVE
	 * (players genuinely mid-game — a long temple-curling end can outlast the
	 * watchdog window) the watchdog re-arms instead, so the round keeps waiting
	 * for the real result and the true winner still gets their Gambling. A
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

			const armWatchdog = (): void => {
				timer = this.clock.schedule(this.watchdogMs, () => {
					// Reconciliation against the durable `matches` table (SPEC-015).
					this.reconciler
						.reconcile(matchId)
						.then(async (reconciled) => {
							if (reconciled !== null) {
								this.logger.warn("minigame watchdog fired; reconciled a result", {
									metadata: { matchId, found: true },
								});
								settle(reconciled);
								return;
							}
							const live = await this.reconciler.isMatchLive?.(matchId);
							if (live === true && !settled) {
								// The arena is still being played — the room dying in ANY
								// way (finish, abandon, abort) fires a lifecycle signal
								// that settles this wait, so extending is always safe.
								this.logger.warn(
									"minigame watchdog fired; match still live — extending the wait",
									{ metadata: { matchId, minigameId } },
								);
								armWatchdog();
								return;
							}
							this.logger.warn("minigame watchdog fired; reconciled once", {
								metadata: { matchId, found: false },
							});
							settle(null);
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
			};
			armWatchdog();
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
