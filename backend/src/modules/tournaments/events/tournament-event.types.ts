/**
 * tournament-event.types.ts — canonical event envelope and Phase-1 event
 * type definitions for the Tournament Event Bus (SPEC-004).
 *
 * Event names and owners come from the SPEC-004 canonical catalog; adding an
 * event here requires registering it there first.
 *
 * Envelope (SPEC-004 "Estructura"): every event carries exactly
 * eventId, timestamp, tournamentId, round, playerId (nullable), payload and
 * metadata. The additional `name` field is the event's catalog identity: it
 * is the discriminant that routes the event to its listeners and narrows the
 * payload type. It is identity, not data — payloads never duplicate it.
 *
 * Extension rule: later phases APPEND new payload interfaces and new entries
 * to `TournamentEventPayloadMap` (grouped by owner, in catalog order). They
 * never modify existing entries — every event type already published is a
 * frozen contract.
 */

import { randomUUID } from "node:crypto";

// ── Metadata ───────────────────────────────────────────────────────────────────

/**
 * Concrete, typed metadata (never a generic dictionary). Kept minimal on
 * purpose; new fields are appended as optional properties.
 */
export interface TournamentEventMetadata {
	/**
	 * eventId of the event whose listener emitted this one (event chaining,
	 * SPEC-004 "Event Chaining"). Absent for root emissions.
	 */
	readonly causedByEventId?: string;
}

// ── Payloads — owner: Tournament Runtime (SPEC-001) ────────────────────────────

export interface TournamentCreatedPayload {
	/** User ids of the participants the tournament was created with. */
	readonly playerIds: readonly number[];
}

export interface TournamentStartedPayload {
	/** User ids of the participants actually starting the tournament. */
	readonly playerIds: readonly number[];
}

export interface RoundStartedPayload {
	readonly round: number;
}

export interface RoundFinishedPayload {
	readonly round: number;
}

export interface RewardsGrantedPayload {
	/** Round whose rewards were just granted. */
	readonly round: number;
}

export interface TournamentFinishedPayload {
	/** Winner's user id, or null when the tournament ends without a winner. */
	readonly winnerUserId: number | null;
}

export interface TournamentCancelledPayload {
	readonly reason: string;
}

// ── Payloads — owner: State Machine (SPEC-003) ─────────────────────────────────

export interface StateEnteredPayload {
	readonly state: string;
}

export interface StateExitedPayload {
	readonly state: string;
}

export interface TransitionStartedPayload {
	readonly from: string;
	readonly to: string;
}

export interface TransitionCompletedPayload {
	readonly from: string;
	readonly to: string;
}

export interface TransitionFailedPayload {
	readonly from: string;
	readonly to: string;
	readonly reason: string;
}

// ── Payloads — owner: Economy System (SPEC-011) ────────────────────────────────

/** Transaction operation kinds (SPEC-011 "Operation Types"). */
export type EconomyOperation = "award" | "remove" | "refund" | "transfer";

/** Origin of an economic operation (SPEC-011 "Sources"). */
export type EconomySource =
	| "tile"
	| "minigame"
	| "shop"
	| "gambling"
	| "steal"
	| "boss"
	| "rule"
	| "admin"
	| "tutorial"
	| "future";

/** Why an economic command was rejected (SPEC-011 "Casos límite"). */
export type EconomyRejectionReason =
	| "insufficient_balance"
	| "negative_amount"
	| "overflow";

/**
 * Points* events DESCRIBE the operation (not the resulting balance) — the
 * resulting balance is carried by WalletUpdated, emitted after every applied
 * operation (SPEC-011 "Points* describe the operation; WalletUpdated
 * describes the final state"). The affected player is the envelope `playerId`.
 */
export interface PointsAwardedPayload {
	readonly amount: number;
	readonly reason: string;
	readonly source: EconomySource;
	/** Id of the Transaction this event records (SPEC-011 "Historial"). */
	readonly transactionId: string;
}

export interface PointsRemovedPayload {
	readonly amount: number;
	readonly reason: string;
	readonly source: EconomySource;
	readonly transactionId: string;
}

/**
 * Atomic transfer between two wallets (SPEC-011 "Transfer"). Both parties are
 * in the payload; the envelope `playerId` is null (the event is about two
 * players). v1's only producer is AttemptStealAction (SPEC-006).
 */
export interface PointsTransferredPayload {
	readonly fromPlayerId: number;
	readonly toPlayerId: number;
	readonly amount: number;
	readonly reason: string;
	readonly source: EconomySource;
	readonly transactionId: string;
}

export interface EconomyRejectedPayload {
	readonly operation: EconomyOperation;
	readonly amount: number;
	readonly reason: string;
	readonly source: EconomySource;
	readonly rejection: EconomyRejectionReason;
}

/**
 * Resulting wallet state after an applied operation (SPEC-011 "Sincronización":
 * the wallet belongs to the server; the client only receives snapshots). This
 * is the event derived views (Leaderboard, UI) consume.
 */
export interface WalletUpdatedPayload {
	readonly currentPoints: number;
	readonly spentPoints: number;
	readonly earnedPoints: number;
}

// ── Payloads — owner: Rule Engine (SPEC-009) ───────────────────────────────────

