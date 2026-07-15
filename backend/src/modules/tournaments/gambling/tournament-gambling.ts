/**
 * tournament-gambling.ts — Gambling Integration (SPEC-016).
 *
 * ONE INSTANCE PER TOURNAMENT. Offers the minigame winner a provably-fair bet of
 * Tournament POINTS whose only prize is a Key Item unlock (SPEC-016 "Objetivo").
 * It follows the same interactive-session model as the Shop, at PHASE scale
 * (SPEC-016 "Modelo de interacción"): Open (GamblingOpened) → wait for the
 * player's decision → Bet / Abandon / Timeout → Close (GamblingFinished, ALWAYS).
 *
 * Reuse boundaries (SPEC-016 "Decisión de integración"/"Restricciones"): the
 * stake is charged against the Tournament Economy (never `users.coins`/`wagers`/
 * CasinoEngine); fairness uses ONLY the casino's provably-fair primitives via the
 * injected `GamblingFairness` port (seeds per bet, NOT the tournament seed, so
 * the outcome is outside the determinism layer — SPEC-000); the reward is always
 * a Key Item through the Reward Resolver. The win probability (with pity) is
 * computed by the Runtime and passed in — this module never hardcodes it.
 *
 * Determinism of TIME (SPEC-028): the decision timeout uses the injected clock
 * only. The bet OUTCOME is intentionally non-deterministic (external fact).
 */

import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	GamblingOutcome,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TimerHandle, TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import {
	GamblingBetResult,
	GamblingContextFactory,
	GamblingEconomyPort,
	GamblingFairness,
	GamblingKeyItemGate,
	GamblingOpenResult,
	GamblingRewardGranter,
	GamblingSnapshot,
} from "./gambling.types";

export interface TournamentGamblingOptions {
	readonly tournamentId: string;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	readonly economy: GamblingEconomyPort;
	readonly rewardGranter: GamblingRewardGranter;
	readonly keyItems: GamblingKeyItemGate;
	readonly fairness: GamblingFairness;
	readonly makeContext: GamblingContextFactory;
	/** Points staked per bet (SPEC-024 gambling.cost). */
	readonly cost: number;
	/** Decision timeout in ms (SPEC-024 gamblingDecisionSeconds). */
	readonly decisionTimeoutMs: number;
	readonly getRound?: () => number;
}

interface GamblingSession {
	readonly winnerId: number;
	readonly cost: number;
	readonly winChance: number;
	readonly round: number;
	readonly deadlineAt: number;
	timer?: TimerHandle;
}

export class TournamentGambling {
	private readonly tournamentId: string;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly economy: GamblingEconomyPort;
	private readonly rewardGranter: GamblingRewardGranter;
	private readonly keyItems: GamblingKeyItemGate;
	private readonly fairness: GamblingFairness;
	private readonly makeContext: GamblingContextFactory;
	private readonly cost: number;
	private readonly decisionTimeoutMs: number;
	private readonly getRound: () => number;

	private session: GamblingSession | null = null;
	private readonly nonces = new Map<number, number>();

	constructor(options: TournamentGamblingOptions) {
		this.tournamentId = options.tournamentId;
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("Gambling") ??
			new TournamentLogger({ tournamentId: this.tournamentId, system: "Gambling" });
		this.economy = options.economy;
		this.rewardGranter = options.rewardGranter;
		this.keyItems = options.keyItems;
		this.fairness = options.fairness;
		this.makeContext = options.makeContext;
		this.cost = options.cost;
		this.decisionTimeoutMs = options.decisionTimeoutMs;
		this.getRound = options.getRound ?? (() => 0);
	}

	/** The winner whose Gambling session is open, or null. */
	get openSessionWinnerId(): number | null {
		return this.session?.winnerId ?? null;
	}

	/**
	 * Opens the Gambling phase for the minigame winner (SPEC-016 "Apertura").
	 * Assumes the caller already verified a UNIQUE, connected winner. Opens even
	 * when the winner cannot afford the bet (they may only abandon). Skips when no
	 * Key Item remains locked (progress complete). Starts the decision timeout.
	 */
	open(winnerId: number, winChance: number, round?: number): GamblingOpenResult {
		if (this.session) {
			return { status: "ignored", reason: "session_in_progress" };
		}
		if (!this.keyItems.hasLockedRemaining()) {
			return { status: "skipped", reason: "no_locked_key_items" };
		}

		const roundNumber = round ?? this.getRound();
		const deadlineAt = this.clock.now() + this.decisionTimeoutMs;
		const canAfford = (this.economy.getBalance(winnerId) ?? 0) >= this.cost;
		this.session = { winnerId, cost: this.cost, winChance, round: roundNumber, deadlineAt };
		this.session.timer = this.clock.schedule(this.decisionTimeoutMs, () =>
			this.onTimeout(winnerId),
		);

		this.emit("GamblingOpened", winnerId, roundNumber, {
			cost: this.cost,
			winChance,
			deadlineAt,
			canAfford,
		});
		return { status: "opened", canAfford };
	}

