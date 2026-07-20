/**
 * tournaments.contracts.ts — single source of truth for the Tournament
 * WS events, client intents and shared REST payload shapes (SPEC-037).
 *
 * Mirrored consciously in frontend/src/features/tournaments/contracts.ts.
 * Keep both files in sync BY HAND; drift is detected by
 * scripts/check-tournament-contracts.sh (run it in the integration checklist).
 *
 * Rules (SPEC-004 / SPEC-022):
 * - No `any`, no generic dictionaries for payloads.
 * - The snapshot is the ONLY source of state (snapshot-first, SPEC-022).
 *   Incremental `tournament:*` events are presentation hints only.
 *
 * REST surface covered here (SPEC-038, prefix /api/tournaments):
 * - POST /tournaments               → CreateTournamentResponse
 * - GET  /tournaments/:id           → GetTournamentResponse
 * - POST /tournaments/:id/invite    → InviteTournamentRequest / InviteTournamentResponse
 * - POST /tournaments/:id/join      → JoinTournamentResponse
 * - POST /tournaments/join-pin      → JoinTournamentByPinRequest / JoinTournamentByPinResponse
 * - POST /tournaments/:id/leave     → LeaveTournamentResponse
 * - POST /tournaments/:id/start     → StartTournamentResponse
 * (class-validator request classes live in tournaments.dto.ts; they implement
 * the request shapes declared here.)
 */

import type { TournamentStatus } from "./entities/tournament.entity";

/** Re-exported so the frontend mirror shares the exact same status union. */
export type { TournamentStatus };

// ── WS event names (wire events, Socket.IO path /ws/) ─────────────────────────

export const TOURNAMENT_WS_EVENTS = {
	/** Lobby membership / lifecycle changed — carries the full lobby state. */
	LOBBY_UPDATED: "tournament:lobby-updated",
	/** The creator pressed Start; the match lifecycle begins (SPEC-023). */
	STARTING: "tournament:starting",
	/** Authoritative full-state snapshot (snapshot-first sync, SPEC-022). */
	SNAPSHOT: "tournament:snapshot",
} as const;

export type TournamentWsEventName =
	(typeof TOURNAMENT_WS_EVENTS)[keyof typeof TOURNAMENT_WS_EVENTS];

/**
 * Client→server messages (SPEC-022 "Intents": clients only REQUEST). Handled
 * by the TournamentGateway inside the tournaments module — never inside
 * matchmaking.gateway.ts (SPEC-037).
 */
export const TOURNAMENT_WS_MESSAGES = {
	/**
	 * Enter the tournament room and receive the current snapshot envelope in
	 * the ack — also the reconnection path (SPEC-022 "Reconexión": the
	 * snapshot IS the state; no event replay).
	 */
	JOIN: "tournament:join",
	/** Leave the tournament room (navigating away; not a gameplay abandon). */
	LEAVE: "tournament:leave",
	/**
	 * Quit the match for good (the "Leave match" button): the player is removed
	 * from the tournament and can NEVER rejoin it — unlike LEAVE/disconnect,
	 * which only step out of the room and remain reconnectable (SPEC-022). A
	 * quitter is freed to create/join a new tournament immediately.
	 */
	QUIT: "tournament:quit",
	/** Request a gameplay action; ack = accepted/rejected, never state. */
	INTENT: "tournament:intent",
} as const;

export type TournamentWsMessageName =
	(typeof TOURNAMENT_WS_MESSAGES)[keyof typeof TOURNAMENT_WS_MESSAGES];

// ── Canonical domain events (SPEC-004 catalog, owner: Entry & Lobby) ──────────

/**
 * Canonical Entry & Lobby event names from the SPEC-004 catalog.
 * Used as the `cause` presentation hint inside `tournament:lobby-updated`.
 * Never a source of state.
 */
export type TournamentLobbyEventName =
	| "TournamentLobbyCreated"
	| "TournamentInviteSent"
	| "TournamentPlayerJoined"
	| "TournamentPlayerLeft"
	| "TournamentLobbyCancelled"
	| "TournamentLobbyCompleted"
	| "TournamentStartRequested";

// ── Client intents (SPEC-022) ──────────────────────────────────────────────────

/**
 * Client intent names (SPEC-022 catalog). `RollDiceIntent` is live (Vertical
 * Slice); the rest stay RESERVED — payloads are added phase by phase under
 * architect approval. Clients request actions, never send results.
 */
export type TournamentIntentName =
	| "RollDiceIntent"
	| "UseItemIntent"
	| "BuyOfferIntent"
	| "StartGamblingIntent"
	| "LeaveGamblingIntent"
	| "ConfirmMinigameIntent"
	| "EndTurnIntent";

/** The active player asks to roll (PLAYER_TURNS). */
export interface RollDiceIntent {
	name: "RollDiceIntent";
}