/**
 * The five fixed v1 consultation points (SPEC-009 "Alcance v1"). The Rule
 * Engine is NOT a generic rules engine in v1: every active rule modifies
 * exactly one of these points. Carried on rule events as a UI discriminator.
 */
export type RuleConsultationPoint = "dice" | "price" | "reward" | "steal" | "flag";

/**
 * How a rule composes with others at the same point (SPEC-009 "Prioridad y
 * composición"): `value` modifiers ALL apply in descending priority; only ONE
 * `exclusive` parameter (dice override, boolean flag) applies — highest
 * priority wins.
 */
export type RuleComposition = "value" | "exclusive";

/** The v1 duration kinds (SPEC-009 "Alcance v1": Duraciones v1). */
export type RuleDurationKind = "Permanent" | "Round" | "Turns" | "UntilRemoved";

/** What made a rule expire (SPEC-009 "Duración"): only bounded kinds expire. */
export type RuleExpiryReason = "Round" | "Turns";

/** Why a rule was removed from the active set (SPEC-009 "Casos límite"). */
export type RuleRemovalReason = "manual" | "replaced" | "engine_reset";

/**
 * A rule became active and is now consulted by the systems (SPEC-009
 * "Eventos" / "Integración con UI": the UI listens to RuleActivated and adapts
 * presentation, it never polls). The affected player is the envelope
 * `playerId` (null for tournament-wide rules).
 */
export interface RuleActivatedPayload {
	readonly ruleId: string;
	readonly priority: number;
	readonly point: RuleConsultationPoint;
	readonly composition: RuleComposition;
	readonly durationKind: RuleDurationKind;
	/** Present only for boolean flag rules (point === "flag"). */
	readonly flag?: string;
}

/**
 * A rule's mutable attributes changed while active (SPEC-009 "Integración con
 * Action Engine": an Action may modify a rule's duration — never its code).
 * `change` is a short human-readable description of what changed.
 */
export interface RuleUpdatedPayload {
	readonly ruleId: string;
	readonly priority: number;
	readonly durationKind: RuleDurationKind;
	readonly change: string;
}

/**
 * A bounded-duration rule reached the end of its life (SPEC-009 "Ciclo de
 * vida": Running → Expired). Emitted BEFORE the rule transitions to Removed.
 */
export interface RuleExpiredPayload {
	readonly ruleId: string;
	readonly priority: number;
	readonly reason: RuleExpiryReason;
}

/**
 * A rule was taken out of the active set (SPEC-009 "Eventos" / "Ciclo de
 * vida": → Removed). Emitted for explicit removals; expiry emits RuleExpired
 * instead (the two paths are kept distinct).
 */
export interface RuleRemovedPayload {
	readonly ruleId: string;
	readonly priority: number;
	readonly reason: RuleRemovalReason;
}

// ── Payloads — owner: Leaderboard System (SPEC-018) ────────────────────────────

/**
 * One ranked player as carried on Leaderboard events (SPEC-018 "Entry"). This
 * is the JSON-safe projection shape; the Leaderboard's own `LeaderboardEntry`
 * class type mirrors it. `position` uses standard competition ranking — equal
 * `points` SHARE a position and the next distinct group skips accordingly
 * (SPEC-018 "Desempates": 1,2,2,4). Array order among equal-points players is
 * presentation order only (playerId ascending), never a ranking criterion.
 */
export interface LeaderboardEntryPayload {
	readonly playerId: number;
	readonly position: number;
	readonly points: number;
}

/**
 * The full recomputed ranking after a WalletUpdated (SPEC-018 "Pipeline":
 * Recalculate Positions → Emit). Carries every player, already ordered and
 * positioned; the UI consumes this snapshot and never computes positions
 * locally (SPEC-018 "Integración con UI").
 */
export interface LeaderboardUpdatedPayload {
	readonly entries: readonly LeaderboardEntryPayload[];
}

/**
 * One player whose position actually changed between the previous and the new
 * ranking (SPEC-018 "Emitir cambios de posición"). Emitted once per affected
 * player; players whose position is unchanged produce no event.
 */
export interface PlayerPositionChangedPayload {
	readonly previousPosition: number;
	readonly newPosition: number;
	readonly points: number;
}

/**
 * The frozen final ranking (SPEC-018 "Integración con Final Challenge"). After
 * this, WalletUpdated no longer moves the ranking. `shellHolderId` is the
 * ¡¡THE PARROT'S SHELL!! winner, forced to 1st regardless of points, or null on
 * a collective DEFEAT (SPEC-001) where the order is pure points DESC.
 */
export interface FinalLeaderboardGeneratedPayload {
	readonly entries: readonly LeaderboardEntryPayload[];
	readonly shellHolderId: number | null;
}

// ── Payloads — owner: Inventory System (SPEC-014) ──────────────────────────────

/**
 * Terminal status of one effect run while consuming an Item — mirrors the
 * Action Engine's `ExecutionStatus` (SPEC-008 "Resultado"). Declared locally so
 * the event catalog stays self-contained and never imports from `actions/`.
 */
export type InventoryEffectStatus = "success" | "skipped" | "failed";

/**
 * The player's inventory changed shape (SPEC-014 "Eventos": InventoryUpdated).
 * Emitted after every applied Add/Remove/Consume and carries the resulting
 * occupancy so the client re-renders from a snapshot and never keeps the
 * official state itself (SPEC-014 "Integración con UI"). The affected player is
 * the envelope `playerId`.
 */
