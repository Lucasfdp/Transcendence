import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
	ConnectedSocket,
	MessageBody,
	OnGatewayConnection,
	OnGatewayDisconnect,
	OnGatewayInit,
	SubscribeMessage,
	WebSocketGateway,
	WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { COOKIE_NAME } from "../auth/auth.service";
import { FriendsService } from "../friends/friends.service";
import { NotificationsService } from "../notifications/notifications.service";
import { UsersService } from "../users/users.service";
import { GameSessionService } from "./game-session.service";
import { MatchmakingService } from "./matchmaking.service";
import { PrivateLobbiesService } from "./private-lobbies.service";
import {
	BambooBashThrowEvent,
	BellClashThrowEvent,
	CurlingThrowEvent,
	GameInputPayload,
	KameKnockThrowEvent,
	MatchRoom,
	QueueJoinPayload,
	RoomPlayer,
	SocketUser,
	SpectatorJoinPayload,
} from "./matchmaking.types";
import { PresenceService } from "./presence.service";
import { ReplayService } from "./replay.service";
import { RoomService } from "./room.service";

const RECONNECT_TIMEOUT_MS = 45_000;

function parseCookie(
	cookieHeader: string | undefined,
	name: string,
): string | null {
	for (const part of (cookieHeader ?? "").split(";")) {
		const trimmed = part.trim();
		if (trimmed.startsWith(`${name}=`))
			return trimmed.slice(name.length + 1);
	}
	return null;
}