/** The round's minigame winner takes the bet (GAMBLING_PHASE, SPEC-016). */
export interface StartGamblingIntent {
	name: "StartGamblingIntent";
}

/** The round's minigame winner declines the bet (GAMBLING_PHASE, SPEC-016). */
export interface LeaveGamblingIntent {
	name: "LeaveGamblingIntent";
}

/** "Let's go!" on the MINIGAME TIME! gate (SPEC-015 v2). */
export interface ConfirmMinigameIntent {
	name: "ConfirmMinigameIntent";
}

/** The open shop session's player asks to buy an offer (SPEC-012 "Compra"). */
export interface BuyOfferIntent {
	name: "BuyOfferIntent";
	/** The catalog offer to buy (`TournamentShopOfferSummary.id`). */
	offerId: string;
}

/**
 * The shopper is done browsing — close the shop session without buying
 * (SPEC-005 interaction window / SPEC-012 "Cancel"), letting the turn hand on.
 */
export interface EndTurnIntent {
	name: "EndTurnIntent";
}

/** Union of the intents a client may send today; grows per phase. */
export type TournamentIntent =
	| RollDiceIntent
	| StartGamblingIntent
	| LeaveGamblingIntent
	| ConfirmMinigameIntent
	| BuyOfferIntent
	| EndTurnIntent;

/** Payload of the `tournament:intent` message. */
export interface TournamentIntentEnvelope {
	tournamentId: string;
	intent: TournamentIntent;
}

/**
 * Ack of `tournament:intent` (SPEC-022 IntentAccepted / IntentRejected). A
 * rejection NEVER carries state — the client learns outcomes only from the
 * next snapshot.
 */
export type TournamentIntentAck =
	| { accepted: true }
	| { accepted: false; reason: string };

/** Payload of the `tournament:join` message. */
export interface TournamentJoinRequest {
	tournamentId: string;
}

/**
 * Body of `tournament:quit`. Optional: the board's socket is inside the
 * tournament room, so the server resolves the tournament from the socket. The
 * in-arena "Leave game" button MUST pass it explicitly — entering the minigame
 * already LEFT the tournament room, so the socket carries no tournament.
 */
export interface TournamentQuitRequest {
	tournamentId?: string;
}

/**
 * Ack of `tournament:join`: the current snapshot envelope on success (the
 * reconnection path, SPEC-022), or a rejection reason.
 */
export type TournamentJoinAck =
	| { ok: true; envelope: TournamentSnapshotEnvelope }
	| {
			ok: false;
			reason: "not_found" | "not_participant" | "not_running" | "left";
	  };

// ── PIN (architect ruling #2, tournament-platform-seams-audit.md) ─────────────

/** Fixed first character of every tournament PIN. */
export const TOURNAMENT_PIN_PREFIX = "T";
/** Alphabet for the 5 random characters (no ambiguous chars). */
export const TOURNAMENT_PIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Total PIN length: prefix + 5 random characters. */
export const TOURNAMENT_PIN_LENGTH = 6;

// ── Shared lobby shapes ────────────────────────────────────────────────────────

/** One seat in the lobby, as exposed to clients. */
export interface TournamentParticipantSummary {
	/** Null if the account was deleted (FK SET NULL). */
	userId: number | null;
	username: string;
	/** Turn-order seat; null while the lobby has not assigned seats yet. */
	seat: number | null;
	/**
	 * Ready-ish flag: true when the participant is connected to the lobby
	 * room. There is no manual ready-check — start is server-initiated
	 * (SPEC-038 / seams-audit ruling #1).
	 */
	ready: boolean;
	/** CPU participant (server-driven; always ready). */
	isBot: boolean;
}

/** Full lobby state — enough to hydrate the entry UI after a refresh. */
export interface TournamentLobbyState {
	id: string;
	status: TournamentStatus;
	/** Shareable join PIN (prefix "T" + 5 chars). */
	pin: string;
	creatorUserId: number;
	participants: TournamentParticipantSummary[];
	/** ISO-8601 timestamps (wire format). */
	createdAt: string;
	/** Lobby expiry deadline (v1: 10 minutes after creation). */
	expiresAt: string;
}

// ── WS payloads ────────────────────────────────────────────────────────────────

/** Payload of `tournament:lobby-updated`. */
export interface TournamentLobbyUpdatedPayload {
	lobby: TournamentLobbyState;
	/** Presentation hint: which canonical event caused this update. */
	cause: TournamentLobbyEventName;
}

/** Payload of `tournament:starting`. */
export interface TournamentStartingPayload {
	tournamentId: string;
	/**
	 * First-round turn order (userIds in play order), generated by the
	 * Runtime from the tournament seed — shown before start (SPEC-038,
	 * subject requirement: visible play order).
	 */
	turnOrder: number[];
}