export interface InventoryUpdatedPayload {
	readonly capacity: number;
	readonly used: number;
}

/**
 * An Item instance was placed in a slot (SPEC-014 "Añadir Item" → emit
 * ItemAdded). `instanceId` is the unique per-instance id (SPEC-007 "Stack":
 * Items never stack); `slotId` is the slot that now holds it.
 */
export interface ItemAddedPayload {
	readonly itemId: string;
	readonly instanceId: string;
	readonly slotId: string;
}

/**
 * An Item instance left its slot (SPEC-014 "Eliminar Item" → emit ItemRemoved),
 * whether by an explicit remove or by a consumable being destroyed after use.
 */
export interface ItemRemovedPayload {
	readonly itemId: string;
	readonly instanceId: string;
	readonly slotId: string;
}

/**
 * An Item was used (SPEC-014 "Consumir Item" → emit ConsumableUsed). `consumed`
 * is true when the instance was destroyed after use (a consumable) and false
 * when a permanent item stayed in its slot (SPEC-007 "Consumo": Consumible o
 * Permanente). `effectStatuses` mirrors the per-effect result the Action Engine
 * returned (SPEC-014 "Todo uso pasa por Action Engine") — status only, JSON-safe.
 */
export interface ConsumableUsedPayload {
	readonly itemId: string;
	readonly instanceId: string;
	readonly consumed: boolean;
	readonly effectStatuses: readonly InventoryEffectStatus[];
}

/**
 * An Add was rejected because the inventory was at capacity (SPEC-014 "Casos
 * límite": Inventario lleno → Rechazar Item → Emit InventoryFull). No item is
 * added; `itemId` is the definition that could not be placed.
 */
export interface InventoryFullPayload {
	readonly itemId: string;
	readonly capacity: number;
}

/**
 * The player's inventory became empty after a removal (SPEC-014 "Eventos":
 * InventoryEmpty). The affected player is the envelope `playerId`.
 */
export interface InventoryEmptyPayload {
	readonly capacity: number;
}

// ── Payloads — owner: Reward Resolver (SPEC-013) ───────────────────────────────

/**
 * Terminal status of one translated Action run while resolving a Reward —
 * mirrors the Action Engine's `ExecutionStatus` (SPEC-008 "Resultado").
 * Declared locally (like `InventoryEffectStatus`) so the event catalog stays
 * self-contained and never imports from `actions/` or `rewards/`.
 */
export type RewardActionStatus = "success" | "skipped" | "failed";

/**
 * A valid Reward began resolving (SPEC-013 "Eventos": RewardGranted). Emitted
 * at the start of every accepted grant, once validation has passed and before
 * the translated Actions run. `type` is the Reward's abstract type string
 * (SPEC-013 "Reward"), carried as a plain string so the catalog never depends
 * on the Reward Resolver's own type union.
 */
export interface RewardGrantedPayload {
	readonly rewardId: string;
	readonly type: string;
}

/**
 * A Reward was refused before or during resolution (SPEC-013 "Casos límite":
 * Reward desconocida → Registrar error → Cancelar). `reason` is the rejection
 * category (unknown_type / invalid_config / conditions_unmet / no_actions).
 */
export interface RewardRejectedPayload {
	readonly rewardId: string;
	readonly type: string;
	readonly reason: string;
}

/**
 * A Reward finished resolving (SPEC-013 "Pipeline": …→ Emit Events → Finish).
 * `actionStatuses` mirrors, in order, the per-Action result the Action Engine
 * returned for the translated configs (status only, JSON-safe) — the Reward
 * Resolver only translates and delegates, it never executes behaviour itself
 * (SPEC-013 "Integración con Action Engine").
 */
export interface RewardResolvedPayload {
	readonly rewardId: string;
	readonly type: string;
	readonly actionStatuses: readonly RewardActionStatus[];
}

/**
 * A composite Reward began fanning out into its child Rewards (SPEC-013
 * "Composite Reward" / "Eventos": CompositeRewardStarted). `childCount` is the
 * number of child Rewards declared in the composite payload, before any are
 * validated/translated.
 */
export interface CompositeRewardStartedPayload {
	readonly rewardId: string;
	readonly childCount: number;
}

/**
 * A composite Reward finished fanning out (SPEC-013 "Eventos":
 * CompositeRewardFinished). `resolvedCount` is how many child Rewards actually
 * produced translated Actions — a composite with some invalid children resolves
 * only the valid ones (SPEC-013 "Reward parcialmente inválida").
 */
export interface CompositeRewardFinishedPayload {
	readonly rewardId: string;
	readonly resolvedCount: number;
}

// ── Payloads — owner: Board System (SPEC-002) ──────────────────────────────────

/**
 * Terminal status of one Tile Action run during Tile resolution — mirrors the
 * Action Engine's `ExecutionStatus` (SPEC-008), declared locally so the catalog
 * never depends on `actions/`.
 */
export type TileActionStatus = "success" | "skipped" | "failed";

