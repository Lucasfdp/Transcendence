/**
 * tournament-economy.ts — Tournament Economy System (SPEC-011,
 * Phase-1 in-memory version).
 *
 * ONE INSTANCE PER TOURNAMENT. This is the ONLY system authorized to modify
 * a player's points during a match (SPEC-011 "Objetivo"): every gain or loss
 * of points MUST pass through here, and no other module may mutate points
 * directly. Points are a strategic in-match resource — NOT experience, NOT
 * persistent coins, NOT account progress; their life begins when the match
 * starts and ends when it finishes (SPEC-011 "Filosofía"). Consequently this
 * engine NEVER touches TypeORM and NEVER reads/writes `users.coins`
 * (SPEC-011 "Relación con la economía persistente" / "Sincronización").
 *
 * It knows nothing of Board, Minigames, Gambling, Shop, Boss or UI
 * (SPEC-011 "Restricciones"): those systems merely call the public commands
 * (award/remove/transfer) and consume the emitted events.
 *
 * Determinism (SPEC-028): no `Math.random`, no `Date.now`. Timestamps come
 * exclusively from the injected TournamentClock; the only randomness is
 * `randomUUID` for transaction identity (identity, not gameplay randomness).
 *
 * Pattern mirrors tournament-runtime.ts: constructor takes bus/clock/logger,
 * emits via `createTournamentEvent(...)` cast to `AnyTournamentEvent`, and
 * exposes a JSON-safe `serialize()` for embedding in the Runtime snapshot.
 */

import { randomUUID } from "node:crypto";

import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	EconomyOperation,
	EconomyRejectionReason,
	EconomySource,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";

// ── Owned domain types ─────────────────────────────────────────────────────

/**
 * A single economic mutation (SPEC-011 "Transaction"). Every applied
 * award/remove/transfer produces exactly one Transaction, stored in the
 * affected wallet's history for replay/analytics/debug/balance
 * (SPEC-011 "Historial"). `amount` is the SIGNED delta applied to the
 * wallet's `currentPoints` (positive credits, negative debits), which is what
 * makes the integrity invariant (SPEC-011 "Integridad") a simple sum.
 */
