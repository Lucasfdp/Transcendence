/**
 * tournament-shop.ts — Tournament Shop System (SPEC-012).
 *
 * ONE INSTANCE PER TOURNAMENT. The Shop sells OFFERS, not Items (SPEC-012
 * "Filosofía"): it builds the catalog, validates a purchase, asks the Economy to
 * CHARGE, delegates the reward to the Reward Resolver, and emits events. It never
 * modifies points, inventories or rewards itself (SPEC-012 "Responsabilidades").
 *
 * The purchase happens inside an interaction SESSION (SPEC-012 "Protocolo de
 * interacción", the turn's WAITING_INTERACTION window): Open → ShopOpened →
 * Waiting (timeout) → Buy / Cancel / Timeout → ShopClosed (ALWAYS emitted — the
 * event the Turn System waits for). One session at a time (there is one active
 * turn). Never automatic purchase (SPEC-012).
 *
 * Determinism (SPEC-028): the session timeout uses the injected clock only — no
 * `Date.now`/`setTimeout`; the Shop has no randomness.
 */

import { TimerHandle, TournamentClock } from "../infra/clock";
import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	PurchaseRejectionReason,
	ShopCloseOutcome,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentLogger } from "../infra/tournament-logger";
import { Registry } from "../registry/registry";
import { createShopRegistry } from "./shop-registry";
import {
	BuyResult,
	OpenShopResult,
	ShopContextFactory,
	ShopEconomyPort,
	ShopOffer,
	ShopPriceModifier,
	ShopRewardGranter,
	ShopSnapshot,
} from "./shop.types";

export interface TournamentShopOptions {
	readonly tournamentId: string;
	readonly registry?: Registry<ShopOffer>;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	/** Economy port — the Shop only charges (SPEC-012). */
	readonly economy: ShopEconomyPort;
	/** Reward delegation port (SPEC-012 "Reward Resolver"). */
	readonly rewardGranter: ShopRewardGranter;
	/** Rule price-modifier seam; identity when omitted (SPEC-012). */
	readonly priceModifier?: ShopPriceModifier;
	/** Builds the ActionContext the reward runs against; minimal when omitted. */
	readonly makeContext?: ShopContextFactory;
	/** Session interaction timeout in ms (SPEC-024 shopInteractionSeconds × 1000). */
	readonly shopTimeoutMs: number;
	readonly logger?: TournamentLogger;
	readonly getRound?: () => number;
}

const IDENTITY_PRICE_MODIFIER: ShopPriceModifier = {
	apply: ({ basePrice }) => basePrice,
};

interface OpenSession {
	readonly playerId: number;
	readonly round: number;
	readonly deadlineAt: number;
	timer: TimerHandle | null;
}

export class TournamentShop {
	private readonly tournamentId: string;
	private readonly registry: Registry<ShopOffer>;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly economy: ShopEconomyPort;
	private readonly rewardGranter: ShopRewardGranter;
	private readonly priceModifier: ShopPriceModifier;
	private readonly makeContext: ShopContextFactory;
	private readonly shopTimeoutMs: number;
	private readonly logger: TournamentLogger;
	private readonly getRound: () => number;

	private session: OpenSession | null = null;
	/** Total purchases per offer (perGame stock). */
	private readonly purchases = new Map<string, number>();
	/** Purchases per (offer, player) (perPlayer stock). */
	private readonly perPlayerPurchases = new Map<string, number>();
	private lastOutcome: ShopCloseOutcome | undefined;