/**
 * A player moved to a new tile (SPEC-002 "Eventos": PlayerMoved). The affected
 * player is the envelope `playerId`. `steps` is the number of tiles traversed
 * (0 for a teleport). `forced` is true for a teleport / forced relocation
 * (TeleportAction / MovePlayerAction), false for a normal dice move — it lets
 * consumers apply the anti-loop rule (SPEC-002 "Teleports y relocalizaciones").
 */
export interface PlayerMovedPayload {
	readonly fromTileId: string;
	readonly toTileId: string;
	readonly steps: number;
	readonly forced: boolean;
}

/** A player entered a tile, before its Actions run (SPEC-002 "Eventos": TileEntered). */
export interface TileEnteredPayload {
	readonly tileId: string;
}

/**
 * A tile's Actions finished running (SPEC-002 "Tile Resolution" → SPEC-006).
 * `actionStatuses` are the per-Action results in execution order; the Board only
 * delegates and reports — it never interprets them.
 */
export interface TileResolvedPayload {
	readonly tileId: string;
	readonly actionStatuses: readonly TileActionStatus[];
}

/**
 * The player's movement (including destination resolution) is fully complete
 * (SPEC-002 "Eventos": MovementFinished). `tileId` is the final resting tile.
 */
export interface MovementFinishedPayload {
	readonly tileId: string;
}

// ── Payloads — owner: Dice System (SPEC-010) ───────────────────────────────────

/**
 * A die was rolled (SPEC-010 "Resultado": DiceRollResult). The server-generated
 * `value` is the FINAL movement value after any Rule modifiers; `seed` is the
 * tournament seed used, so the roll is reproducible (SPEC-010 "Generación").
 * `timestamp` lives on the envelope. The affected player is the envelope
 * `playerId`.
 */
export interface DiceRolledPayload {
	readonly diceId: string;
	readonly value: number;
	readonly seed: string;
}

/**
 * A Rule modified a roll (SPEC-010 "Rule Engine" / "Eventos": DiceModified).
 * `baseValue` is the raw face chosen by the seed; `finalValue` is the value
 * after DiceModifier value-modifiers (SPEC-009). `diceId` is the die actually
 * rolled (already reflecting any die-override Rule).
 */
export interface DiceModifiedPayload {
	readonly diceId: string;
	readonly baseValue: number;
	readonly finalValue: number;
}

// ── Payloads — owner: Turn System (SPEC-005) ───────────────────────────────────

/**
 * A player's turn began (SPEC-005 "Inicio del turno": PlayerTurnStarted). Only
 * the active player's controls unlock; everyone else is a spectator. The active
 * player is the envelope `playerId`. `deadlineAt` is the epoch-ms time the roll
 * timeout expires (SPEC-005 "Timeout").
 */
export interface PlayerTurnStartedPayload {
	readonly deadlineAt: number;
}

/**
 * The server asked the active player to roll (SPEC-005 "Eventos":
 * DiceRollRequested). The player decides WHEN to roll; the server generates the
 * result (SPEC-005 "Lanzamiento del dado"). `deadlineAt` mirrors the turn
 * timeout, after which the server auto-rolls.
 */
export interface DiceRollRequestedPayload {
	readonly deadlineAt: number;
}

/**
 * A player's turn ended (SPEC-005 "Finalización" / "Eventos":
 * PlayerTurnFinished). `finalTileId` is where the player came to rest,
 * `diceValue` the (final) rolled value, and `autoResolved` true when the turn
 * was resolved by the server (timeout or disconnection) rather than by the
 * player (SPEC-005 "Timeout"/"Desconexión").
 */
export interface PlayerTurnFinishedPayload {
	readonly finalTileId: string;
	readonly diceValue: number;
	readonly autoResolved: boolean;
}

// ── Payloads — owner: AttemptStealAction (SPEC-006) ────────────────────────────

/**
 * A steal attempt began (SPEC-006 "AttemptStealAction": StealStarted). The thief
 * is the envelope `playerId`; `amount` is the configured steal amount (v1 fixed,
 * SPEC-024 stealAmount).
 */
export interface StealStartedPayload {
	readonly amount: number;
}

/**
 * A steal attempt failed (SPEC-006: StealFailed) — no eligible victim, or the
 * victim was protected by a StealPrevention Rule (SPEC-009). The thief is the
 * envelope `playerId`.
 */
export interface StealFailedPayload {
	readonly reason: "no_victim" | "prevented" | "rejected";
	readonly victimId?: number;
}

/**
 * A steal attempt succeeded (SPEC-006: StealSucceeded). The Economy already
 * emitted PointsTransferred (the owner fact); this is the steal-level fact. The
 * thief is the envelope `playerId`.
 */
export interface StealSucceededPayload {
	readonly victimId: number;
	readonly amount: number;
}

// ── Payloads — owner: Shop System (SPEC-012) ───────────────────────────────────

/** Why a purchase was rejected (SPEC-012 "Casos límite"). */
export type PurchaseRejectionReason =
	| "no_session"
	| "unknown_offer"
	| "out_of_stock"
	| "requirements_unmet"
	| "insufficient_points"
	| "invalid_reward";

/** How a shop session ended (SPEC-012 "Protocolo de interacción"). */
export type ShopCloseOutcome = "purchased" | "cancelled" | "timeout" | "empty";

