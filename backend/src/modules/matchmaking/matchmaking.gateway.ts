import { Logger, OnModuleDestroy, Optional } from "@nestjs/common";
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
import { RateLimiterService } from "../auth/rate-limiter.service";
import { ChatService, chatRoomName } from "../chat/chat.service";
import { FriendsService } from "../friends/friends.service";
import { NotificationsService } from "../notifications/notifications.service";
import { UsersService } from "../users/users.service";
import { GameSessionService } from "./game-session.service";
import { MatchmakingService } from "./matchmaking.service";
import {
	PRIVATE_LOBBY_NOT_FOUND_MESSAGE,
	PrivateLobbiesService,
	type LobbyJoinResult,
	type PrivateLobby,
} from "./private-lobbies.service";
import {
	BellClashThrowEvent,
	BellClashSnapshot,
	BambooBashThrowEvent,
	BambooBashSnapshot,
	CurlingThrowEvent,
	GameInputPayload,
	KameKnockThrowEvent,
	KameKnockSnapshot,
	MatchRoom,
	QueueJoinPayload,
	RoomPlayer,
	SocketUser,
	SpectatorJoinPayload,
} from "./matchmaking.types";
import { PresenceService } from "./presence.service";
import { ReplayService } from "./replay.service";
import { RoomService } from "./room.service";
import { ArenaSimulationService } from "./arena-simulation.service";

const RECONNECT_TIMEOUT_MS = 45_000;

/**
 * Per-user cap on socket-sent messages (text + gif share the bucket) — mirrors
 * the REST limit in ChatController so neither path can flood a conversation
 * (Bug Audit M7).
 */
const CHAT_SEND_RATE_LIMIT_MAX = 30;
const CHAT_SEND_RATE_LIMIT_WINDOW_MS = 10_000;
// Game input is accepted-action amplifying (one release fans out to the whole
// room), so it needs its own bucket (R4). 20 inputs/second is generous for a
// human aiming and launching, but caps a hostile/broken client's spam loop.
const GAME_INPUT_RATE_LIMIT_MAX = 20;
const GAME_INPUT_RATE_LIMIT_WINDOW_MS = 1_000;
// A physics projection is only needed at join/rejoin, so its bucket is tight.
const PHYSICS_REQUEST_RATE_LIMIT_MAX = 5;
const PHYSICS_REQUEST_RATE_LIMIT_WINDOW_MS = 2_000;
// R5 backstop: a room still `pending` this long after creation is aborted
// winnerless — it means a matched seat never readied (a dead socket the
// liveness check somehow missed, or a client that vanished before `room:ready`).
const PENDING_ROOM_TTL_MS = 2 * 60 * 1000;
const PENDING_ROOM_SWEEP_INTERVAL_MS = 30 * 1000;
// Retry bounds for persisting an authoritative match settlement (R10 — named
// instead of inline magic numbers). Backoff is linear: base × (attempt + 1).
const FINISH_PERSIST_MAX_RETRIES = 2;
const FINISH_PERSIST_RETRY_BASE_MS = 1_000;