	constructor(options: TournamentShopOptions) {
		this.tournamentId = options.tournamentId;
		this.registry = options.registry ?? createShopRegistry({ seed: true });
		this.bus = options.bus;
		this.clock = options.clock;
		this.economy = options.economy;
		this.rewardGranter = options.rewardGranter;
		this.priceModifier = options.priceModifier ?? IDENTITY_PRICE_MODIFIER;
		this.shopTimeoutMs = options.shopTimeoutMs;
		this.logger =
			options.logger?.child("Shop") ??
			new TournamentLogger({ tournamentId: this.tournamentId, system: "Shop" });
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

	// ── Session protocol (SPEC-012 "Protocolo de interacción") ────────────────

	/**
	 * Opens a shop session for a player (SPEC-012 "Protocolo": Open → ShopOpened).
	 * One session at a time — a second open while one is in progress is ignored.
	 * An empty catalog closes immediately with `empty` (nothing to buy). Arms the
	 * interaction timeout (SPEC-012 "timeout": v1 30s).
	 */
	open(playerId: number, round: number = this.getRound()): OpenShopResult {
		if (this.session !== null) {
			this.logger.warn("open ignored: a shop session is already in progress", {
				playerId,
				metadata: { activePlayerId: this.session.playerId },
			});
			return { status: "ignored", reason: "session_in_progress" };
		}

		const offerCount = this.registry.getAll().length;
		this.emit("ShopRequested", playerId, round, { offerCount });
		if (offerCount === 0) {
			this.emit("ShopClosed", playerId, round, { outcome: "empty" });
			this.lastOutcome = "empty";
			return { status: "opened", offerCount: 0 };
		}

		const deadlineAt = this.clock.now() + this.shopTimeoutMs;
		this.session = { playerId, round, deadlineAt, timer: null };
		this.emit("ShopOpened", playerId, round, { offerCount, deadlineAt });
		this.session.timer = this.clock.schedule(this.shopTimeoutMs, () => {
			if (this.session && this.session.playerId === playerId) {
				this.close("timeout");
			}
		});
		return { status: "opened", offerCount };
	}

	/** Presentation-only: the player highlighted an offer (SPEC-012 "Eventos"). */
	select(playerId: number, offerId: string): void {
		if (!this.session || this.session.playerId !== playerId) return;
		this.emit("OfferSelected", playerId, this.session.round, { offerId });
	}

	/**
	 * Buys an offer (SPEC-012 "Compra": Validate → Economy.Remove → RewardResolver
	 * → ItemPurchased → close). A rejected purchase stays open (the player may try
	 * another offer); a success closes the session. Never throws.
	 */
	buy(playerId: number, offerId: string): BuyResult {
		const session = this.session;
		if (!session || session.playerId !== playerId) {
			this.logger.warn("buy rejected: no open session for player", { playerId });
			return this.rejectWithoutSession(playerId, offerId, "no_session");
		}
		const round = session.round;
		this.emit("PurchaseRequested", playerId, round, { offerId });

		const offer = this.registry.get(offerId);
		if (!offer) {
			return this.reject(playerId, round, offerId, "unknown_offer");
		}
		if (offer.requirements?.minRound !== undefined && round < offer.requirements.minRound) {
			return this.reject(playerId, round, offerId, "requirements_unmet");
		}
		if (!this.hasStock(offer, playerId)) {
			return this.reject(playerId, round, offerId, "out_of_stock");
		}

		const price = Math.max(
			0,
			Math.round(
				this.priceModifier.apply({ playerId, round, offerId, basePrice: offer.price }),
			),
		);
		if ((this.economy.getBalance(playerId) ?? 0) < price) {
			return this.reject(playerId, round, offerId, "insufficient_points");
		}

		// Charge (SPEC-012 "Integración con Economy": if Economy rejects → cancel).
		const removal = this.economy.remove(playerId, price, `shop:${offerId}`, "shop");
		if (removal.status !== "success") {
			return this.reject(playerId, round, offerId, "insufficient_points");
		}

		// Deliver via the Reward Resolver (SPEC-012 "Reward Resolver": delegate).
		const grant = this.rewardGranter.grant(offer.reward, this.makeContext({ playerId, round }));
		if (grant.status !== "resolved") {
			// The charge already applied — a well-formed catalog never lands here
			// (offers are validated at registration); log the anomaly loudly.
			this.logger.error("reward grant rejected AFTER charging; points spent", {
				playerId,
				metadata: { offerId, reason: grant.reason },
			});
			return this.reject(playerId, round, offerId, "invalid_reward");
		}

		this.recordPurchase(offer, playerId);
		this.emit("ItemPurchased", playerId, round, { offerId, price });
		this.close("purchased");
		return { status: "purchased", offerId, price };
	}

	/** Cancels the session (SPEC-012 "Protocolo": Cancel → ShopClosed). */
	cancel(playerId: number): void {
		if (this.session && this.session.playerId === playerId) {
			this.close("cancelled");
		}
	}

	// ── Read-only observation ────────────────────────────────────────────────

	get openSessionPlayerId(): number | null {
		return this.session?.playerId ?? null;
	}

	getOffers(): readonly ShopOffer[] {
		return this.registry.getAll();
	}

	serialize(): ShopSnapshot {
		return {
			tournamentId: this.tournamentId,
			session: this.session
				? { playerId: this.session.playerId, deadlineAt: this.session.deadlineAt }
				: null,
			purchases: Object.fromEntries(this.purchases),
			lastOutcome: this.lastOutcome,
		};
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/** Closes the session, always emitting ShopClosed (SPEC-012 "Protocolo"). */
	private close(outcome: ShopCloseOutcome): void {
		const session = this.session;
		if (!session) return;
		if (session.timer) {
			this.clock.cancel(session.timer);
		}
		this.session = null;
		this.lastOutcome = outcome;
		this.emit("ShopClosed", session.playerId, session.round, { outcome });
	}

	private hasStock(offer: ShopOffer, playerId: number): boolean {
		if (offer.stock.kind === "infinite") return true;
		if (offer.stock.kind === "perGame") {
			return (this.purchases.get(offer.id) ?? 0) < offer.stock.limit;
		}
		// perPlayer
		return (this.perPlayerPurchases.get(this.key(offer.id, playerId)) ?? 0) < offer.stock.limit;
	}

	private recordPurchase(offer: ShopOffer, playerId: number): void {
		this.purchases.set(offer.id, (this.purchases.get(offer.id) ?? 0) + 1);
		const key = this.key(offer.id, playerId);
		this.perPlayerPurchases.set(key, (this.perPlayerPurchases.get(key) ?? 0) + 1);
	}

	private key(offerId: string, playerId: number): string {
		return `${offerId}:${playerId}`;
	}

	/** Emits PurchaseRejected inside an open session (session stays open). */
	private reject(
		playerId: number,
		round: number,
		offerId: string,
		reason: PurchaseRejectionReason,
	): BuyResult {
		this.logger.warn(`purchase rejected: ${reason}`, {
			playerId,
			metadata: { offerId },
		});
		this.emit("PurchaseRejected", playerId, round, { offerId, reason });
		return { status: "rejected", reason };
	}

	/** Reject when there is no session (no PurchaseRequested was emitted). */
	private rejectWithoutSession(
		playerId: number,
		offerId: string,
		reason: PurchaseRejectionReason,
	): BuyResult {
		this.emit("PurchaseRejected", playerId, this.getRound(), { offerId, reason });
		return { status: "rejected", reason };
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
