/**
 * tournament.gateway.ts — Tournament WS handlers (SPEC-022 "Implementación").
 *
 * Lives in the tournaments module — NEVER inside matchmaking.gateway.ts
 * (SPEC-037). It shares the platform's single Socket.IO server (path `/ws/`,
 * cookie-JWT auth in the handshake): the matchmaking gateway authenticates
 * every connection and stamps `socket.data.user`, so this gateway only
 * validates and routes tournament messages.
 *
 * Contract (tournaments.contracts.ts):
 * - `tournament:join`   → validate participant, enter room, ack the current
 *   snapshot envelope (SPEC-022 "Reconexión": the snapshot IS the state).
 * - `tournament:intent` → validate + forward to the Runtime; ack is
 *   accepted/rejected ONLY, never state (SPEC-022 "Validación").
 * - `tournament:leave`  → leave the room; the active turn (if theirs)
 *   auto-resolves (SPEC-005 "Desconexión"). Still reconnectable.
 * - `tournament:quit`   → quit the match FOR GOOD ("Leave match" button): the
 *   player is barred from rejoining and freed to start a new tournament.
 * - disconnect          → same as leave, driven by the socket lifecycle.
 */

import { Logger } from "@nestjs/common";
import {
	ConnectedSocket,
	MessageBody,
	OnGatewayDisconnect,
	OnGatewayInit,
	SubscribeMessage,
	WebSocketGateway,
	WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { TournamentRuntimeService } from "./runtime/tournament-runtime.service";
import { TournamentLobbyService } from "./tournament-lobby.service";
import {
	TournamentSyncService,
	tournamentRoomName,
} from "./tournament-sync.service";
import {
	TOURNAMENT_WS_MESSAGES,
	TournamentIntentAck,
	TournamentIntentEnvelope,
	TournamentJoinAck,
	TournamentJoinRequest,
	TournamentQuitRequest,
} from "./tournaments.contracts";

/** Set on the socket while it is inside a tournament room. */
interface TournamentSocketData {
	tournamentId?: string;
}

@WebSocketGateway({
	path: "/ws/",
	cors: {
		origin: process.env.ALLOWED_ORIGINS?.split(",") ?? ["https://localhost"],
		credentials: true,
	},
})
export class TournamentGateway implements OnGatewayInit, OnGatewayDisconnect {
	@WebSocketServer()
	server: Server;

	private readonly logger = new Logger(TournamentGateway.name);

	constructor(
		private readonly runtimeService: TournamentRuntimeService,
		private readonly sync: TournamentSyncService,
		private readonly lobby: TournamentLobbyService,
	) {}

	afterInit(server: Server): void {
		this.sync.setServer(server);
	}

	@SubscribeMessage(TOURNAMENT_WS_MESSAGES.JOIN)
	handleJoin(
		@ConnectedSocket() socket: Socket,
		@MessageBody() body: TournamentJoinRequest,
	): TournamentJoinAck {
		const userId = this.authenticatedUserId(socket);
		const tournamentId = body?.tournamentId;
		if (userId === null || typeof tournamentId !== "string") {
			return { ok: false, reason: "not_participant" };
		}
		const runtime = this.runtimeService.getRuntime(tournamentId);
		if (!runtime || !this.sync.isAttached(tournamentId)) {
			return { ok: false, reason: "not_running" };
		}
		if (!runtime.playOrder.includes(userId)) {
			this.logger.warn(
				`join rejected: user ${userId} is not a participant of ${tournamentId}`,
			);
			return { ok: false, reason: "not_participant" };
		}
		// A quitter ("Leave match") is out for good — reconnection is only for
		// players who merely disconnected (SPEC-022 "Reconexión").
		if (this.sync.hasLeft(tournamentId, userId)) {
			return { ok: false, reason: "left" };
		}

		void socket.join(tournamentRoomName(tournamentId));
		(socket.data as TournamentSocketData).tournamentId = tournamentId;
		this.sync.markConnected(tournamentId, userId);
		// Feeds the runtime's arrival gate (round 1 waits for every human) and
		// cancels any pending disconnect auto-resolve for this player.
		runtime.handlePlayerConnected(userId);

		const envelope = this.sync.buildEnvelope(tournamentId);
		return envelope ? { ok: true, envelope } : { ok: false, reason: "not_running" };
	}

	@SubscribeMessage(TOURNAMENT_WS_MESSAGES.INTENT)
	handleIntent(
		@ConnectedSocket() socket: Socket,
		@MessageBody() body: TournamentIntentEnvelope,
	): TournamentIntentAck {
		const userId = this.authenticatedUserId(socket);
		if (userId === null || typeof body?.tournamentId !== "string") {
			return { accepted: false, reason: "not_participant" };
		}
		const runtime = this.runtimeService.getRuntime(body.tournamentId);
		if (!runtime) {
			return { accepted: false, reason: "not_running" };
		}
		if (!runtime.playOrder.includes(userId)) {
			return { accepted: false, reason: "not_participant" };
		}
		// A quitter is out for good — reject any late intent from a lingering
		// socket (e.g. a second tab), so they can never act on a future turn.
		if (this.sync.hasLeft(body.tournamentId, userId)) {
			return { accepted: false, reason: "left" };
		}

		// Only catalogued intents are routed (SPEC-022 "Cliente modificado →
		// rechazar"); the Runtime re-validates phase/actor for each.
		switch (body.intent?.name) {
			case "RollDiceIntent": {
				const result = runtime.handleRollDice(userId);
				return result.status === "ok"
					? { accepted: true }
					: { accepted: false, reason: result.reason };
			}
			case "StartGamblingIntent": {
				const result = runtime.handleStartGambling(userId);
				return result.status === "ok"
					? { accepted: true }
					: { accepted: false, reason: result.reason };
			}
			case "LeaveGamblingIntent": {
				runtime.handleLeaveGambling(userId);
				return { accepted: true };
			}
			case "ConfirmMinigameIntent": {
				const result = runtime.handleConfirmMinigame(userId);
				return result.status === "ok"
					? { accepted: true }
					: { accepted: false, reason: result.reason };
			}
			default:
				return { accepted: false, reason: "unknown_intent" };
		}
	}

	@SubscribeMessage(TOURNAMENT_WS_MESSAGES.LEAVE)
	handleLeave(@ConnectedSocket() socket: Socket): void {
		this.exitRoom(socket);
	}

	/**
	 * Quit the match for good ("Leave match" button): unlike LEAVE/disconnect,
	 * the player is barred from rejoining this tournament (in-memory `hasLeft`)
	 * and released from the one-tournament-per-user gate (persisted `hasLeft`),
	 * so they can create/join a new tournament right away. Their seat is handed
	 * to a CPU (`convertPlayerToBot`) that plays out the rest of the match in
	 * their place, so the tournament never waits on someone who is gone.
	 */
	@SubscribeMessage(TOURNAMENT_WS_MESSAGES.QUIT)
	async handleQuit(
		@ConnectedSocket() socket: Socket,
		@MessageBody() body?: TournamentQuitRequest,
	): Promise<void> {
		const data = socket.data as TournamentSocketData;
		const userId = this.authenticatedUserId(socket);
		if (userId === null) {
			return;
		}
		// The board quits from inside the tournament room (socket.data). The
		// in-arena "Leave game" button quits from the minigame — that socket
		// already LEFT the room, so the id comes in the body and MUST be
		// validated against the runtime's participants before acting on it.
		let tournamentId = data.tournamentId;
		if (!tournamentId) {
			const requested = body?.tournamentId;
			if (
				typeof requested !== "string" ||
				!this.runtimeService.getRuntime(requested)?.playOrder.includes(userId)
			) {
				return;
			}
			tournamentId = requested;
		}
		data.tournamentId = undefined;
		void socket.leave(tournamentRoomName(tournamentId));

		// Bar reconnection (in-memory) and free the new-tournament gate (DB).
		this.sync.markLeft(tournamentId, userId);
		try {
			await this.lobby.markParticipantLeft(tournamentId, userId);
		} catch (error) {
			this.logger.error(
				`failed to persist quit for user ${userId} in ${tournamentId}`,
				error instanceof Error ? error.stack : String(error),
			);
		}
		// Replace the departed player with a CPU: it plays their remaining board
		// turns and gambling decisions, and takes over any decision they own
		// right now, so the match plays on without them (CPU v2 / SPEC-005).
		const runtime = this.runtimeService.getRuntime(tournamentId);
		runtime?.convertPlayerToBot(userId);
		// Quit mid-minigame ("Leave game" in the arena): hand their live arena
		// seat to a CPU stand-in too, so the minigame plays on for the others
		// instead of dangling into the disconnect-forfeit path.
		this.runtimeService.convertMinigameSeatToBot(tournamentId, userId);

		// No real players left → tear the whole tournament down (and any in-flight
		// minigame) instead of letting an all-CPU game run on in limbo.
		if (runtime && runtime.humanPlayerCount === 0) {
			try {
				await this.runtimeService.cancelTournament(
					tournamentId,
					"all players left the match",
				);
			} catch (error) {
				this.logger.error(
					`failed to cancel emptied tournament ${tournamentId}`,
					error instanceof Error ? error.stack : String(error),
				);
			}
		}
	}

	handleDisconnect(socket: Socket): void {
		this.exitRoom(socket);
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/** Authenticated by the shared connection handler (matchmaking gateway). */
	private authenticatedUserId(socket: Socket): number | null {
		const user = (socket.data as { user?: { id?: number } }).user;
		return typeof user?.id === "number" ? user.id : null;
	}

	private exitRoom(socket: Socket): void {
		const data = socket.data as TournamentSocketData;
		const tournamentId = data.tournamentId;
		if (!tournamentId) {
			return;
		}
		data.tournamentId = undefined;
		void socket.leave(tournamentRoomName(tournamentId));

		const userId = this.authenticatedUserId(socket);
		if (userId === null) {
			return;
		}
		this.sync.markDisconnected(tournamentId, userId);
		// If it was their turn, the Turn System auto-resolves it (SPEC-005).
		this.runtimeService.getRuntime(tournamentId)?.handlePlayerDisconnect(userId);
	}
}