interface GameInputAck {
	accepted: boolean;
	reason?: "invalid-input" | "rate-limited";
}

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
		origin: process.env.ALLOWED_ORIGINS?.split(",") ?? [
			"https://localhost",
		],
		credentials: true,
	},
})
export class MatchmakingGateway
	implements
		OnGatewayInit,
		OnGatewayConnection,
		OnGatewayDisconnect,
		OnModuleDestroy
{
	@WebSocketServer()
	server: Server;

	private readonly logger = new Logger(MatchmakingGateway.name);
	private readonly lastBroadcastLifecycleSeq = new Map<string, number>();
	private readonly finishingMatchIds = new Set<string>();
	private pendingSweepTimer: NodeJS.Timeout | null = null;

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
		private readonly chatService: ChatService,
		private readonly arenaSimulation: ArenaSimulationService,
		// Optional so the gateway spec (which mocks only the services it
		// exercises) still instantiates without wiring a limiter; production
		// always provides one via MatchmakingModule.
		@Optional() private readonly rateLimiter?: RateLimiterService,
	) {}

	/**
	 * Fan out a coarse presence transition (offline→online, →offline,
	 * online↔in-game) to each of the user's online friends so their friends
	 * list updates live (Decision 3). One `getFriendIds` query per transition,
	 * not per socket. Guests have no friends, so the isGuest short-circuit just
	 * avoids the query — an unguarded call would still no-op via an empty
	 * friend list. Non-fatal: a missed ping only means a stale dot until the
	 * friend's next Social open.
	 */
	private async broadcastPresence(
		userId: number,
		isGuest = false,
	): Promise<void> {
		if (isGuest) return;
		try {
			const status = this.presence.getStatus(userId);
			const gameId = this.presence.getGameId(userId);
			const friendIds = await this.friendsService.getFriendIds(userId);
			for (const friendId of friendIds) {
				this.notificationsService.pushLiveEvent(
					"presence:changed",
					friendId,
					{
						userId,
						status,
						gameId,
					},
				);
			}
		} catch {
			// Non-fatal — see doc comment.
		}
	}

	/** True if the user is within the socket send window (or no limiter wired). */
	private allowChatSend(userId: number): boolean {
		return (
			!this.rateLimiter ||
			this.rateLimiter.allowKey(
				"chat-send",
				String(userId),
				CHAT_SEND_RATE_LIMIT_MAX,
				CHAT_SEND_RATE_LIMIT_WINDOW_MS,
			)
		);
	}

	/** True if the user is within the game-input window (or no limiter wired). */
	private allowGameInput(userId: number): boolean {
		return (
			!this.rateLimiter ||
			this.rateLimiter.allowKey(
				"game-input",
				String(userId),
				GAME_INPUT_RATE_LIMIT_MAX,
				GAME_INPUT_RATE_LIMIT_WINDOW_MS,
			)
		);
	}

	/** True if the user is within the physics-request window (or no limiter). */
	private allowPhysicsRequest(userId: number): boolean {
		return (
			!this.rateLimiter ||
			this.rateLimiter.allowKey(
				"game-physics-request",
				String(userId),
				PHYSICS_REQUEST_RATE_LIMIT_MAX,
				PHYSICS_REQUEST_RATE_LIMIT_WINDOW_MS,
			)
		);
	}

	/**
	 * Wire the Socket.io server into the services that push real-time events
	 * outside of a direct request/response (NotificationsService for the bell,
	 * ChatService for REST-originated chat broadcasts and unread digests).
	 */
	afterInit(server: Server): void {
		this.notificationsService.setServer(server);
		this.chatService.setServer(server);
		this.arenaSimulation.start((matchId) => this.emitPhysicsState(matchId));
		this.pendingSweepTimer = setInterval(
			() => void this.sweepPendingRooms(),
			PENDING_ROOM_SWEEP_INTERVAL_MS,
		);
		// Never keep the process alive solely for the sweep.
		this.pendingSweepTimer.unref?.();
	}

	onModuleDestroy(): void {
		if (this.pendingSweepTimer) clearInterval(this.pendingSweepTimer);
		this.pendingSweepTimer = null;
	}

	/**
	 * R5 backstop: abort any room stuck in `pending` past the TTL so a match that
	 * never readied cannot hang forever or keep its seated users locked out of
	 * re-queueing. Aborts are winnerless and idempotent.
	 */
	private async sweepPendingRooms(): Promise<void> {
		for (const room of this.rooms.getStalePendingRooms(PENDING_ROOM_TTL_MS)) {
			await this.abortMatch(
				room.matchId,
				"pending timeout — a matched seat never readied",
			);
		}
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
			const user = await this.usersService.findCanonicalById(payload.sub);
			if (!user) throw new Error("User not found");

			const socketUser = {
				id: user.id,
				username: user.username,
				turtleName: user.turtleName ?? null,
				shellSkin: user.shellSkin ?? "base",
				trailEffect: user.trailEffect ?? "trail_classic",
				hubBackground: user.hubBackground ?? "night_bg",
				hubBackgroundAlter: user.hubBackgroundAlter ?? null,
				isGuest: user.isGuest,
			};
			// Capture before connect so we only fan out on the offline→online
			// edge, not on a second tab/device connecting (Decision 3).
			const wasOnline = this.presence.isOnline(socketUser.id);
			this.presence.connect(socket.id, socketUser);
			socket.data.user = socketUser;
			if (!wasOnline) {
				void this.broadcastPresence(socketUser.id, socketUser.isGuest);
			}

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

			const reconnected = this.rooms.reconnect(
				socket.id,
				socketUser,
				(id) => this.isSocketLive(id),
			);
			if (reconnected?.outcome === "rebound") {
				const room = reconnected.room;
				socket.join(room.matchId);
				socket.emit("reconnect", {
					matchId: room.matchId,
					side: room.players.find((p) => p.user.id === user.id)?.side,
				});
				socket.emit("game:state", room.state);
				if (room.physicsState)
					socket.emit("game:physics-state", this.publicPhysicsState(room));
				this.emitUserMatchStatus(socket);
				this.emitState(room.matchId);
			} else if (reconnected?.outcome === "occupied") {
				// R1: a second tab/device — do not steal the live seat.
				socket.emit("match:active-elsewhere", {
					matchId: reconnected.room.matchId,
				});
			}

			// Push unread notification inbox + join chat rooms — guests have no
			// persistent notifications or conversations, so this is non-guest only.
			if (!socketUser.isGuest) {
				void this.notificationsService.pushInboxToSocket(
					socket.id,
					socketUser.id,
				);
				await this.joinChatRooms(socket, socketUser.id);
				void this.chatService.pushUnreadInboxToSocket(
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
			clearTimeout(
				socket.data.guestTimer as ReturnType<typeof setTimeout>,
			);
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
			const cancelledLobby = this.privateLobbies.removeLobbyForUser(
				user.id,
			);
			if (cancelledLobby?.pendingInviteeId) {
				this.emitToUser(
					cancelledLobby.pendingInviteeId,
					"lobby:cancelled",
					{
						lobbyId: cancelledLobby.lobbyId,
					},
				);
			}
		}

		const disconnectedUser = this.presence.disconnect(socket.id);
		// Once a non-guest user's last socket drops, record their last-seen time
		// so offline friends can render "last online". Non-fatal on failure.
		if (
			disconnectedUser &&
			!disconnectedUser.isGuest &&
			!this.presence.isOnline(disconnectedUser.id)
		) {
			void this.usersService
				.markSeen(disconnectedUser.id)
				.catch(() => undefined);
			// Last socket gone → tell online friends they went offline (Decision 3).
			void this.broadcastPresence(
				disconnectedUser.id,
				disconnectedUser.isGuest,
			);
		}
	}

	@SubscribeMessage("queue:join")
	async onQueueJoin(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: QueueJoinPayload,
	): Promise<void> {
		try {
			const user = this.resolveSocketUser(socket);
			if (!user) throw new Error("Authentication required");
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
				if (!playerSocket) {
					// R5: this seat's socket died between the queue splice and room
					// creation (createMatch does two DB round-trips). Arm the
					// reconnect/forfeit window now, otherwise the seat sits
					// `connected: true` on a dead socket, never readies, and hangs
					// the room in `pending` for everyone else.
					this.rooms.markDisconnected(
						player.socketId,
						(timedOutRoom, timedOutPlayer) =>
							void this.finishAbandonedMatch(
								timedOutRoom,
								timedOutPlayer,
							),
						RECONNECT_TIMEOUT_MS,
					);
					continue;
				}
				playerSocket.join(room.matchId);
				playerSocket.emit("match:found", {
					matchId: room.matchId,
					side: player.side,
					playerCount: room.players.length,
					opponents: room.players
						.filter((candidate) => candidate.side !== player.side)
						.map((candidate) => candidate.user.username),
					replayEnabled: room.replayEnabled,
					replayDisabledReason: room.replayDisabledReason,
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

	private resolveSocketUser(socket: Socket): SocketUser | null {
		return (
			(socket.data.user as SocketUser | undefined) ??
			this.presence.getUser(socket.id) ??
			null
		);
	}

	@SubscribeMessage("queue:leave")
	onQueueLeave(@ConnectedSocket() socket: Socket): void {
		const user = this.resolveSocketUser(socket);
		if (!user) return;
		this.matchmaking.leaveQueue(user.id);
		socket.emit("queue:left");
	}

	@SubscribeMessage("match:status")
	onMatchStatus(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload?: { away?: boolean },
	): void {
		const user = this.resolveSocketUser(socket);
		if (!user) return;
		if (payload?.away) {
			const room = this.rooms.markAway(
				user.id,
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
		const user = this.resolveSocketUser(socket);
		if (!user) {
			this.emitUserMatchStatus(socket);
			return;
		}
		const reconnected = this.rooms.reconnect(socket.id, user, (id) =>
			this.isSocketLive(id),
		);
		if (reconnected?.outcome !== "rebound") {
			if (reconnected?.outcome === "occupied")
				socket.emit("match:active-elsewhere", {
					matchId: reconnected.room.matchId,
				});
			this.emitUserMatchStatus(socket);
			return;
		}
		const room = reconnected.room;
		socket.join(room.matchId);
		socket.emit("game:state", room.state);
		if (room.physicsState)
			socket.emit("game:physics-state", this.publicPhysicsState(room));
		this.emitUserMatchStatus(socket);
		this.emitState(room.matchId);
	}

	@SubscribeMessage("match:abandon")
	async onMatchAbandon(@ConnectedSocket() socket: Socket): Promise<void> {
		const user = this.resolveSocketUser(socket);
		if (!user) return;
		const room = this.rooms.getRoomForUser(user.id);
		const player = room?.players.find(
			(candidate) => candidate.user.id === user.id,
		);
		if (!room || !player) {
			this.emitUserMatchStatus(socket);
			return;
		}
		await this.finishAbandonedMatch(room, player);
	}

	@SubscribeMessage("match:play-again")
	async onMatchPlayAgain(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { matchId?: string },
	): Promise<void> {
		const user = this.resolveSocketUser(socket);
		if (!user || !payload.matchId) return;
		const room = this.rooms.getRoom(payload.matchId);
		const player = room?.players.find(
			(candidate) => candidate.user.id === user.id,
		);
		if (!room || !player || room.status !== "finished") return;

		room.rematchReadyUserIds ??= new Set<number>();
		room.rematchLeftUserIds ??= new Set<number>();
		room.rematchReadyUserIds.add(user.id);
		room.rematchLeftUserIds.delete(user.id);
		socket.join(room.matchId);
		this.emitRematchStatus(room);
		await this.startRematchIfReady(room);
	}

	@SubscribeMessage("match:leave-finished")
	async onMatchLeaveFinished(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { matchId?: string },
	): Promise<void> {
		const user = this.resolveSocketUser(socket);
		if (!user || !payload.matchId) return;
		const room = this.rooms.getRoom(payload.matchId);
		const player = room?.players.find(
			(candidate) => candidate.user.id === user.id,
		);
		if (!room || !player || room.status !== "finished") return;

		room.rematchReadyUserIds ??= new Set<number>();
		room.rematchLeftUserIds ??= new Set<number>();
		room.rematchReadyUserIds.delete(user.id);
		room.rematchLeftUserIds.add(user.id);
		socket.leave(room.matchId);
		this.emitRematchStatus(room);
		await this.startRematchIfReady(room);
	}

	@SubscribeMessage("room:ready")
	async onRoomReady(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { matchId: string },
	): Promise<void> {
		const user = this.resolveSocketUser(socket);
		if (!user) return;
		const room = this.rooms.setReady(payload.matchId, user.id);
		if (!room) return;
		this.emitState(room.matchId);
		const started = await this.sessions.startIfReady(room.matchId);
		if (started?.status === "active") this.emitState(started.matchId);
	}

	@SubscribeMessage("game:input")
	async onGameInput(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: GameInputPayload,
	): Promise<GameInputAck> {
		const user = this.resolveSocketUser(socket);
		if (!user) return { accepted: false, reason: "invalid-input" };
		// R4: rate-limit the socket entry point only. Server-side seats (bots,
		// tournament stand-ins) call handleUserInput directly and are never
		// throttled — they cannot spam by construction.
		if (!this.allowGameInput(user.id))
			return { accepted: false, reason: "rate-limited" };
		return this.handleUserInput(user.id, payload);
	}

	/**
	 * The ONE game-input pipeline (engine dispatch + per-game throw broadcasts
	 * + replay capture + end-of-match settlement). PUBLIC so server-side
	 * players (the tournament's CPU stand-ins, BotPlayerService) submit moves
	 * through exactly the same validation and side-effects as human sockets —
	 * never a parallel path.
	 */
	async handleUserInput(
		userId: number,
		payload: GameInputPayload,
	): Promise<GameInputAck> {
		const room = this.sessions.handleInput(userId, payload);
		if (!room) return { accepted: false, reason: "invalid-input" };

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
					x: object.x,
					y: object.y,
					vx: Number(payload.payload?.vx ?? 0),
					vy: Number(payload.payload?.vy ?? 0),
					power: object.power,
				};
				this.replays.recordEvent(
					room,
					"game:throw",
					throwEvent as unknown as Record<string, unknown>,
				);
			}
			// Temple Curling clients render the authoritative launch projection;
			// the throw record remains replay-only.
			this.emitPhysicsState(room.matchId);
			return { accepted: true };
		}

		if (
			payload.action === "release" &&
			room.gameId === "bamboo-bash" &&
			"roundNumber" in room.state
		) {
			const player = room.players.find(
				(candidate) => candidate.user.id === userId,
			);
			if (player) {
				const state = room.state as BambooBashSnapshot;
				const ball =
					"balls" in room.state
						? room.state.balls.find(
								(candidate) => candidate.side === player.side,
							)
						: null;
				const throwEvent: BambooBashThrowEvent = {
					matchId: room.matchId,
					roundNumber: state.roundNumber,
					side: player.side,
					x: ball?.x ?? 0,
					y: ball?.y ?? 0,
					vx: Number(payload.payload?.vx ?? 0),
					vy: Number(payload.payload?.vy ?? 0),
					power: state.lastPowerBySide[player.side] ?? "none",
				};
				this.replays.recordEvent(
					room,
					"game:bamboo-throw",
					throwEvent as unknown as Record<string, unknown>,
				);
			}
			// Bamboo Bash clients render the authoritative launch projection directly;
			// the lifecycle snapshot is reserved for round and match transitions.
			this.emitPhysicsState(room.matchId);
			return { accepted: true };
		}

		if (
			payload.action === "bamboo:power-pickup" &&
			room.gameId === "bamboo-bash" &&
			"roundNumber" in room.state
		) {
			const player = room.players.find(
				(candidate) => candidate.user.id === userId,
			);
			const pickupId = Math.floor(Number(payload.payload?.pickupId));
			const state = room.state as BambooBashSnapshot;
			const wasAccepted =
				Number.isFinite(pickupId) &&
				state.lastPowerPickupIdBySide[player?.side ?? -1] === pickupId;
			if (player && wasAccepted) {
				this.server.to(room.matchId).emit("game:bamboo-power-pickup", {
					matchId: room.matchId,
					roundNumber: state.roundNumber,
					side: player.side,
					x: Number(payload.payload?.x ?? 0),
					y: Number(payload.payload?.y ?? 0),
					vx: Number(payload.payload?.vx ?? 0),
					vy: Number(payload.payload?.vy ?? 0),
					power: state.lastPowerBySide[player.side] ?? "none",
				});
			}
			this.emitState(room.matchId);
			return { accepted: true };
		}

		if (
			payload.action === "release" &&
			room.gameId === "kame-knock" &&
			"roundNumber" in room.state &&
			"turnNumber" in room.state
		) {
			const player = room.players.find(
				(candidate) => candidate.user.id === userId,
			);
			if (player) {
				const ball =
					"balls" in room.state
						? room.state.balls.find(
								(candidate) => candidate.side === player.side,
							)
						: null;
				const power = ball?.power ?? "none";
				const throwEvent: KameKnockThrowEvent = {
					matchId: room.matchId,
					roundNumber: room.state.roundNumber,
					turnNumber: room.state.turnNumber,
					side: player.side,
					x: ball?.x ?? 0,
					y: ball?.y ?? 0,
					vx: Number(payload.payload?.vx ?? 0),
					vy: Number(payload.payload?.vy ?? 0),
					power,
				};
				this.replays.recordEvent(
					room,
					"game:kame-throw",
					throwEvent as unknown as Record<string, unknown>,
				);
			}
			// Kame Knock clients render the authoritative launch projection; throw
			// events are retained only in the replay log.
			this.emitPhysicsState(room.matchId);
			return { accepted: true };
		}

		if (
			payload.action === "release" &&
			room.gameId === "bell-clash" &&
			"roundNumber" in room.state &&
			"shotCounts" in room.state
		) {
			const player = room.players.find(
				(candidate) => candidate.user.id === userId,
			);
			if (player) {
				const ball =
					"balls" in room.state
						? room.state.balls.find(
								(candidate) => candidate.side === player.side,
							)
						: null;
				this.replays.recordEvent(room, "game:bell-throw", {
					matchId: room.matchId,
					roundNumber: room.state.roundNumber,
					shotNumber: room.state.shotCounts[player.side] ?? 0,
					side: player.side,
					x: ball?.x ?? 0,
					y: ball?.y ?? 0,
					vx: Number(payload.payload?.vx ?? 0),
					vy: Number(payload.payload?.vy ?? 0),
					power: ball?.power ?? "none",
				} satisfies BellClashThrowEvent);
			}
			// Authoritative arena clients render this projection rather than predicting
			// a flight locally, including the first frame after launch.
			this.emitPhysicsState(room.matchId);
			return { accepted: true };
		}

		this.emitState(room.matchId);
		await this.sessions.finishIfEnded(room);
		if (room.status === "finished" || room.status === "abandoned") {
			this.syncRoomPresence(room);
			this.server.to(room.matchId).emit("game:end", room.state);
		}
		return { accepted: true };
	}

	@SubscribeMessage("game:physics-request")
	onPhysicsRequest(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { matchId?: string },
	): Record<string, unknown> | null {
		const user = this.resolveSocketUser(socket);
		const room = payload?.matchId ? this.rooms.getRoom(payload.matchId) : null;
		if (!user || !room?.physicsState) return null;
		// R4: a full physics projection is serialised per call; throttle it (only
		// needed at join/rejoin).
		if (!this.allowPhysicsRequest(user.id)) return null;
		const isPlayer = room.players.some((player) => player.user.id === user.id);
		if (!isPlayer && !room.spectators.has(socket.id)) return null;
		return this.publicPhysicsState(room);
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
		if (room.physicsState)
			socket.emit("game:physics-state", this.publicPhysicsState(room));
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
			socket.emit("lobby:error", {
				message: "Guests cannot create lobbies",
			});
			return;
		}
		try {
			const lobby = this.privateLobbies.createLobby(
				socket.id,
				user,
				payload.gameId,
				payload.shellSelection ?? [],
				(expired) => this.emitLobbyExpired(expired),
			);
			socket.emit("lobby:created", {
				lobbyId: lobby.lobbyId,
				gameId: lobby.gameId,
				expiresAt: lobby.createdAt + 2 * 60 * 1_000,
			});
		} catch (err) {
			socket.emit("lobby:error", {
				message:
					err instanceof Error
						? err.message
						: "Failed to create lobby",
			});
		}
	}

	@SubscribeMessage("lobby:create-pin")
	async onLobbyCreatePin(
		@ConnectedSocket() socket: Socket,
		@MessageBody()
		payload: {
			gameId: string;
			playerCount?: number;
			powerupsEnabled?: boolean;
			shellSelection?: string[];
		},
	): Promise<void> {
		const user = socket.data.user as SocketUser;
		if (user.isGuest) {
			socket.emit("lobby:error", {
				message: "Guests cannot create lobbies",
			});
			return;
		}
		try {
			const lobby = this.privateLobbies.createPinLobby(
				socket.id,
				user,
				payload.gameId,
				payload.playerCount ?? 2,
				payload.powerupsEnabled ?? false,
				payload.shellSelection ?? [],
				(expired) => this.emitLobbyExpired(expired),
			);
			const expiresAt = lobby.createdAt + 2 * 60 * 1_000;
			socket.emit("lobby:created-pin", {
				lobbyId: lobby.lobbyId,
				pin: lobby.pin,
				gameId: lobby.gameId,
				playerCount: lobby.playerCount,
				joinedCount: lobby.participants.length,
				expiresAt,
				replayEnabled: lobby.replayEnabled,
				replayDisabledReason: lobby.replayDisabledReason,
			});
			this.emitPinLobbyWaiting(lobby);
		} catch (err) {
			socket.emit("lobby:error", {
				message:
					err instanceof Error
						? err.message
						: "Failed to create lobby",
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

		if (!lobby || lobby.kind !== "invite" || lobby.host.id !== user.id) {
			socket.emit("lobby:error", { message: "Lobby not found" });
			return;
		}
		if (this.rooms.hasActiveRoom(payload.inviteeUserId)) {
			socket.emit("lobby:error", {
				message: "That player is already in a match",
			});
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
			socket.emit("lobby:error", {
				message: "You can only invite friends",
			});
			return;
		}

		this.privateLobbies.setInvitee(payload.lobbyId, payload.inviteeUserId);

		const expiresAt = lobby.createdAt + 2 * 60 * 1_000;
		this.emitToUser(payload.inviteeUserId, "lobby:invited", {
			lobbyId: lobby.lobbyId,
			fromUserId: user.id,
			fromUsername: user.username,
			gameId: lobby.gameId,
			expiresAt,
		});
		socket.emit("lobby:invite-sent", {
			inviteeUserId: payload.inviteeUserId,
		});
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
				socket.emit("lobby:error", {
					message: "Lobby no longer exists",
				});
				return;
			}

			await this.launchPrivateMatch(result);
		} catch (err) {
			socket.emit("lobby:error", {
				message:
					err instanceof Error ? err.message : "Failed to join lobby",
			});
		}
	}

	@SubscribeMessage("lobby:join-pin")
	async onLobbyJoinPin(
		@ConnectedSocket() socket: Socket,
		@MessageBody()
		payload: { pin: string; gameId: string; shellSelection?: string[] },
	): Promise<void> {
		const user = socket.data.user as SocketUser;
		try {
			const result = await this.privateLobbies.joinPinLobby(
				payload.pin,
				payload.gameId,
				socket.id,
				user,
				payload.shellSelection ?? [],
			);
			if (!result) {
				socket.emit("lobby:error", {
					message: PRIVATE_LOBBY_NOT_FOUND_MESSAGE,
				});
				return;
			}
			if (result.matched === false) {
				this.emitPinLobbyWaiting(result.lobby);
				return;
			}
			await this.launchPrivateMatch(result);
		} catch (err) {
			socket.emit("lobby:error", {
				message:
					err instanceof Error
						? err.message
						: "Failed to join private room",
			});
		}
	}

	@SubscribeMessage("lobby:spectate-pin")
	onLobbySpectatePin(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { pin: string; gameId: string },
	): void {
		const lobby = this.privateLobbies.getLobbyByPin(payload.pin);
		if (lobby) {
			if (lobby.gameId !== payload.gameId) {
				socket.emit("lobby:error", {
					message: PRIVATE_LOBBY_NOT_FOUND_MESSAGE,
				});
				return;
			}
			socket.emit("lobby:error", {
				message: "Private match has not started yet",
			});
			return;
		}

		const started = this.privateLobbies.getStartedMatchByPin(payload.pin);
		if (started && started.gameId !== payload.gameId) {
			socket.emit("lobby:error", {
				message: PRIVATE_LOBBY_NOT_FOUND_MESSAGE,
			});
			return;
		}
		const user = socket.data.user as SocketUser;
		const room = started
			? this.rooms.addSpectator(started.matchId, socket.id, user)
			: null;
		if (!started || !room) {
			socket.emit("lobby:error", {
				message: PRIVATE_LOBBY_NOT_FOUND_MESSAGE,
			});
			return;
		}

		socket.join(room.matchId);
		socket.emit("lobby:spectating", {
			matchId: room.matchId,
			gameId: room.gameId,
			snapshot: room.state,
			physicsState: room.physicsState
				? this.publicPhysicsState(room)
				: undefined,
		});
		socket.emit("game:state", room.state);
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
		this.emitToUser(lobby.host.id, "lobby:declined", {
			lobbyId: payload.lobbyId,
		});
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
		if (cancelled) {
			for (const participant of cancelled.participants) {
				this.emitToUser(participant.user.id, "lobby:cancelled", {
					lobbyId: payload.lobbyId,
				});
			}
		}
		if (cancelled?.pendingInviteeId) {
			this.emitToUser(cancelled.pendingInviteeId, "lobby:cancelled", {
				lobbyId: payload.lobbyId,
			});
		}
	}

	/** Mark a single notification as read for the authenticated user. */
	@SubscribeMessage("notification:read")
	async onNotificationRead(
		@ConnectedSocket() socket: Socket,
		@MessageBody() data: { notificationId?: number },
	): Promise<void> {
		const user = socket.data.user as
			| { id: number; isGuest: boolean }
			| undefined;
		if (!user || user.isGuest) return;
		// Bug Audit M2: TypeORM 0.3 silently drops `undefined` where-values, so
		// an unvalidated `{}` payload would otherwise match the caller's first
		// notification and stamp it read, and a non-numeric value would 500.
		// Reject anything that isn't a real integer id before touching the DB.
		if (!Number.isInteger(data?.notificationId)) return;
		await this.notificationsService
			.markRead(user.id, data.notificationId as number)
			.catch(() => undefined);
	}

	/** Mark all unread notifications as read for the authenticated user. */
	@SubscribeMessage("notification:read-all")
	async onNotificationReadAll(
		@ConnectedSocket() socket: Socket,
	): Promise<void> {
		const user = socket.data.user as
			| { id: number; isGuest: boolean }
			| undefined;
		if (!user || user.isGuest) return;
		await this.notificationsService
			.markAllRead(user.id)
			.catch(() => undefined);
	}

	// ── Chat handlers ─────────────────────────────────────────────────────────
	//
	// Thin glue over ChatService: guard on the authenticated socket user, call
	// the service, then broadcast the returned MessageView into the
	// conversation's room. The service already enforces membership / friend /
	// length rules and throws on rejection, which we surface to the sender as a
	// `chat:error` rather than letting it become an unhandled socket error.
	// The REST send paths broadcast via ChatService.broadcastMessage instead.

	/** Send a text message to a conversation. */
	@SubscribeMessage("chat:send")
	async onChatSend(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { conversationId: number; body: string },
	): Promise<void> {
		const user = socket.data.user as SocketUser | undefined;
		if (!user) return;
		if (!this.allowChatSend(user.id)) {
			socket.emit("chat:error", {
				message: "You're sending messages too fast.",
			});
			return;
		}
		try {
			const view = await this.chatService.sendMessage(
				payload.conversationId,
				user.id,
				payload.body,
			);
			this.server
				.to(chatRoomName(payload.conversationId))
				.emit("chat:message", view);
		} catch (err) {
			socket.emit("chat:error", {
				message:
					err instanceof Error
						? err.message
						: "Failed to send message",
			});
		}
	}

	/** Send a gif message (client supplies an opaque slug; server resolves it). */
	@SubscribeMessage("chat:send-gif")
	async onChatSendGif(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { conversationId: number; slug: string },
	): Promise<void> {
		const user = socket.data.user as SocketUser | undefined;
		if (!user) return;
		if (!this.allowChatSend(user.id)) {
			socket.emit("chat:error", {
				message: "You're sending messages too fast.",
			});
			return;
		}
		try {
			const view = await this.chatService.sendGifMessage(
				payload.conversationId,
				user.id,
				payload.slug,
			);
			this.server
				.to(chatRoomName(payload.conversationId))
				.emit("chat:message", view);
		} catch (err) {
			socket.emit("chat:error", {
				message:
					err instanceof Error ? err.message : "Failed to send gif",
			});
		}
	}

	/** Move the caller's read cursor for a conversation to now. */
	@SubscribeMessage("chat:read")
	async onChatRead(
		@ConnectedSocket() socket: Socket,
		@MessageBody() payload: { conversationId: number },
	): Promise<void> {
		const user = socket.data.user as SocketUser | undefined;
		if (!user) return;
		await this.chatService
			.markRead(payload.conversationId, user.id)
			.catch(() => undefined);
	}

	/**
	 * Join a socket into the Socket.IO room of every conversation the user
	 * belongs to, so live `chat:message` broadcasts reach it immediately.
	 * Non-fatal: on failure the socket simply won't receive live chat until its
	 * next reconnect. Invoked on connect (see handleConnection).
	 */
	private async joinChatRooms(socket: Socket, userId: number): Promise<void> {
		try {
			const conversations =
				await this.chatService.listConversations(userId);
			for (const conversation of conversations) {
				socket.join(chatRoomName(conversation.id));
			}
		} catch {
			// Non-fatal — no live chat rooms joined this connect.
		}
	}

	/**
	 * Whether a socket id is still connected to this gateway (R1). Used by
	 * `RoomService.reconnect` to decide if a seat is genuinely vacant before a
	 * (re)connecting socket may take it over. Defensive against a partially
	 * mocked/torn-down server in tests.
	 */
	private isSocketLive(socketId: string): boolean {
		return this.server?.sockets?.sockets?.has(socketId) ?? false;
	}

	private emitState(matchId: string): void {
		const room = this.rooms.getRoom(matchId);
		if (room) {
			this.syncRoomPresence(room);
			this.replays.captureFrame(room);
			this.server.to(matchId).emit("game:state", room.state);
			if (room.status === "finished" || room.status === "abandoned")
				this.lastBroadcastLifecycleSeq.delete(matchId);
			else this.lastBroadcastLifecycleSeq.set(matchId, room.state.seq);
		}
	}

	private emitPhysicsState(matchId: string): void {
		const room = this.rooms.getRoom(matchId);
		if (!room?.physicsState) return;
		this.server
			.to(matchId)
			.emit("game:physics-state", this.publicPhysicsState(room));
		// Do NOT force a keyframe here. The 30 Hz logical sampler
		// (ArenaSimulationService → captureReplayFrame) already captures motion on a
		// single logical time base, and this unforced call is de-duplicated by the
		// 50 ms sample throttle. Forcing a keyframe on every broadcast produced a full
		// deep-clone ~30 times per second per room (R3).
		this.replays.captureFrame(room);
		if (this.lastBroadcastLifecycleSeq.get(matchId) !== room.state.seq)
			this.emitState(matchId);
		if (
			room.status === "finished" &&
			!this.finishingMatchIds.has(matchId)
		) {
			this.finishingMatchIds.add(matchId);
			void this.finishAuthoritativeMatch(room, 0);
		}
	}

	private async finishAuthoritativeMatch(
		room: MatchRoom,
		attempt: number,
	): Promise<void> {
		try {
			await this.sessions.finishIfEnded(room);
			this.syncRoomPresence(room);
			this.server.to(room.matchId).emit("game:end", room.state);
			this.finishingMatchIds.delete(room.matchId);
			this.lastBroadcastLifecycleSeq.delete(room.matchId);
		} catch (error) {
			if (attempt < FINISH_PERSIST_MAX_RETRIES) {
				setTimeout(
					() => void this.finishAuthoritativeMatch(room, attempt + 1),
					FINISH_PERSIST_RETRY_BASE_MS * (attempt + 1),
				);
				return;
			}
			this.finishingMatchIds.delete(room.matchId);
			this.logger.error(
				`Failed to persist authoritative match ${room.matchId}`,
				error,
			);
		}
	}

	private publicPhysicsState(room: MatchRoom): Record<string, unknown> {
		const physics = room.physicsState;
		if (!physics) return {};
		const projection: Record<string, unknown> = {
			matchId: physics.matchId,
			physicsSeq: physics.physicsSeq,
			serverTime: physics.serverTime,
			// Keep the public transport contract independent from physics internals.
			// In particular, Curling's per-ball trail must never be sent at 30 Hz.
			entities: physics.entities.map((entity) => ({
				id: entity.id,
				ownerSide: entity.ownerSide,
				primary: entity.primary,
				x: entity.x,
				y: entity.y,
				vx: entity.vx,
				vy: entity.vy,
				radius: entity.radius,
				power: entity.power,
				stopped: entity.stopped,
				alpha: entity.alpha,
			})),
			pickups: physics.pickups,
			scoreEvents: physics.scoreEvents,
			pickupEvents: physics.pickupEvents ?? [],
			impactEvents: physics.impactEvents ?? [],
		};
		if (room.state.gameId === "bamboo-bash") {
			const state = room.state as BambooBashSnapshot;
			projection.bamboos = state.bamboos;
			projection.liveRoundScores = state.liveRoundScores;
		}
		if (room.state.gameId === "bell-clash") {
			const state = room.state as BellClashSnapshot;
			projection.liveRoundScores = state.liveRoundScores;
		}
		if (room.state.gameId === "kame-knock") {
			const state = room.state as KameKnockSnapshot;
			projection.targets = state.targets;
			projection.score = state.score;
			projection.roundScores = state.roundScores;
			projection.currentTurn = state.currentTurn;
			projection.turnNumber = state.turnNumber;
			projection.roundNumber = state.roundNumber;
		}
		return projection;
	}

	/** Emit an event to every connected socket of a user (all tabs/devices). */
	private emitToUser(userId: number, event: string, payload: unknown): void {
		for (const sid of this.presence.getSocketIds(userId)) {
			this.server.to(sid).emit(event, payload);
		}
	}
	private emitLobbyExpired(lobby: PrivateLobby): void {
		for (const participant of lobby.participants) {
			this.emitToUser(participant.user.id, "lobby:expired", {
				lobbyId: lobby.lobbyId,
			});
		}
		if (lobby.pendingInviteeId) {
			this.emitToUser(lobby.pendingInviteeId, "lobby:cancelled", {
				lobbyId: lobby.lobbyId,
			});
		}
	}

	private emitPinLobbyWaiting(lobby: PrivateLobby): void {
		const payload = {
			lobbyId: lobby.lobbyId,
			pin: lobby.pin,
			gameId: lobby.gameId,
			playerCount: lobby.playerCount,
			joinedCount: lobby.participants.length,
			expiresAt: lobby.createdAt + 2 * 60 * 1_000,
			replayEnabled: lobby.replayEnabled,
			replayDisabledReason: lobby.replayDisabledReason,
		};
		for (const participant of lobby.participants) {
			this.emitToUser(participant.user.id, "lobby:waiting", payload);
		}
	}

	private async launchPrivateMatch(result: LobbyJoinResult): Promise<void> {
		await this.startServerInitiatedMatch(result.room, "lobby:matched");
	}

	/**
	 * Launch a match that was created server-side (private lobby, rematch, or
	 * any future orchestrator) instead of through the public queue's
	 * queue:join → room:ready handshake: join every player's sockets into the
	 * match room (leaving `leaveMatchId` first if given), force-ready everyone,
	 * start the session, broadcast the fresh state, and notify each player via
	 * `eventName` with the standard {matchId, side, gameId, snapshot} payload.
	 *
	 * PUBLIC because it is the platform's single server-initiated launch rail:
	 * the Tournament module (SPEC-015 "Match Creation") starts its minigames
	 * through it with the `tournament:minigame-start` notification instead of
	 * duplicating this socket-join/force-ready/start sequence.
	 */
	async startServerInitiatedMatch(
		room: MatchRoom,
		eventName: "lobby:matched" | "match:rematch-start" | "tournament:minigame-start",
		leaveMatchId?: string,
	): Promise<MatchRoom> {
		this.syncRoomPresence(room);
		for (const player of room.players) {
			for (const sid of this.presence.getSocketIds(player.user.id)) {
				const s = this.server.sockets.sockets.get(sid);
				if (s) {
					if (leaveMatchId) s.leave(leaveMatchId);
					s.join(room.matchId);
				}
			}
			this.rooms.setReady(room.matchId, player.user.id);
		}
		const started = await this.sessions.startIfReady(room.matchId);
		const activeRoom = started ?? room;
		this.emitState(activeRoom.matchId);

		for (const player of activeRoom.players) {
			this.emitToUser(player.user.id, eventName, {
				matchId: activeRoom.matchId,
				side: player.side,
				gameId: activeRoom.gameId,
				tournamentId: activeRoom.tournamentId,
				snapshot: activeRoom.state,
				physicsState: activeRoom.physicsState
					? this.publicPhysicsState(activeRoom)
					: undefined,
				replayEnabled: activeRoom.replayEnabled,
				replayDisabledReason: activeRoom.replayDisabledReason,
			});
		}
		return activeRoom;
	}

	private emitRematchStatus(room: MatchRoom): void {
		const readyUserIds = [
			...(room.rematchReadyUserIds ?? new Set<number>()),
		];
		const leftUserIds = [...(room.rematchLeftUserIds ?? new Set<number>())];
		const waitingUserIds = room.players
			.map((player) => player.user.id)
			.filter(
				(userId) =>
					!readyUserIds.includes(userId) &&
					!leftUserIds.includes(userId),
			);
		this.server.to(room.matchId).emit("match:rematch-status", {
			matchId: room.matchId,
			readyUserIds,
			leftUserIds,
			waitingUserIds,
		});
	}

	private async startRematchIfReady(room: MatchRoom): Promise<void> {
		if (room.rematchStartedMatchId) return;
		const ready = room.rematchReadyUserIds ?? new Set<number>();
		const left = room.rematchLeftUserIds ?? new Set<number>();
		const remaining = room.players.filter(
			(player) => !left.has(player.user.id),
		);
		if (remaining.length < 2) {
			this.server.to(room.matchId).emit("match:rematch-cancelled", {
				matchId: room.matchId,
				reason: "Not enough players for a rematch.",
			});
			return;
		}
		if (!remaining.every((player) => ready.has(player.user.id))) return;

		const rematch = await this.matchmaking.createRematch(room, remaining);
		room.rematchStartedMatchId = rematch.matchId;
		await this.startServerInitiatedMatch(
			rematch,
			"match:rematch-start",
			room.matchId,
		);
		// The superseded room is no longer reachable by any player (they are now
		// mapped to the rematch), so evict it immediately rather than waiting for
		// the TTL sweep — this is the primary bound on retained-room memory (R2).
		this.rooms.deleteRoom(room.matchId);
	}

	/**
	 * Keep PresenceService's in-game markers in sync with a room's lifecycle.
	 * Players in an active/pending room are marked in-game; once the room is
	 * finished or abandoned the marker is cleared so they show as plain "online".
	 */
	private syncRoomPresence(room: MatchRoom): void {
		const active = room.status === "active" || room.status === "pending";
		for (const player of room.players) {
			const before = this.presence.getStatus(player.user.id);
			if (active) {
				this.presence.setInGame(player.user.id, room.gameId);
			} else {
				this.presence.clearInGame(player.user.id);
			}
			// Only fan out on an actual coarse-status edge (online↔in-game) —
			// syncRoomPresence can be called repeatedly for an unchanged room
			// (Decision 3).
			if (this.presence.getStatus(player.user.id) !== before) {
				void this.broadcastPresence(player.user.id);
			}
		}
	}

	private emitUserMatchStatus(socket: Socket): void {
		const user = this.resolveSocketUser(socket);
		if (!user) {
			socket.emit("match:status", { inMatch: false });
			return;
		}
		const status = this.rooms.getUserMatchStatus(user.id);
		if (!status) {
			socket.emit("match:status", { inMatch: false });
			return;
		}

		socket.emit("match:status", {
			inMatch: true,
			matchId: status.room.matchId,
			gameId: status.room.gameId,
			tournamentId: status.room.tournamentId,
			phase: status.room.status,
			side: status.side,
			reconnectExpiresAt: status.reconnectExpiresAt,
			snapshot: status.room.state,
			physicsState: status.room.physicsState
				? this.publicPhysicsState(status.room)
				: undefined,
		});
	}

	private async finishAbandonedMatch(
		room: MatchRoom,
		player: RoomPlayer,
	): Promise<void> {
		// Capture the leaver's socket before `abandon` may rebind the seat to a
		// bot, so we can still refresh their (now match-free) status.
		const leaverSocketId = player.socketId;
		const result = await this.sessions.abandon(room, player);
		if (!result) return;
		if (result.outcome === "continued") {
			// The match plays on with a CPU stand-in (P5): broadcast the updated
			// lifecycle state, and free the leaver's own client.
			this.emitState(result.room.matchId);
			const leaverSocket = this.server.sockets.sockets.get(leaverSocketId);
			if (leaverSocket) this.emitUserMatchStatus(leaverSocket);
			return;
		}
		const finished = result.room;
		this.emitState(finished.matchId);
		this.server.to(finished.matchId).emit("game:end", finished.state);
		for (const roomPlayer of finished.players) {
			const playerSocket = this.server.sockets.sockets.get(
				roomPlayer.socketId,
			);
			if (playerSocket) this.emitUserMatchStatus(playerSocket);
		}
	}

	/**
	 * Force-tear-down an in-flight match with no winner, e.g. a tournament
	 * minigame whose tournament was cancelled because no real players remain.
	 * Prevents zombie matches lingering in `active` until a watchdog. Public so
	 * server-side orchestrators (the tournament minigame adapter) can call it;
	 * no-op if the match is already gone or resolved.
	 */
	async abortMatch(matchId: string, reason: string): Promise<void> {
		const room = this.rooms.getRoom(matchId);
		if (
			!room ||
			room.status === "finished" ||
			room.status === "abandoned"
		) {
			return;
		}
		this.logger.log(`aborting match ${matchId}: ${reason}`);
		const finished = await this.sessions.abort(room);
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

	/**
	 * True while the match's in-memory room is still being played. Public for
	 * the tournament minigame adapter: its reconciliation watchdog extends the
	 * wait for a legitimately long match instead of cancelling the round while
	 * the players are still in the arena.
	 */
	isMatchLive(matchId: string): boolean {
		const room = this.rooms.getRoom(matchId);
		return (
			room !== null &&
			room.status !== "finished" &&
			room.status !== "abandoned"
		);
	}

	/**
	 * Hand a live seat to a CPU stand-in mid-match: a tournament player quit
	 * for good ("Leave game") while their round's minigame was in flight, so
	 * the seat plays on server-side (BotPlayerService) instead of dangling
	 * into the disconnect-forfeit path — the other seats keep their match.
	 * Public for the tournament minigame adapter; no-op if the match is gone,
	 * resolved, or the user isn't seated.
	 */
	convertSeatToBot(matchId: string, userId: number): void {
		const room = this.rooms.convertSeatToBot(matchId, userId);
		if (!room) return;
		this.logger.log(
			`seat of user ${userId} in match ${matchId} handed to a CPU stand-in`,
		);
		// The departed user's sockets stop receiving this match, and their
		// match:status flips to "no match" (the seat is no longer theirs).
		for (const sid of this.presence.getSocketIds(userId)) {
			const socket = this.server.sockets.sockets.get(sid);
			if (socket) {
				socket.leave(matchId);
				this.emitUserMatchStatus(socket);
			}
		}
		this.emitState(matchId);
	}
}