/**
 * A tile requested the shop (SPEC-012 "Protocolo": the Board emits ShopRequested
 * via OpenShopAction). The player is the envelope `playerId`; `offerCount` is the
 * catalog size at request time.
 */
export interface ShopRequestedPayload {
	readonly offerCount: number;
}

/**
 * A shop session opened (SPEC-012 "Protocolo": ShopOpened). `deadlineAt` is the
 * interaction-window timeout (SPEC-024 shopInteractionSeconds).
 */
export interface ShopOpenedPayload {
	readonly offerCount: number;
	readonly deadlineAt: number;
}

/** The player highlighted an offer (SPEC-012 "Eventos": OfferSelected). */
export interface OfferSelectedPayload {
	readonly offerId: string;
}

/** The player asked to buy an offer (SPEC-012 "Eventos": PurchaseRequested). */
export interface PurchaseRequestedPayload {
	readonly offerId: string;
}

/**
 * A purchase completed (SPEC-012 "Compra": ItemPurchased). Economy already
 * emitted PointsRemoved and the Reward Resolver its own facts; this is the
 * shop-level fact. `price` is the amount paid.
 */
export interface ItemPurchasedPayload {
	readonly offerId: string;
	readonly price: number;
}

/** A purchase was rejected (SPEC-012 "Casos límite": PurchaseRejected). */
export interface PurchaseRejectedPayload {
	readonly offerId: string;
	readonly reason: PurchaseRejectionReason;
}

/**
 * The shop session closed (SPEC-012 "Protocolo": ShopClosed is emitted ALWAYS,
 * with any outcome — it is the event the Turn System waits for).
 */
export interface ShopClosedPayload {
	readonly outcome: ShopCloseOutcome;
}

// ── Payloads — owner: Random Events System (SPEC-019) ──────────────────────────

/** Terminal status of one Random Event Action (mirrors SPEC-008 status). */
export type RandomEventActionStatus = "success" | "skipped" | "failed";

/**
 * A tile requested a random event (SPEC-019 "Eventos": RandomEventRequested).
 * The affected player is the envelope `playerId`; `candidateCount` is how many
 * events were available to choose from.
 */
export interface RandomEventRequestedPayload {
	readonly candidateCount: number;
}

/**
 * The server picked an event with the seed (SPEC-019 "Selección" / "Eventos":
 * RandomEventSelected). Selection is deterministic (SPEC-000).
 */
export interface RandomEventSelectedPayload {
	readonly eventId: string;
	readonly name: string;
}

/** The selected event began running its Actions (SPEC-019: RandomEventStarted). */
export interface RandomEventStartedPayload {
	readonly eventId: string;
}

/**
 * The event finished (SPEC-019 "Eventos": RandomEventFinished). `actionStatuses`
 * are the per-Action results in execution order.
 */
export interface RandomEventFinishedPayload {
	readonly eventId: string;
	readonly actionStatuses: readonly RandomEventActionStatus[];
}

/**
 * No event ran (SPEC-019 "Eventos": RandomEventCancelled) — e.g. the catalog was
 * empty or no event was selectable. `reason` explains why.
 */
export interface RandomEventCancelledPayload {
	readonly reason: string;
}

// ── Payloads — owner: Minigame Integration (SPEC-015) ──────────────────────────

/**
 * The round's minigame selection began (SPEC-015 "Eventos"). `activePlayers` are
 * the connected, non-abandoned players eligible to play; `candidateCount` is how
 * many catalog minigames support exactly that player count.
 */
export interface MinigameSelectionStartedPayload {
	readonly activePlayers: readonly number[];
	readonly candidateCount: number;
}

/** A minigame was chosen with the seed (SPEC-015 "Selección"): deterministic. */
export interface MinigameSelectedPayload {
	readonly minigameId: string;
}

/** The match was created and is loading (SPEC-015 "Pipeline": Wait MatchCreated). */
export interface MinigameLoadingPayload {
	readonly minigameId: string;
	readonly matchId: string;
}

/** The match actually started (SPEC-015: MatchStarted). */
export interface MinigameStartedPayload {
	readonly minigameId: string;
	readonly matchId: string;
}

/**
 * The match finished and its result reached the Tournament (SPEC-015
 * "Resultado"). `winnerId` is the single winner; a tie is first settled by the
 * tie-break roulette (MinigameTieBreakStarted), so `winnerId: null`/`tie: true`
 * only remain for degenerate ties with no candidates ⇒ Gambling is skipped.
 */
export interface MinigameFinishedPayload {
	readonly minigameId: string;
	readonly matchId: string;
	readonly winnerId: number | null;
	readonly tie: boolean;
}

/**
 * The pre-launch confirmation gate opened ("MINIGAME TIME!", SPEC-015 v2):
 * the minigame is selected and every human must confirm before the match
 * launches; `deadlineAt` is the hard cap so absent players never block.
 */
export interface MinigameLaunchGateOpenedPayload {
	readonly minigameId: string;
	readonly playerIds: readonly number[];
	readonly deadlineAt: number;
}

/** A player confirmed the launch (pressed "Let's go!"). */
export interface MinigameLaunchConfirmedPayload {
	readonly minigameId: string;
	readonly readyCount: number;
}