export interface EconomyTransaction {
	/** Unique id (randomUUID — identity, not gameplay randomness). */
	readonly id: string;
	/** Emission time in epoch ms, from `clock.now()` (never `Date.now`). */
	readonly timestamp: number;
	readonly playerId: number;
	/** Signed delta applied to this wallet's balance (+credit / -debit). */
	readonly amount: number;
	readonly operation: EconomyOperation;
	readonly reason: string;
	readonly source: EconomySource;
	/** Optional structured diagnostic data (e.g. transfer counterpart). */
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Per-player Wallet (SPEC-011 "Player Wallet"). Exactly one per participant,
 * initialized to the configured starting balance. Never negative
 * (SPEC-011 "Restricciones"); never stores objects, persistent rewards or
 * experience — only points and the transaction history.
 */
export interface WalletSnapshot {
	readonly playerId: number;
	readonly currentPoints: number;
	/** Cumulative points ever removed from this wallet (absolute total). */
	readonly spentPoints: number;
	/** Cumulative points ever added to this wallet (absolute total). */
	readonly earnedPoints: number;
	readonly transactionHistory: readonly EconomyTransaction[];
}

/** JSON-safe snapshot of the whole economy (SPEC-011 "Sincronización"). */
export interface EconomySnapshot {
	readonly initialPoints: number;
	readonly wallets: readonly WalletSnapshot[];
}

/**
 * Discriminated result of a public command (SPEC-011 "API pública": commands
 * are synchronous and return Success | Rejected, they are never listeners).
 */
export type EconomyResult =
	| { readonly status: "success"; readonly transaction: EconomyTransaction }
	| { readonly status: "rejected"; readonly rejection: EconomyRejectionReason };

/**
 * Apply-Rules seam (architect ruling F2-2 — dependency inversion). The
 * Economy OWNS this narrow port; the real Rule Engine (SPEC-009) is wired in
 * later by the architect. Economy NEVER imports from a `rules/` module.
 *
 * In the Award pipeline the base amount is passed through
 * `applyRewardMultiplier`; the returned value is the amount actually credited
 * (SPEC-011 "Rule Engine": Rules may modify rewards/costs/multipliers, but
 * NEVER touch the Wallet directly). Default (not injected) = identity.
 */
export interface RewardRuleApplier {
	applyRewardMultiplier(input: {
		playerId: number;
		baseAmount: number;
		source: EconomySource;
		reason: string;
	}): number;
}

export interface TournamentEconomyOptions {
	readonly tournamentId: string;
	/** Participant user ids; one wallet is created per id. */
	readonly participantIds: readonly number[];
	/** Starting balance per wallet (SPEC-024 TournamentSettings.initialPoints). */
	readonly initialPoints: number;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	/** Apply-Rules seam; identity when omitted (SPEC-011 "Rule Engine"). */
	readonly rewardRuleApplier?: RewardRuleApplier;
	/** Current tournament round for event envelopes; 0 when omitted. */
	readonly getRound?: () => number;
}

/** Identity applier used when no Rule Engine is injected (v1 default). */
const IDENTITY_REWARD_RULE_APPLIER: RewardRuleApplier = {
	applyRewardMultiplier: ({ baseAmount }) => baseAmount,
};

/** Mutable internal wallet; `WalletSnapshot` is its JSON-safe projection. */
interface WalletState {
	readonly playerId: number;
	currentPoints: number;
	spentPoints: number;
	earnedPoints: number;
	readonly transactionHistory: EconomyTransaction[];
}

export class TournamentEconomy {
	private readonly tournamentId: string;
	private readonly initialPoints: number;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly rewardRuleApplier: RewardRuleApplier;
	private readonly getRound: () => number;

	private readonly wallets = new Map<number, WalletState>();

	constructor(options: TournamentEconomyOptions) {
		this.tournamentId = options.tournamentId;
		this.initialPoints = options.initialPoints;
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("Economy") ??
			new TournamentLogger({
				tournamentId: this.tournamentId,
				system: "Economy",
			});
		this.rewardRuleApplier =
			options.rewardRuleApplier ?? IDENTITY_REWARD_RULE_APPLIER;
		this.getRound = options.getRound ?? (() => 0);

		for (const playerId of options.participantIds) {
			// A duplicate id would silently drop a wallet; keep the first.
			if (!this.wallets.has(playerId)) {
				this.wallets.set(playerId, {
					playerId,
					currentPoints: this.initialPoints,
					spentPoints: 0,
					earnedPoints: 0,
					transactionHistory: [],
				});
			}
		}
	}

	// ── Public commands (SPEC-011 "API pública") ────────────────────────────

	/**
	 * Award pipeline (SPEC-011 "Award Pipeline"): RequestAward → Validate →
	 * Apply Rules → Update Wallet → Store Transaction → Emit PointsAwarded (+
	 * WalletUpdated). The base amount is run through the reward-rule seam
	 * BEFORE validation of the final credit, so multipliers/bonuses shape the
	 * awarded value (SPEC-011 "Rule Engine").
	 */
	award(
		playerId: number,
		amount: number,
		reason: string,
		source: EconomySource,
	): EconomyResult {
		const wallet = this.wallets.get(playerId);
		if (!wallet) {
			return this.rejectUnknownPlayer("award", playerId, amount, reason, source);
		}

		if (amount < 0) {
			return this.reject("award", amount, reason, source, "negative_amount", playerId);
		}

		const credited = this.rewardRuleApplier.applyRewardMultiplier({
			playerId,
			baseAmount: amount,
			source,
			reason,
		});

		// A rule that returns a negative multiplied amount is still invalid.
		if (credited < 0) {
			return this.reject("award", credited, reason, source, "negative_amount", playerId);
		}

		if (wallet.currentPoints + credited > Number.MAX_SAFE_INTEGER) {
			this.logger.error("Award overflow: operation cancelled", {
				playerId,
				metadata: { current: wallet.currentPoints, amount: credited, source },
			});
			return this.reject("award", credited, reason, source, "overflow", playerId);
		}

		const transaction = this.applyToWallet(
			wallet,
			credited,
			"award",
			reason,
			source,
		);
		this.emitPoints("PointsAwarded", playerId, {
			amount: credited,
			reason,
			source,
			transactionId: transaction.id,
		});
		this.emitWalletUpdated(wallet);
		return { status: "success", transaction };
	}