	/**
	 * Places the winner's bet (SPEC-016 "Flujo"): charge points, resolve provably-
	 * fair, and on a win request a Key Item unlock through the Reward Resolver.
	 * Rejections that leave the session open: no session / not the winner /
	 * insufficient points (never an auto-bet). The phase always closes with
	 * GamblingFinished when a bet resolves.
	 */
	bet(winnerId: number, clientSeed = ""): GamblingBetResult {
		const session = this.session;
		if (!session) {
			return { status: "rejected", reason: "no_session" };
		}
		if (session.winnerId !== winnerId) {
			this.logger.warn("bet from a non-winner ignored", { metadata: { winnerId } });
			return { status: "rejected", reason: "not_winner" };
		}
		if ((this.economy.getBalance(winnerId) ?? 0) < session.cost) {
			// SPEC-016 "Sin puntos suficientes": never auto-bet; session stays open.
			return { status: "rejected", reason: "insufficient_points" };
		}

		const charged = this.economy.remove(
			winnerId,
			session.cost,
			"gambling:bet",
			"gambling",
		);
		if (charged.status !== "success") {
			this.logger.error("gambling charge failed after affordability check", {
				metadata: { winnerId, rejection: charged.rejection },
			});
			this.close(session, "error", "error");
			return { status: "rejected", reason: "error" };
		}

		// Provably-fair resolution (SPEC-016): per-bet seeds, verifiable roll.
		const nonce = this.nonces.get(winnerId) ?? 0;
		this.nonces.set(winnerId, nonce + 1);
		const serverSeed = this.fairness.serverSeed();
		const commitment = this.fairness.commit(serverSeed);
		const roll = this.fairness.roll(serverSeed, clientSeed, nonce);
		this.emit("GamblingStarted", winnerId, session.round, {
			cost: session.cost,
			commitment,
		});

		const reveal = {
			roll,
			winChance: session.winChance,
			serverSeed,
			clientSeed,
			nonce,
			commitment,
		};
		const won = roll < session.winChance;
		if (won) {
			// The prize is ALWAYS a Key Item, ALWAYS via the Reward Resolver
			// (SPEC-016 "Recompensa"). Key Item Progression emits KeyItemUnlocked.
			this.rewardGranter.grant(
				{ id: "gambling:keyItem", type: "keyItem", payload: {} },
				this.makeContext({ playerId: winnerId, round: session.round }),
			);
			this.emit("GamblingWon", winnerId, session.round, { ...reveal, cost: session.cost });
			this.close(session, "won");
			return { status: "won" };
		}

		this.emit("GamblingLost", winnerId, session.round, { ...reveal, cost: session.cost });
		this.close(session, "lost");
		return { status: "lost" };
	}

	/** The winner declines the bet (SPEC-016): the phase closes as abandoned. */
	abandon(winnerId: number): void {
		const session = this.session;
		if (!session || session.winnerId !== winnerId) {
			return;
		}
		this.close(session, "abandoned", "abandoned");
	}

	serialize(): GamblingSnapshot {
		return {
			tournamentId: this.tournamentId,
			session: this.session
				? {
						winnerId: this.session.winnerId,
						cost: this.session.cost,
						winChance: this.session.winChance,
						deadlineAt: this.session.deadlineAt,
				  }
				: null,
			nonces: Object.fromEntries(this.nonces),
		};
	}

	// ── Internals ──────────────────────────────────────────────────────────────

	private onTimeout(winnerId: number): void {
		const session = this.session;
		if (!session || session.winnerId !== winnerId) {
			return;
		}
		// SPEC-016 "Timeout de decisión": resolve as abandonment, never auto-bet.
		this.close(session, "timeout", "timeout");
	}

	/**
	 * Closes the phase (SPEC-016 "Modelo de interacción"). For a non-resolved
	 * outcome, a GamblingCancelled detail event precedes; GamblingFinished is
	 * emitted ALWAYS — it is what the State Machine consumes.
	 */
	private close(
		session: GamblingSession,
		outcome: GamblingOutcome,
		cancelReason?: "abandoned" | "timeout" | "error",
	): void {
		if (session.timer) {
			this.clock.cancel(session.timer);
		}
		this.session = null;
		if (cancelReason) {
			this.emit("GamblingCancelled", session.winnerId, session.round, {
				reason: cancelReason,
			});
		}
		this.emit("GamblingFinished", session.winnerId, session.round, { outcome });
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