/**
 * The round's minigame tied and the tie-break roulette opened (SPEC-015
 * "Desempates", v2): a seeded pick among `playerIds` decides the winner —
 * `winnerId` is already final; the roulette is presentation. The coordinator
 * holds the round until `resolveAt` so every client can play the spin.
 */
export interface MinigameTieBreakStartedPayload {
	readonly minigameId: string;
	readonly matchId: string;
	readonly playerIds: readonly number[];
	readonly winnerId: number;
	readonly resolveAt: number;
}

/**
 * No minigame ran this round (SPEC-015 "Selección"/"Errores"): fewer than two
 * active players, no catalog minigame for the player count, a match-creation
 * error, or a cancelled/result-less match. The round continues without a winner
 * (Gambling skipped) — `reason` explains which.
 */
export interface MinigameCancelledPayload {
	readonly reason: string;
}

// ── Payloads — owner: Gambling Integration (SPEC-016) ──────────────────────────

/**
 * The Gambling phase opened for the minigame winner (SPEC-016 "Apertura"). The
 * winner is the envelope `playerId`. `canAfford` is false when they lack the
 * points to bet (they may only abandon; SPEC-016 "Sin puntos suficientes").
 * `deadlineAt` is the decision timeout (SPEC-024 gamblingDecisionSeconds).
 */
export interface GamblingOpenedPayload {
	readonly cost: number;
	readonly winChance: number;
	readonly deadlineAt: number;
	readonly canAfford: boolean;
}

/**
 * The winner placed a bet; provably-fair resolution began (SPEC-016 "Flujo").
 * `commitment` is the committed SHA-256 hash of the server seed, revealed after
 * (SPEC-016 "Integración": verificable por el jugador).
 */
export interface GamblingStartedPayload {
	readonly cost: number;
	readonly commitment: string;
}

/** Shared provably-fair reveal so the player can recompute the roll (SPEC-016). */
export interface GamblingReveal {
	readonly roll: number;
	readonly winChance: number;
	readonly serverSeed: string;
	readonly clientSeed: string;
	readonly nonce: number;
	readonly commitment: string;
}

/** The bet won — a Key Item unlock is requested via the Reward Resolver. */
export interface GamblingWonPayload extends GamblingReveal {
	readonly cost: number;
}

/** The bet lost — the staked points are gone, no progress (SPEC-016 "Derrota"). */
export interface GamblingLostPayload extends GamblingReveal {
	readonly cost: number;
}

/**
 * The phase closed without a resolved bet (SPEC-016 "Timeout"/"Errores"):
 * `abandoned` (player chose / could not afford), `timeout` (decision expired),
 * or `error` (resolution failed). Never blocks the tournament.
 */
export interface GamblingCancelledPayload {
	readonly reason: "abandoned" | "timeout" | "error" | "no_locked_key_items";
}

/** Outcome of the Gambling phase (SPEC-016 "Modelo de interacción"). */
export type GamblingOutcome = "won" | "lost" | "abandoned" | "timeout" | "error";

/**
 * The Gambling phase closed (SPEC-016 "Eventos": GamblingFinished is emitted
 * ALWAYS, with any outcome — it is the event the State Machine consumes). Won/
 * Lost/Cancelled are UI/analytics detail events.
 */
export interface GamblingFinishedPayload {
	readonly outcome: GamblingOutcome;
}

// ── Payloads — owner: Key Item Progression (SPEC-017) ──────────────────────────

/**
 * A Key Item was unlocked (SPEC-017 "Eventos": KeyItemUnlocked). Key Items are
 * GLOBAL match progress — they never belong to a player — so the envelope
 * `playerId` is null; `unlockedBy` records the player whose Reward triggered the
 * unlock (a gambling winner or a shop buyer), for UI/analytics only.
 */
export interface KeyItemUnlockedPayload {
	readonly keyItemId: string;
	readonly order: number;
	readonly unlockedCount: number;
	readonly required: number;
	readonly unlockedBy: number | null;
}

/** Global progress changed (SPEC-017 "Progreso" / "Sincronización"). */
export interface KeyItemProgressUpdatedPayload {
	readonly unlockedCount: number;
	readonly required: number;
	/** unlockedCount / required as a 0–1 fraction. */
	readonly completion: number;
}

/** Every required Key Item is unlocked (SPEC-017 "Eventos": AllKeyItemsUnlocked). */
export interface AllKeyItemsUnlockedPayload {
	readonly required: number;
}

/**
 * All Key Items unlocked ⇒ the Final Challenge is available (SPEC-017 "Final
 * Challenge"). The State Machine consumes this to leave the round loop.
 */
export interface FinalChallengeUnlockedPayload {
	readonly required: number;
}

// ── Payloads — owner: Boss System (SPEC-020) ───────────────────────────────────

/** The Boss spawn was requested — all Key Items are unlocked (SPEC-020 "Aparición"). */
export interface BossSpawnRequestedPayload {
	readonly bossId: string;
}

/** The Boss appeared; its intro sequence begins (SPEC-020 "Inicio"). */
export interface BossSpawnedPayload {
	readonly bossId: string;
	readonly name: string;
}

/** The Boss activated its Rules through the Rule Engine (SPEC-020 "Boss Rules"). */
export interface BossRulesActivatedPayload {
	readonly bossId: string;
	readonly ruleIds: readonly string[];
}