/**
 * State-machine phase on the wire (mirror of state-machine/tournament-phase.ts;
 * SPEC-003). The client only RENDERS it — branching on it never decides
 * gameplay (SPEC-022 "El cliente nunca toma decisiones").
 */
export type TournamentWirePhase =
	| "CREATED"
	| "WAITING_PLAYERS"
	| "INITIALIZING"
	| "ROUND_START"
	| "PLAYER_TURNS"
	| "MINIGAME"
	| "GAMBLING_PHASE"
	| "CHECK_KEY_ITEMS"
	| "BOSS_EVENT"
	| "FINAL_CHALLENGE"
	| "VICTORY"
	| "REWARDS"
	| "FINISHED"
	| "DEFEAT"
	| "CANCELLED";

/** One board tile as exposed to clients (schematic ring, SPEC-002 v1). */
export interface TournamentTileSummary {
	id: string;
	/** Tile kind for provisional rendering (e.g. "start", "points", "shop"). */
	kind: string;
	/** Position around the ring, 0-based, in successor order. */
	order: number;
}

/** One player's visible gameplay state (SPEC-022 "estado visible"). */
export interface TournamentPlayerStateSummary {
	userId: number;
	username: string;
	/** Profile picture (as served by the users API); null when unset. */
	avatar: string | null;
	/** Fixed seat = position in the turn order (D13). */
	seat: number;
	/** Tournament points (Economy wallet), never persistent coins. */
	points: number;
	/** Current board tile; null before INITIALIZING placed the player. */
	tileId: string | null;
	/** Connected to the tournament room right now (always true for CPUs). */
	connected: boolean;
	/** CPU participant — turns/gambling decided server-side. */
	isBot: boolean;
}

/**
 * Versioned gameplay snapshot (version 1, Vertical Slice): the COMPLETE
 * visible state (SPEC-022 "Sincronización — Snapshot First") — board ring,
 * player positions/points, phase/round/turn bookkeeping and the global Key
 * Item progress. Fields are added per phase under architect approval; the
 * client never derives state that is not here.
 */
export interface TournamentSnapshotV1 {
	version: 1;
	tournamentId: string;
	status: TournamentStatus;
	phase: TournamentWirePhase;
	round: number;
	maxRound: number;
	/** Fixed play order (userIds), derived from the seed (D13). */
	turnOrder: number[];
	/** Whose turn it is; null outside PLAYER_TURNS / between turns. */
	activePlayerId: number | null;
	/** ms-epoch deadline of the active turn (client countdown), else null. */
	turnDeadlineAt: number | null;
	board: {
		tiles: TournamentTileSummary[];
	};
	players: TournamentPlayerStateSummary[];
	keyItems: {
		unlocked: number;
		required: number;
	};
	/**
	 * The open Gambling decision (SPEC-016) — everyone watches it live
	 * (SPEC-039 "Tiempo de espectador"); null when no session is open.
	 * `deadlineAt` is the ms-epoch decision deadline (30 s).
	 */
	gambling: {
		winnerId: number;
		cost: number;
		winChance: number;
		deadlineAt: number;
	} | null;
	/** The running round minigame's match id (SPEC-015); null when none. */
	minigameMatchId: string | null;
	/** The champion once the tournament resolves (SPEC-021); null until then. */
	winnerUserId: number | null;
	/**
	 * The most recent resolved dice roll — presentation data: the client
	 * reveals the value and walks the token to the (already authoritative)
	 * position in `players`. `(round, playerId)` identifies the roll (one
	 * turn per player per round); null before the first roll.
	 */
	lastRoll: TournamentLastRollSummary | null;
	/**
	 * The most recent RESOLVED Key-Item bet (SPEC-016) — presentation data:
	 * while the phase is still GAMBLING_PHASE with no open session, the round
	 * is holding so every board can banner this outcome. `(round, playerId)`
	 * identifies the bet; null before the first resolved bet.
	 */
	lastGamble: TournamentGambleOutcomeSummary | null;
	/**
	 * The live tie-break roulette (SPEC-015 "Desempates", v2): the round's
	 * minigame tied, a seeded roulette among `playerIds` decides the winner.
	 * `winnerId` is already final — clients spin their roulette to land on it
	 * — and the round resumes at `resolveAt`. Null when no tie-break is live.
	 */
	tieBreak: TournamentTieBreakSummary | null;
	/**
	 * The live MINIGAME TIME! gate (SPEC-015 v2): the round's minigame is
	 * selected and waits for every human's "Let's go!" (ConfirmMinigameIntent)
	 * or the deadline before launching. Null when no gate is open.
	 */
	minigameGate: TournamentMinigameGateSummary | null;
	/**
	 * The open shop session (SPEC-012): the player who landed on the shop tile
	 * is browsing; the turn holds until they buy, close, or the deadline
	 * passes. Everyone watches live (SPEC-039); only the session's player may
	 * send BuyOfferIntent / EndTurnIntent. Null when no session is open.
	 */
	shop: TournamentShopSummary | null;
}