@WebSocketGateway({
	path: "/ws/",
	cors: {
		origin: process.env.ALLOWED_ORIGINS?.split(",") ?? ["https://localhost"],
		credentials: true,
	},
})
export class MatchmakingGateway
	implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
	@WebSocketServer()
	server: Server;

	private readonly logger = new Logger(MatchmakingGateway.name);

	constructor(
		private readonly jwtService: JwtService,
		private readonly usersService: UsersService,
		private readonly presence: PresenceService,
		private readonly matchmaking: MatchmakingService,
		private readonly rooms: RoomService,
		private readonly sessions: GameSessionService,
		private readonly notificationsService: NotificationsService,
		private readonly privateLobbies: PrivateLobbiesService,
		private readonly friendsService: FriendsService,
		private readonly replays: ReplayService,
	) {}

	/** Wire the Socket.io server into NotificationsService for real-time push. */
	afterInit(server: Server): void {
		this.notificationsService.setServer(server);
	}

	async handleConnection(socket: Socket): Promise<void> {
		try {
			const token = parseCookie(
				socket.handshake.headers.cookie,
				COOKIE_NAME,
			);
			if (!token) throw new Error("Missing auth cookie");
			const payload = this.jwtService.verify<{
				sub: number;
				username: string;
				isGuest: boolean;
				exp?: number;
			}>(token);
			const user = await this.usersService.findById(payload.sub);
			if (!user) throw new Error("User not found");

			const socketUser = {
				id: user.id,
				username: user.username,
				isGuest: user.isGuest,
			};
			this.presence.connect(socket.id, socketUser);
			socket.data.user = socketUser;

			if (socketUser.isGuest && payload.exp !== undefined) {
				const remainingMs = payload.exp * 1000 - Date.now();
				if (remainingMs <= 0) {
					socket.disconnect(true);
					return;
				}
				socket.data.guestTimer = setTimeout(() => {
					socket.disconnect(true);
				}, remainingMs);
			}

			const room = this.rooms.reconnect(socket.id, socketUser);
			if (room) {
				socket.join(room.matchId);
				socket.emit("reconnect", {
					matchId: room.matchId,
					side: room.players.find((p) => p.user.id === user.id)?.side,
				});
				socket.emit("game:state", room.state);
				this.emitUserMatchStatus(socket);
				this.emitState(room.matchId);
			}

			// Push unread notification inbox — guests have no persistent notifications
			if (!socketUser.isGuest) {
				void this.notificationsService.pushInboxToSocket(
					socket.id,
					socketUser.id,
				);
			}
		} catch (err) {
			socket.emit("error", {
				message: "Unauthorized websocket connection",
			});
			socket.disconnect(true);
		}
	}

	async handleDisconnect(socket: Socket): Promise<void> {
		if (socket.data.guestTimer !== undefined) {
			clearTimeout(socket.data.guestTimer as ReturnType<typeof setTimeout>);
			socket.data.guestTimer = undefined;
		}
		this.matchmaking.removeSocket(socket.id);
		this.rooms.removeSpectator(socket.id);
		const room = this.rooms.markDisconnected(
			socket.id,
			(timedOutRoom, player) =>
				void this.finishAbandonedMatch(timedOutRoom, player),
			RECONNECT_TIMEOUT_MS,
		);
		if (room) this.emitState(room.matchId);

		// Cancel any open lobby the disconnecting user was hosting
		const user = socket.data.user as SocketUser | undefined;
		if (user) {
			const cancelledLobby = this.privateLobbies.removeLobbyForUser(user.id);
			if (cancelledLobby?.pendingInviteeId) {
				for (const sid of this.presence.getSocketIds(cancelledLobby.pendingInviteeId)) {
					this.server.to(sid).emit("lobby:cancelled", { lobbyId: cancelledLobby.lobbyId });
				}
			}
		}

		this.presence.disconnect(socket.id);
	}

	@SubscribeMessage("queue:join")
	async onQueueJoin(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: QueueJoinPayload,
	): Promise<void> {
		try {
			const user = socket.data.user;
			const result = await this.matchmaking.joinQueue(
				socket.id,
				user,
				payload,
			);
			if (!result.matched) {
				socket.emit("queue:joined", {
					gameId: payload.gameId,
					mode: payload.mode,
				});
				return;
			}

			const room = this.rooms.getRoom(result.roomMatchId);
			if (!room) return;
			for (const player of room.players) {
				const playerSocket = this.server.sockets.sockets.get(
					player.socketId,
				);
				playerSocket?.join(room.matchId);
				playerSocket?.emit("match:found", {
					matchId: room.matchId,
					side: player.side,
					playerCount: room.players.length,
					opponents: room.players
						.filter((candidate) => candidate.side !== player.side)
						.map((candidate) => candidate.user.username),
				});
			}
			this.emitState(room.matchId);
		} catch (err) {
			socket.emit("queue:error", {
				message:
					err instanceof Error ? err.message : "Queue join failed",
			});
		}
	}

	@SubscribeMessage("queue:leave")
	onQueueLeave(@ConnectedSocket() socket: Socket): void {
		this.matchmaking.leaveQueue(socket.data.user.id);
		socket.emit("queue:left");
	}

	@SubscribeMessage("match:status")
	onMatchStatus(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload?: { away?: boolean },
	): void {
		if (payload?.away) {
			const room = this.rooms.markAway(
				socket.data.user.id,
				socket.id,
				(timedOutRoom, player) =>
					void this.finishAbandonedMatch(timedOutRoom, player),
				RECONNECT_TIMEOUT_MS,
			);
			if (room) this.emitState(room.matchId);
		}
		this.emitUserMatchStatus(socket);
	}

	@SubscribeMessage("match:rejoin")
	onMatchRejoin(@ConnectedSocket() socket: Socket): void {
		const room = this.rooms.reconnect(socket.id, socket.data.user);
		if (!room) {
			this.emitUserMatchStatus(socket);
			return;
		}
		socket.join(room.matchId);
		socket.emit("game:state", room.state);
		this.emitUserMatchStatus(socket);
		this.emitState(room.matchId);
	}

	@SubscribeMessage("match:abandon")
	async onMatchAbandon(@ConnectedSocket() socket: Socket): Promise<void> {
		const room = this.rooms.getRoomForUser(socket.data.user.id);
		const player = room?.players.find(
			(candidate) => candidate.user.id === socket.data.user.id,
		);
		if (!room || !player) {
			this.emitUserMatchStatus(socket);
			return;
		}
		await this.finishAbandonedMatch(room, player);
	}

	@SubscribeMessage("room:ready")
	async onRoomReady(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { matchId: string },
	): Promise<void> {
		const room = this.rooms.setReady(payload.matchId, socket.data.user.id);
		if (!room) return;
		this.emitState(room.matchId);
		const started = await this.sessions.startIfReady(room.matchId);
		if (started?.status === "active") this.emitState(started.matchId);
	}

	@SubscribeMessage("game:input")
	async onGameInput(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: GameInputPayload,
	): Promise<void> {
		const room = this.sessions.handleInput(socket.data.user.id, payload);
		if (!room) return;

		if (
			payload.action === "release" &&
			room.gameId === "temple-curling" &&
			"objects" in room.state
		) {
			const object = room.state.objects[room.state.objects.length - 1];
			if (object) {
				const throwEvent: CurlingThrowEvent = {
					matchId: room.matchId,
					id: object.id,
					side: object.side,
					vx: Number(payload.payload?.vx ?? 0),
					vy: Number(payload.payload?.vy ?? 0),
					power: object.power,
				};
				this.replays.recordEvent(
					room,
					"game:throw",
					throwEvent as unknown as Record<string, unknown>,
				);
				this.server.to(room.matchId).emit("game:throw", throwEvent);
			}
			return;
		}

		if (
			payload.action === "release" &&
			room.gameId === "bamboo-bash" &&
			"roundNumber" in room.state
		) {
			const player = room.players.find(
				(candidate) => candidate.user.id === socket.data.user.id,
			);
			if (player) {
				const throwEvent: BambooBashThrowEvent = {
					matchId: room.matchId,
					roundNumber: room.state.roundNumber,
					side: player.side,
					vx: Number(payload.payload?.vx ?? 0),
					vy: Number(payload.payload?.vy ?? 0),
					power: String(payload.payload?.power ?? "none"),
				};
				this.replays.recordEvent(
					room,
					"game:bamboo-throw",
					throwEvent as unknown as Record<string, unknown>,
				);
				this.server
					.to(room.matchId)
					.emit("game:bamboo-throw", throwEvent);
			}
			this.emitState(room.matchId);
			return;
		}

		if (
			payload.action === "release" &&
			room.gameId === "kame-knock" &&
			"roundNumber" in room.state &&
			"turnNumber" in room.state
		) {
			const player = room.players.find(
				(candidate) => candidate.user.id === socket.data.user.id,
			);
			if (player) {
				const throwEvent: KameKnockThrowEvent = {
					matchId: room.matchId,
					roundNumber: room.state.roundNumber,
					turnNumber: room.state.turnNumber,
					side: player.side,
					vx: Number(payload.payload?.vx ?? 0),
					vy: Number(payload.payload?.vy ?? 0),
					power: String(payload.payload?.power ?? "none"),
				};
				this.replays.recordEvent(
					room,
					"game:kame-throw",
					throwEvent as unknown as Record<string, unknown>,
				);
				this.server
					.to(room.matchId)
					.emit("game:kame-throw", throwEvent);
			}
			return;
		}

		if (
			payload.action === "release" &&
			room.gameId === "bell-clash" &&
			"roundNumber" in room.state &&
			"shotCounts" in room.state
		) {
			const player = room.players.find(
				(candidate) => candidate.user.id === socket.data.user.id,
			);
			if (player) {
				const throwEvent: BellClashThrowEvent = {
					matchId: room.matchId,
					roundNumber: room.state.roundNumber,
					shotNumber: room.state.shotCounts[player.side] ?? 0,
					side: player.side,
					vx: Number(payload.payload?.vx ?? 0),
					vy: Number(payload.payload?.vy ?? 0),
					power: String(payload.payload?.power ?? "none"),
				};
				this.replays.recordEvent(
					room,
					"game:bell-throw",
					throwEvent as unknown as Record<string, unknown>,
				);
				this.server
					.to(room.matchId)
					.emit("game:bell-throw", throwEvent);
			}
			this.emitState(room.matchId);
			return;
		}

		this.emitState(room.matchId);
		await this.sessions.finishIfEnded(room);
		if (room.status === "finished" || room.status === "abandoned") {
			this.server.to(room.matchId).emit("game:end", room.state);
		}
	}

	@SubscribeMessage("spectator:join")
	onSpectatorJoin(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: SpectatorJoinPayload,
	): void {
		const room = this.rooms.addSpectator(
			payload.matchId,
			socket.id,
			socket.data.user,
		);
		if (!room) return;
		socket.join(room.matchId);
		socket.emit("game:state", room.state);
	}

	@SubscribeMessage("spectator:leave")
	onSpectatorLeave(@ConnectedSocket() socket: Socket): void {
		const room = this.rooms.removeSpectator(socket.id);
		if (room) socket.leave(room.matchId);
	}

	// ── Private lobby handlers ────────────────────────────────────────────────

	/**
	 * Create a private casual lobby.
	 * Emits lobby:created { lobbyId } back to the host.
	 */
	@SubscribeMessage("lobby:create")
	async onLobbyCreate(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { gameId: string; shellSelection?: string[] },
	): Promise<void> {
		const user = socket.data.user as SocketUser;
		if (user.isGuest) {
			socket.emit("lobby:error", { message: "Guests cannot create lobbies" });
			return;
		}
		try {
			const lobby = this.privateLobbies.createLobby(
				socket.id,
				user,
				payload.gameId,
				payload.shellSelection ?? [],
				(expired) => {
					socket.emit("lobby:expired", { lobbyId: expired.lobbyId });
					if (expired.pendingInviteeId) {
						for (const sid of this.presence.getSocketIds(expired.pendingInviteeId)) {
							this.server.to(sid).emit("lobby:cancelled", { lobbyId: expired.lobbyId });
						}
					}
				},
			);
			socket.emit("lobby:created", {
				lobbyId: lobby.lobbyId,
				gameId: lobby.gameId,
				expiresAt: lobby.createdAt + 2 * 60 * 1_000,
			});
		} catch (err) {
			socket.emit("lobby:error", {
				message: err instanceof Error ? err.message : "Failed to create lobby",
			});
		}
	}

	/**
	 * Invite a friend to the lobby by their userId.
	 * Validates friendship and that the invitee is online and not mid-match.
	 */
	@SubscribeMessage("lobby:invite")
	async onLobbyInvite(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { lobbyId: string; inviteeUserId: number },
	): Promise<void> {
		const user = socket.data.user as SocketUser;
		const lobby = this.privateLobbies.getLobby(payload.lobbyId);

		if (!lobby || lobby.host.id !== user.id) {
			socket.emit("lobby:error", { message: "Lobby not found" });
			return;
		}
		if (this.rooms.hasActiveRoom(payload.inviteeUserId)) {
			socket.emit("lobby:error", { message: "That player is already in a match" });
			return;
		}
		if (!this.presence.isOnline(payload.inviteeUserId)) {
			socket.emit("lobby:error", { message: "That player is offline" });
			return;
		}
		const areFriends = await this.friendsService
			.areFriends(user.id, payload.inviteeUserId)
			.catch(() => false);
		if (!areFriends) {
			socket.emit("lobby:error", { message: "You can only invite friends" });
			return;
		}

		this.privateLobbies.setInvitee(payload.lobbyId, payload.inviteeUserId);

		const expiresAt = lobby.createdAt + 2 * 60 * 1_000;
		for (const sid of this.presence.getSocketIds(payload.inviteeUserId)) {
			this.server.to(sid).emit("lobby:invited", {
				lobbyId: lobby.lobbyId,
				fromUserId: user.id,
				fromUsername: user.username,
				gameId: lobby.gameId,
				expiresAt,
			});
		}
		socket.emit("lobby:invite-sent", { inviteeUserId: payload.inviteeUserId });
	}

	/**
	 * Invitee accepts and joins the lobby.
	 * Creates a match + room and emits lobby:matched to both players.
	 */
	@SubscribeMessage("lobby:join")
	async onLobbyJoin(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { lobbyId: string; shellSelection?: string[] },
	): Promise<void> {
		const user = socket.data.user as SocketUser;
		try {
			const result = await this.privateLobbies.joinLobby(
				payload.lobbyId,
				socket.id,
				user,
				payload.shellSelection ?? [],
			);
			if (!result) {
				socket.emit("lobby:error", { message: "Lobby no longer exists" });
				return;
			}

			const { matchId, room } = result;
			for (const player of room.players) {
				for (const sid of this.presence.getSocketIds(player.user.id)) {
					const s = this.server.sockets.sockets.get(sid);
					if (s) {
						s.join(matchId);
						s.emit("lobby:matched", {
							matchId,
							side: player.side,
							gameId: room.gameId,
						});
						s.emit("game:state", room.state);
					}
				}
			}
		} catch (err) {
			socket.emit("lobby:error", {
				message: err instanceof Error ? err.message : "Failed to join lobby",
			});
		}
	}

	/** Invitee declines — notifies the host. */
	@SubscribeMessage("lobby:decline")
	onLobbyDecline(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { lobbyId: string },
	): void {
		const lobby = this.privateLobbies.getLobby(payload.lobbyId);
		if (!lobby) return;
		lobby.pendingInviteeId = null;
		for (const sid of this.presence.getSocketIds(lobby.host.id)) {
			this.server.to(sid).emit("lobby:declined", { lobbyId: payload.lobbyId });
		}
	}

	/** Host cancels the lobby — notifies any pending invitee. */
	@SubscribeMessage("lobby:cancel")
	onLobbyCancel(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { lobbyId: string },
	): void {
		const user = socket.data.user as SocketUser;
		const lobby = this.privateLobbies.getLobby(payload.lobbyId);
		if (!lobby || lobby.host.id !== user.id) return;

		const cancelled = this.privateLobbies.cancelLobby(payload.lobbyId);
		if (cancelled?.pendingInviteeId) {
			for (const sid of this.presence.getSocketIds(cancelled.pendingInviteeId)) {
				this.server.to(sid).emit("lobby:cancelled", { lobbyId: payload.lobbyId });
			}
		}
		socket.emit("lobby:cancelled", { lobbyId: payload.lobbyId });
	}

	/** Mark a single notification as read for the authenticated user. */
	@SubscribeMessage("notification:read")
	async onNotificationRead(
		@ConnectedSocket() socket: Socket,
		@MessageBody() data: { notificationId: number },
	): Promise<void> {
		const user = socket.data.user as { id: number; isGuest: boolean } | undefined;
		if (!user || user.isGuest) return;
		await this.notificationsService.markRead(user.id, data.notificationId).catch(() => undefined);
	}

	/** Mark all unread notifications as read for the authenticated user. */
	@SubscribeMessage("notification:read-all")
	async onNotificationReadAll(@ConnectedSocket() socket: Socket): Promise<void> {
		const user = socket.data.user as { id: number; isGuest: boolean } | undefined;
		if (!user || user.isGuest) return;
		await this.notificationsService.markAllRead(user.id).catch(() => undefined);
	}

	private emitState(matchId: string): void {
		const room = this.rooms.getRoom(matchId);
		if (room) {
			this.replays.captureFrame(room);
			this.server.to(matchId).emit("game:state", room.state);
		}
	}

	private emitUserMatchStatus(socket: Socket): void {
		const status = this.rooms.getUserMatchStatus(socket.data.user.id);
		if (!status) {
			socket.emit("match:status", { inMatch: false });
			return;
		}

		socket.emit("match:status", {
			inMatch: true,
			matchId: status.room.matchId,
			gameId: status.room.gameId,
			phase: status.room.status,
			side: status.side,
			reconnectExpiresAt: status.reconnectExpiresAt,
			snapshot: status.room.state,
		});
	}

	private async finishAbandonedMatch(
		room: MatchRoom,
		player: RoomPlayer,
	): Promise<void> {
		const finished = await this.sessions.abandon(room, player);
		if (!finished) return;
		this.emitState(finished.matchId);
		this.server.to(finished.matchId).emit("game:end", finished.state);
		for (const roomPlayer of finished.players) {
			const playerSocket = this.server.sockets.sockets.get(
				roomPlayer.socketId,
			);
			if (playerSocket) this.emitUserMatchStatus(playerSocket);
		}
	}
}
