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
 *   auto-resolves (SPEC-005 "Desconexión").
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

		void socket.join(tournamentRoomName(tournamentId));
		(socket.data as TournamentSocketData).tournamentId = tournamentId;
		this.sync.markConnected(tournamentId, userId);

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

		// The only live intent (Vertical Slice). Unknown intents are rejected —
		// clients can only REQUEST catalogued actions (SPEC-022 "Cliente
		// modificado → rechazar").
		if (body.intent?.name !== "RollDiceIntent") {
			return { accepted: false, reason: "unknown_intent" };
		}
		const result = runtime.handleRollDice(userId);
		return result.status === "ok"
			? { accepted: true }
			: { accepted: false, reason: result.reason };
	}

	@SubscribeMessage(TOURNAMENT_WS_MESSAGES.LEAVE)
	handleLeave(@ConnectedSocket() socket: Socket): void {
		this.exitRoom(socket);
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