/** The open shop session as everyone sees it (SPEC-012 / SPEC-039). */
export interface TournamentShopSummary {
	/** The browsing player (the only one who may buy or close). */
	playerId: number;
	/** ms-epoch session deadline — the shop closes itself when it passes. */
	deadlineAt: number;
	/** The catalog as priced for the browsing player. */
	offers: TournamentShopOfferSummary[];
}

/** One purchasable offer as displayed on the boards (SPEC-012 "Shop Offer"). */
export interface TournamentShopOfferSummary {
	id: string;
	name: string;
	description: string;
	/** Emoji glyph for the offer card. */
	icon: string;
	/** Price in tournament points, rule price seam already applied. */
	price: number;
	/** False when out of stock or its requirements are unmet this round. */
	available: boolean;
}

/** The live pre-launch confirmation gate as everyone sees it (SPEC-015 v2). */
export interface TournamentMinigameGateSummary {
	/** The selected minigame waiting to launch. */
	minigameId: string;
	/** Every seated player (CPUs included — they never need to confirm). */
	playerIds: number[];
	/** Players who already pressed "Let's go!". */
	readyPlayerIds: number[];
	/** ms-epoch hard deadline: the match launches anyway when it passes. */
	deadlineAt: number;
}

/** The live tie-break roulette as everyone sees it (SPEC-015 "Desempates"). */
export interface TournamentTieBreakSummary {
	/** The tied players — the roulette's slices. */
	playerIds: number[];
	/** The seeded winner the roulette lands on. */
	winnerId: number;
	/** ms-epoch when the round resumes with the winner. */
	resolveAt: number;
}

/** The last resolved Key-Item bet as shown on the board (SPEC-016). */
export interface TournamentGambleOutcomeSummary {
	/** The minigame winner who took the bet. */
	playerId: number;
	round: number;
	/** True: a Key Item was unlocked. False: the staked points are gone. */
	won: boolean;
	/** Points that were staked. */
	cost: number;
}

/** The last resolved dice roll as shown on the board (SPEC-022). */
export interface TournamentLastRollSummary {
	playerId: number;
	round: number;
	/** The rolled die value. */
	value: number;
	/** True when the server resolved the roll (timeout / disconnection). */
	autoResolved: boolean;
}

/**
 * Payload of `tournament:snapshot` (snapshot-first, SPEC-022).
 * `seq` is monotonic: clients discard any snapshot with seq <= current.
 */
export interface TournamentSnapshotEnvelope {
	seq: number;
	snapshot: TournamentSnapshotV1;
}

// ── REST request shapes (implemented by tournaments.dto.ts classes) ───────────

/** Body of POST /tournaments/:id/invite. */
export interface InviteTournamentRequest {
	/** Friend to invite (must be a friend, never a guest). */
	userId: number;
}

/** Body of POST /tournaments/join-pin. */
export interface JoinTournamentByPinRequest {
	/** Case-insensitive; normalized to uppercase server-side. */
	pin: string;
}

/** Body of POST /tournaments/:id/remove-cpu. */
export interface RemoveTournamentCpuRequest {
	/** The CPU participant to unseat (its pooled bot user id). */
	botUserId: number;
}

// ── REST response shapes ───────────────────────────────────────────────────────

/** POST /tournaments — lobby created in `pending`. */
export type CreateTournamentResponse = TournamentLobbyState;
/**
 * GET /tournaments/:id — lobby/game state for UI hydration.
 * Active-game hydration (snapshot) is added in later phases.
 */
export type GetTournamentResponse = TournamentLobbyState;
/** POST /tournaments/:id/invite — lobby state after the invite is sent. */
export type InviteTournamentResponse = TournamentLobbyState;
/** POST /tournaments/:id/join — lobby state after accepting the invite. */
export type JoinTournamentResponse = TournamentLobbyState;
/** POST /tournaments/join-pin — lobby state after joining by PIN. */
export type JoinTournamentByPinResponse = TournamentLobbyState;
/** POST /tournaments/:id/leave — status is `cancelled` if the creator left. */
export type LeaveTournamentResponse = TournamentLobbyState;
/** POST /tournaments/:id/start — creator only; status becomes `active`. */
export type StartTournamentResponse = TournamentLobbyState;
/** POST /tournaments/:id/add-cpu — creator only; seats a CPU participant. */
export type AddTournamentCpuResponse = TournamentLobbyState;
/** POST /tournaments/:id/remove-cpu — creator only; unseats a CPU participant. */
export type RemoveTournamentCpuResponse = TournamentLobbyState;