/**
 * The intro finished and the Boss Rules are active (SPEC-020 "Eventos"): the
 * event the State Machine consumes to go BOSS_EVENT → FINAL_CHALLENGE. Carries
 * the Final Challenge the Boss selected (SPEC-020 "Final Challenge").
 */
export interface BossIntroCompletedPayload {
	readonly bossId: string;
	readonly finalChallengeId: string;
}

/** The Boss Rules were removed when the match resolved (SPEC-020 "Finalización"). */
export interface BossRulesRemovedPayload {
	readonly bossId: string;
	readonly ruleIds: readonly string[];
}

/** The Boss finished its participation (SPEC-020 "Finalización"). */
export interface BossFinishedPayload {
	readonly bossId: string;
}

// ── Payloads — owner: Final Challenge System (SPEC-021) ─────────────────────────

/** The Final Challenge began (SPEC-021 "Inicio"), automatically after the Boss. */
export interface FinalChallengeStartedPayload {
	readonly challengeId: string;
}

/**
 * A single player met the victory condition (SPEC-021 "Condiciones de victoria")
 * — in v1 the unique winner of the sudden-death minigame. The winner is the
 * envelope `playerId`; `attempts` counts how many minigames it took.
 */
export interface VictoryConditionReachedPayload {
	readonly challengeId: string;
	readonly winnerId: number;
	readonly attempts: number;
}

/** THE PARROT'S SHELL was granted to the winner via the Reward Resolver (SPEC-021). */
export interface ShellGrantedPayload {
	readonly winnerId: number;
}

/**
 * The Final Challenge closed with the winner determined (SPEC-021 "Eventos"): the
 * event the State Machine consumes to transition to VICTORY. TournamentFinished
 * is emitted by the Runtime, never this system.
 */
export interface FinalChallengeFinishedPayload {
	readonly challengeId: string;
	readonly winnerId: number;
}

// ── Event map ──────────────────────────────────────────────────────────────────

/**
 * Single source of truth mapping event name → payload type. Later phases
 * append new entries here (one per catalog event) without touching existing
 * ones.
 */
export interface TournamentEventPayloadMap {
	// Owner: Tournament Runtime (SPEC-001)
	TournamentCreated: TournamentCreatedPayload;
	TournamentStarted: TournamentStartedPayload;
	RoundStarted: RoundStartedPayload;
	RoundFinished: RoundFinishedPayload;
	RewardsGranted: RewardsGrantedPayload;
	TournamentFinished: TournamentFinishedPayload;
	TournamentCancelled: TournamentCancelledPayload;
	// Owner: State Machine (SPEC-003)
	StateEntered: StateEnteredPayload;
	StateExited: StateExitedPayload;
	TransitionStarted: TransitionStartedPayload;
	TransitionCompleted: TransitionCompletedPayload;
	TransitionFailed: TransitionFailedPayload;
	// Owner: Economy System (SPEC-011)
	PointsAwarded: PointsAwardedPayload;
	PointsRemoved: PointsRemovedPayload;
	PointsTransferred: PointsTransferredPayload;
	EconomyRejected: EconomyRejectedPayload;
	WalletUpdated: WalletUpdatedPayload;
	// Owner: Rule Engine (SPEC-009)
	RuleActivated: RuleActivatedPayload;
	RuleUpdated: RuleUpdatedPayload;
	RuleExpired: RuleExpiredPayload;
	RuleRemoved: RuleRemovedPayload;
	// Owner: Leaderboard System (SPEC-018)
	LeaderboardUpdated: LeaderboardUpdatedPayload;
	PlayerPositionChanged: PlayerPositionChangedPayload;
	FinalLeaderboardGenerated: FinalLeaderboardGeneratedPayload;
	// Owner: Inventory System (SPEC-014)
	InventoryUpdated: InventoryUpdatedPayload;
	ItemAdded: ItemAddedPayload;
	ItemRemoved: ItemRemovedPayload;
	ConsumableUsed: ConsumableUsedPayload;
	InventoryFull: InventoryFullPayload;
	InventoryEmpty: InventoryEmptyPayload;
	// Owner: Reward Resolver (SPEC-013)
	RewardGranted: RewardGrantedPayload;
	RewardRejected: RewardRejectedPayload;
	RewardResolved: RewardResolvedPayload;
	CompositeRewardStarted: CompositeRewardStartedPayload;
	CompositeRewardFinished: CompositeRewardFinishedPayload;
	// Owner: Board System (SPEC-002)
	PlayerMoved: PlayerMovedPayload;
	TileEntered: TileEnteredPayload;
	TileResolved: TileResolvedPayload;
	MovementFinished: MovementFinishedPayload;
	// Owner: Dice System (SPEC-010)
	DiceRolled: DiceRolledPayload;
	DiceModified: DiceModifiedPayload;
	// Owner: Turn System (SPEC-005)
	PlayerTurnStarted: PlayerTurnStartedPayload;
	DiceRollRequested: DiceRollRequestedPayload;
	PlayerTurnFinished: PlayerTurnFinishedPayload;
	// Owner: AttemptStealAction (SPEC-006)
	StealStarted: StealStartedPayload;
	StealFailed: StealFailedPayload;
	StealSucceeded: StealSucceededPayload;
	// Owner: Shop System (SPEC-012)
	ShopRequested: ShopRequestedPayload;
	ShopOpened: ShopOpenedPayload;
	OfferSelected: OfferSelectedPayload;
	PurchaseRequested: PurchaseRequestedPayload;
	ItemPurchased: ItemPurchasedPayload;
	PurchaseRejected: PurchaseRejectedPayload;
	ShopClosed: ShopClosedPayload;
	// Owner: Random Events System (SPEC-019)
	RandomEventRequested: RandomEventRequestedPayload;
	RandomEventSelected: RandomEventSelectedPayload;
	RandomEventStarted: RandomEventStartedPayload;
	RandomEventFinished: RandomEventFinishedPayload;
	RandomEventCancelled: RandomEventCancelledPayload;
	// Owner: Minigame Integration (SPEC-015)
	MinigameSelectionStarted: MinigameSelectionStartedPayload;
	MinigameSelected: MinigameSelectedPayload;
	MinigameLoading: MinigameLoadingPayload;
	MinigameStarted: MinigameStartedPayload;
	MinigameFinished: MinigameFinishedPayload;
	MinigameLaunchGateOpened: MinigameLaunchGateOpenedPayload;
	MinigameLaunchConfirmed: MinigameLaunchConfirmedPayload;
	MinigameTieBreakStarted: MinigameTieBreakStartedPayload;
	MinigameCancelled: MinigameCancelledPayload;
	// Owner: Gambling Integration (SPEC-016)
	GamblingOpened: GamblingOpenedPayload;
	GamblingStarted: GamblingStartedPayload;
	GamblingWon: GamblingWonPayload;
	GamblingLost: GamblingLostPayload;
	GamblingCancelled: GamblingCancelledPayload;
	GamblingFinished: GamblingFinishedPayload;
	// Owner: Key Item Progression (SPEC-017)
	KeyItemUnlocked: KeyItemUnlockedPayload;
	KeyItemProgressUpdated: KeyItemProgressUpdatedPayload;
	AllKeyItemsUnlocked: AllKeyItemsUnlockedPayload;
	FinalChallengeUnlocked: FinalChallengeUnlockedPayload;
	// Owner: Boss System (SPEC-020)
	BossSpawnRequested: BossSpawnRequestedPayload;
	BossSpawned: BossSpawnedPayload;
	BossRulesActivated: BossRulesActivatedPayload;
	BossIntroCompleted: BossIntroCompletedPayload;
	BossRulesRemoved: BossRulesRemovedPayload;
	BossFinished: BossFinishedPayload;
	// Owner: Final Challenge System (SPEC-021)
	FinalChallengeStarted: FinalChallengeStartedPayload;
	VictoryConditionReached: VictoryConditionReachedPayload;
	ShellGranted: ShellGrantedPayload;
	FinalChallengeFinished: FinalChallengeFinishedPayload;
}