	/**
	 * Remove pipeline (SPEC-011 "Remove Pipeline"). In v1 the amount passes
	 * through as-is (cost rules are applied by callers upstream — Shop/Gambling
	 * compute the price, SPEC-011 "Shop"/"Gambling"). Rejects
	 * `insufficient_balance` without mutating the wallet when the balance is
	 * too low (SPEC-011 "Validación": never a negative balance).
	 */
	remove(
		playerId: number,
		amount: number,
		reason: string,
		source: EconomySource,
	): EconomyResult {
		const wallet = this.wallets.get(playerId);
		if (!wallet) {
			return this.rejectUnknownPlayer("remove", playerId, amount, reason, source);
		}

		if (amount < 0) {
			return this.reject("remove", amount, reason, source, "negative_amount", playerId);
		}

		if (amount > wallet.currentPoints) {
			return this.reject(
				"remove",
				amount,
				reason,
				source,
				"insufficient_balance",
				playerId,
			);
		}

		const transaction = this.applyToWallet(
			wallet,
			-amount,
			"remove",
			reason,
			source,
		);
		this.emitPoints("PointsRemoved", playerId, {
			amount,
			reason,
			source,
			transactionId: transaction.id,
		});
		this.emitWalletUpdated(wallet);
		return { status: "success", transaction };
	}

	/**
	 * Transfer (SPEC-011 "Transfer"): atomic debit of source + credit of
	 * destination in one logical transaction (v1's only consumer is
	 * AttemptStealAction, SPEC-006). If the source lacks enough balance, the
	 * AVAILABLE balance is transferred rather than rejecting (v1 provisional
	 * decision, SPEC-040). Emits PointsTransferred, then WalletUpdated for both
	 * wallets. The returned transaction is the SOURCE-side (debit) record; the
	 * destination gets its own linked credit transaction in its history.
	 */
	transfer(
		fromPlayerId: number,
		toPlayerId: number,
		amount: number,
		reason: string,
		source: EconomySource,
	): EconomyResult {
		const from = this.wallets.get(fromPlayerId);
		const to = this.wallets.get(toPlayerId);
		if (!from) {
			return this.rejectUnknownPlayer(
				"transfer",
				fromPlayerId,
				amount,
				reason,
				source,
			);
		}
		if (!to) {
			return this.rejectUnknownPlayer(
				"transfer",
				toPlayerId,
				amount,
				reason,
				source,
			);
		}

		if (amount < 0) {
			return this.reject(
				"transfer",
				amount,
				reason,
				source,
				"negative_amount",
				fromPlayerId,
			);
		}

		// Clamp to the available balance (v1 provisional decision, SPEC-040).
		const moved = Math.min(amount, from.currentPoints);

		if (to.currentPoints + moved > Number.MAX_SAFE_INTEGER) {
			this.logger.error("Transfer overflow: operation cancelled", {
				playerId: toPlayerId,
				metadata: { current: to.currentPoints, amount: moved, source },
			});
			return this.reject(
				"transfer",
				moved,
				reason,
				source,
				"overflow",
				fromPlayerId,
			);
		}

		// Atomic: both legs share one logical transaction id (SPEC-011 "Transfer").
		const transferId = randomUUID();
		const timestamp = this.clock.now();

		const debit: EconomyTransaction = {
			id: transferId,
			timestamp,
			playerId: fromPlayerId,
			amount: -moved,
			operation: "transfer",
			reason,
			source,
			metadata: { counterpartPlayerId: toPlayerId, direction: "debit" },
		};
		const credit: EconomyTransaction = {
			id: transferId,
			timestamp,
			playerId: toPlayerId,
			amount: moved,
			operation: "transfer",
			reason,
			source,
			metadata: { counterpartPlayerId: fromPlayerId, direction: "credit" },
		};

		this.commit(from, debit);
		this.commit(to, credit);

		const event = createTournamentEvent({
			name: "PointsTransferred",
			tournamentId: this.tournamentId,
			round: this.getRound(),
			playerId: null,
			payload: {
				fromPlayerId,
				toPlayerId,
				amount: moved,
				reason,
				source,
				transactionId: transferId,
			},
			timestamp,
		});
		this.bus.emit(event as AnyTournamentEvent);

		this.emitWalletUpdated(from);
		this.emitWalletUpdated(to);
		return { status: "success", transaction: debit };
	}

