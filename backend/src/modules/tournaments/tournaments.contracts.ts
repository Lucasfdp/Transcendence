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
	| "EndTurnIntent";

/** The one live intent (Vertical Slice): the active player asks to roll. */
export interface RollDiceIntent {
	name: "RollDiceIntent";
}

/** Union of the intents a client may send today; grows per phase. */
export type TournamentIntent = RollDiceIntent;

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
 * Ack of `tournament:join`: the current snapshot envelope on success (the
 * reconnection path, SPEC-022), or a rejection reason.
 */
export type TournamentJoinAck =
	| { ok: true; envelope: TournamentSnapshotEnvelope }
	| { ok: false; reason: "not_found" | "not_participant" | "not_running" };

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
	/** Fixed seat = position in the turn order (D13). */
	seat: number;
	/** Tournament points (Economy wallet), never persistent coins. */
	points: number;
	/** Current board tile; null before INITIALIZING placed the player. */
	tileId: string | null;
	/** Connected to the tournament room right now. */
	connected: boolean;
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
