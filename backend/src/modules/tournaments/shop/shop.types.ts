/**
 * shop.types.ts — Shop System contracts (SPEC-012).
 *
 * The Shop sells OFFERS, never Items (SPEC-012 "Filosofía"): an Offer is pure
 * data describing something purchasable, whose `reward` is an abstract `Reward`
 * (SPEC-013) delivered by the Reward Resolver — the Shop never grants rewards or
 * touches Wallets/Inventories itself (SPEC-012 "Responsabilidades"). It only
 * builds the catalog, validates a purchase, asks the Economy to charge, delegates
 * the reward, and emits events.
 *
 * Dependency inversion (SPEC-012 "Restricciones"): the Shop reaches the Economy /
 * Reward Resolver / Rule Engine ONLY through the narrow ports below, so it never
 * imports the concrete engines. The concrete engines satisfy them structurally.
 */

import { ActionContext, EconomyCommands } from "../actions/action.interface";
import {
	PurchaseRejectionReason,
	ShopCloseOutcome,
} from "../events/tournament-event.types";
import { GrantRewardResult, Reward } from "../rewards/reward.types";

// ── Offer definition (SPEC-012 "Shop Offer") ────────────────────────────────

/**
 * Stock policy for an offer (SPEC-012 "Stock"): infinite, capped per player, or
 * capped for the whole game. (Global limits are a future extension.)
 */
export type ShopStock =
	| { readonly kind: "infinite" }
	| { readonly kind: "perPlayer"; readonly limit: number }
	| { readonly kind: "perGame"; readonly limit: number };

/**
 * Purchase requirements (SPEC-012 "Requisitos") — all optional, all config. v1
 * ships the round gate; the rest are declared for forward-compatibility and
 * checked when their systems land.
 */
export interface OfferRequirements {
	/** Earliest round the offer becomes available. */
	readonly minRound?: number;
}

/**
 * A shop offer — pure data (SPEC-012 "Shop Offer": id, name, description, icon,
 * price, currency, stock, requirements, reward, metadata). `reward` is an
 * abstract `Reward` resolved by the Reward Resolver (SPEC-012 "Reward").
 */
export interface ShopOffer {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly icon: string;
	/** Price in points (SPEC-011 economy; `currency` is always points in v1). */
	readonly price: number;
	readonly currency: "points";
	readonly stock: ShopStock;
	readonly requirements?: OfferRequirements;
	/** The abstract reward delivered on purchase (SPEC-013). */
	readonly reward: Reward;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

// ── Dependency-inverted ports (SPEC-012 "Integración") ──────────────────────

/** Economy port — the Shop only charges; it never credits (SPEC-012). Reuses the
 * Action Economy command port; satisfied structurally by `TournamentEconomy`. */
export type ShopEconomyPort = Pick<EconomyCommands, "remove" | "getBalance">;

/**
 * Reward-delegation port (SPEC-012 "Reward Resolver": the Shop never delivers a
 * reward, it delegates). Satisfied structurally by `TournamentRewardResolver.grant`.
 */
export interface ShopRewardGranter {
	grant(reward: Reward, context: ActionContext): GrantRewardResult;
}

/**
 * Rule price-modifier seam (SPEC-012 "Integración con Rule Engine": Rules may
 * modify prices). Identity by default.
 */
export interface ShopPriceModifier {
	apply(input: {
		playerId: number;
		round: number;
		offerId: string;
		basePrice: number;
	}): number;
}

/** Builds the ActionContext the reward runs against (SPEC-008 "Context"). */
export type ShopContextFactory = (input: {
	playerId: number;
	round: number;
}) => ActionContext;

// ── Command results ─────────────────────────────────────────────────────────

/** Result of `open` (SPEC-012 "Protocolo"). */
export type OpenShopResult =
	| { readonly status: "opened"; readonly offerCount: number }
	| { readonly status: "ignored"; readonly reason: "session_in_progress" };

/** Result of `buy` (SPEC-012 "Compra"). */
export type BuyResult =
	| { readonly status: "purchased"; readonly offerId: string; readonly price: number }
	| { readonly status: "rejected"; readonly reason: PurchaseRejectionReason };

// ── Snapshot (SPEC-012 "Persistencia" via the Runtime) ──────────────────────

/** One open session (SPEC-012 "Protocolo": WAITING_INTERACTION). */
export interface ShopSessionSnapshot {
	readonly playerId: number;
	readonly deadlineAt: number;
}

/** JSON-safe snapshot: the open session (if any) + per-offer purchase counts. */
export interface ShopSnapshot {
	readonly tournamentId: string;
	readonly session: ShopSessionSnapshot | null;
	/** offerId → total purchases so far (drives stock limits). */
	readonly purchases: Readonly<Record<string, number>>;
	/** Re-export for downstream consumers that read the outcome union. */
	readonly lastOutcome?: ShopCloseOutcome;
}