export type TournamentEventName = keyof TournamentEventPayloadMap;

// ── Envelope ───────────────────────────────────────────────────────────────────

/**
 * The event envelope (SPEC-004 "Estructura"). All fields are readonly and
 * the bus freezes the instance on emit: events are immutable facts and are
 * never reused — each emission creates a new event.
 */
export interface TournamentEvent<
	TName extends TournamentEventName = TournamentEventName,
> {
	/** Catalog name — the discriminant used for routing and narrowing. */
	readonly name: TName;
	/** Unique id of this emission (never reused across emissions). */
	readonly eventId: string;
	/** Emission time, milliseconds since the Unix epoch. */
	readonly timestamp: number;
	readonly tournamentId: string;
	/** Current tournament round (0 before the first round starts). */
	readonly round: number;
	/** User id the event is about, or null for tournament-wide events. */
	readonly playerId: number | null;
	readonly payload: TournamentEventPayloadMap[TName];
	readonly metadata: TournamentEventMetadata;
}

/**
 * Discriminated union of every registered event: `event.name` narrows
 * `event.payload` to its concrete type.
 */
export type AnyTournamentEvent = {
	[K in TournamentEventName]: TournamentEvent<K>;
}[TournamentEventName];

// ── Factory ────────────────────────────────────────────────────────────────────

export interface CreateTournamentEventInput<TName extends TournamentEventName> {
	name: TName;
	tournamentId: string;
	round: number;
	/** Defaults to null (tournament-wide event). */
	playerId?: number | null;
	payload: TournamentEventPayloadMap[TName];
	/** Defaults to empty metadata. */
	metadata?: TournamentEventMetadata;
	/**
	 * Emission time, ms since the Unix epoch. Callers that own a
	 * TournamentClock must pass clock.now(); Date.now() is only a fallback
	 * for non-simulated contexts.
	 */
	timestamp?: number;
}

/**
 * Builds a fresh envelope (new eventId per call). Owners use this on every
 * emission so instances are never reused (SPEC-004 "Restricciones").
 */
export function createTournamentEvent<TName extends TournamentEventName>(
	input: CreateTournamentEventInput<TName>,
): TournamentEvent<TName> {
	return {
		name: input.name,
		eventId: randomUUID(),
		timestamp: input.timestamp ?? Date.now(),
		tournamentId: input.tournamentId,
		round: input.round,
		playerId: input.playerId ?? null,
		payload: input.payload,
		metadata: input.metadata ?? {},
	};
}