	// ── Read-only observation ────────────────────────────────────────────────

	/** Current balance of a wallet, or undefined for an unknown player. */
	getBalance(playerId: number): number | undefined {
		return this.wallets.get(playerId)?.currentPoints;
	}

	/** JSON-safe snapshot of one wallet (undefined for an unknown player). */
	getWallet(playerId: number): WalletSnapshot | undefined {
		const wallet = this.wallets.get(playerId);
		return wallet ? this.projectWallet(wallet) : undefined;
	}

	/**
	 * JSON-safe snapshot of the whole economy for embedding in the Runtime
	 * snapshot (SPEC-011 "Sincronización": the client only ever receives
	 * snapshots, never computes balance).
	 */
	serialize(): EconomySnapshot {
		return {
			initialPoints: this.initialPoints,
			wallets: [...this.wallets.values()].map((wallet) =>
				this.projectWallet(wallet),
			),
		};
	}

	/**
	 * Rebuilds an economy from a serialized snapshot (cheap: pure data). The
	 * bus/clock/logger/seam are re-injected because they are runtime services,
	 * never serialized.
	 */
	static restoreFrom(
		snapshot: EconomySnapshot,
		services: {
			tournamentId: string;
			bus: TournamentEventBus;
			clock: TournamentClock;
			logger?: TournamentLogger;
			rewardRuleApplier?: RewardRuleApplier;
			getRound?: () => number;
		},
	): TournamentEconomy {
		const economy = new TournamentEconomy({
			tournamentId: services.tournamentId,
			participantIds: snapshot.wallets.map((wallet) => wallet.playerId),
			initialPoints: snapshot.initialPoints,
			bus: services.bus,
			clock: services.clock,
			logger: services.logger,
			rewardRuleApplier: services.rewardRuleApplier,
			getRound: services.getRound,
		});
		for (const walletSnapshot of snapshot.wallets) {
			const wallet = economy.wallets.get(walletSnapshot.playerId);
			if (!wallet) {
				continue;
			}
			wallet.currentPoints = walletSnapshot.currentPoints;
			wallet.spentPoints = walletSnapshot.spentPoints;
			wallet.earnedPoints = walletSnapshot.earnedPoints;
			wallet.transactionHistory.push(...walletSnapshot.transactionHistory);
		}
		return economy;
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/**
	 * Update Wallet + Store Transaction, in that order (both Award and Remove
	 * pipelines). `delta` is the SIGNED balance change; `earnedPoints` and
	 * `spentPoints` accumulate the absolute credited/debited totals so the
	 * wallet is fully reconstructable from history (SPEC-011 "Integridad").
	 */
	private applyToWallet(
		wallet: WalletState,
		delta: number,
		operation: EconomyOperation,
		reason: string,
		source: EconomySource,
	): EconomyTransaction {
		const transaction: EconomyTransaction = {
			id: randomUUID(),
			timestamp: this.clock.now(),
			playerId: wallet.playerId,
			amount: delta,
			operation,
			reason,
			source,
		};
		this.commit(wallet, transaction);
		return transaction;
	}

	/**
	 * Applies one transaction's signed `amount` to a wallet and appends it to
	 * history. The single place balances change — guarantees the integrity
	 * invariant `currentPoints === initialPoints + Σ history.amount`.
	 */
	private commit(wallet: WalletState, transaction: EconomyTransaction): void {
		wallet.currentPoints += transaction.amount;
		if (transaction.amount >= 0) {
			wallet.earnedPoints += transaction.amount;
		} else {
			wallet.spentPoints += -transaction.amount;
		}
		wallet.transactionHistory.push(transaction);
	}

	private projectWallet(wallet: WalletState): WalletSnapshot {
		return {
			playerId: wallet.playerId,
			currentPoints: wallet.currentPoints,
			spentPoints: wallet.spentPoints,
			earnedPoints: wallet.earnedPoints,
			transactionHistory: wallet.transactionHistory.map((transaction) => ({
				...transaction,
			})),
		};
	}

	private emitPoints<TName extends "PointsAwarded" | "PointsRemoved">(
		name: TName,
		playerId: number,
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

	/**
	 * WalletUpdated after EVERY applied operation (SPEC-011 "Eventos
	 * emitidos"): carries the RESULTING balance — the event derived views
	 * (Leaderboard, UI) consume. Points* describe the operation; WalletUpdated
	 * describes the final state.
	 */
	private emitWalletUpdated(wallet: WalletState): void {
		const event = createTournamentEvent({
			name: "WalletUpdated",
			tournamentId: this.tournamentId,
			round: this.getRound(),
			playerId: wallet.playerId,
			payload: {
				currentPoints: wallet.currentPoints,
				spentPoints: wallet.spentPoints,
				earnedPoints: wallet.earnedPoints,
			},
			timestamp: this.clock.now(),
		});
		this.bus.emit(event as AnyTournamentEvent);
	}

	/**
	 * Emits EconomyRejected and returns the rejected result WITHOUT mutating
	 * any wallet (SPEC-011 "Casos límite": rejections never modify the Wallet).
	 */
	private reject(
		operation: EconomyOperation,
		amount: number,
		reason: string,
		source: EconomySource,
		rejection: EconomyRejectionReason,
		playerId: number | null,
	): EconomyResult {
		const event = createTournamentEvent({
			name: "EconomyRejected",
			tournamentId: this.tournamentId,
			round: this.getRound(),
			playerId,
			payload: { operation, amount, reason, source, rejection },
			timestamp: this.clock.now(),
		});
		this.bus.emit(event as AnyTournamentEvent);
		return { status: "rejected", rejection };
	}

	/**
	 * Unknown playerId during gameplay never throws (SPEC-011 "Casos límite" —
	 * a disconnected/absent wallet is a graceful reject, not a crash). Logged
	 * and reported as `insufficient_balance`: there is no wallet, so no funds.
	 */
	private rejectUnknownPlayer(
		operation: EconomyOperation,
		playerId: number,
		amount: number,
		reason: string,
		source: EconomySource,
	): EconomyResult {
		this.logger.warn("Economy command for unknown player rejected", {
			playerId,
			metadata: { operation, amount, source },
		});
		return this.reject(
			operation,
			amount,
			reason,
			source,
			"insufficient_balance",
			playerId,
		);
	}
}

// Re-export shared unions so consumers can import them from the engine too.
export type { EconomyOperation, EconomySource, EconomyRejectionReason };
