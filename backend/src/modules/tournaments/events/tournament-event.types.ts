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
