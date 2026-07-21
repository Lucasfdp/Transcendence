import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { MatchMode } from "./entities/match.entity";
import { GameEngineRegistry } from "./engines/game-engine.registry";
import {
	BOT_SOCKET_PREFIX,
	isBotSeat,
	MatchRoom,
	RoomPlayer,
	SocketUser,
} from "./matchmaking.types";
import { toSnapshotPlayer } from "./snapshot-player.util";

const MAX_PLAYERS = 5;

/**
 * Result of a seat (re)connection attempt (R1). `rebound` — the seat was vacant
 * and is now bound to the connecting socket. `occupied` — the seat is still held
 * by a live socket (another tab/device); nothing changed and the caller should
 * tell the new socket the match is active elsewhere rather than take it over.
 */
export interface ReconnectResult {
	room: MatchRoom;
	outcome: "rebound" | "occupied";
}

/**
 * How long a finished/abandoned room is retained in memory before the sweep
 * evicts it (R2). Long enough for the rematch/end-screen flow, short enough
 * that a day of play cannot accumulate every match ever played.
 */
const FINISHED_ROOM_TTL_MS = 10 * 60 * 1000;
/** How often the finished-room sweep runs. */
const ROOM_SWEEP_INTERVAL_MS = 60 * 1000;

@Injectable()
export class RoomService implements OnModuleInit, OnModuleDestroy {
	private readonly rooms = new Map<string, MatchRoom>();
	private readonly userRoom = new Map<number, string>();
	/**
	 * socketId → matchId indexes (R2) so disconnect/spectator lookups are O(1)
	 * instead of scanning every room × player on every socket drop. Seats and
	 * spectators are indexed separately because a single socket is only ever one
	 * or the other for a given room.
	 */
	private readonly seatSocketRoom = new Map<string, string>();
	private readonly spectatorSocketRoom = new Map<string, string>();
	private sweepTimer: NodeJS.Timeout | null = null;

	constructor(private readonly engines: GameEngineRegistry) {}

	onModuleInit(): void {
		this.sweepTimer = setInterval(
			() => this.sweepFinishedRooms(),
			ROOM_SWEEP_INTERVAL_MS,
		);
		// Never keep the process alive solely for the sweep (shutdown, tests).
		this.sweepTimer.unref?.();
	}

	onModuleDestroy(): void {
		if (this.sweepTimer) clearInterval(this.sweepTimer);
		this.sweepTimer = null;
	}

	/**
	 * Point a seat's socket id at its room, replacing any previous mapping for
	 * that seat. Centralises index upkeep for every place a seat's socket id
	 * changes (create, reconnect, away, bot takeover).
	 */
	private bindSeatSocket(
		matchId: string,
		previousSocketId: string | null,
		socketId: string,
	): void {
		if (previousSocketId && previousSocketId !== socketId)
			this.seatSocketRoom.delete(previousSocketId);
		this.seatSocketRoom.set(socketId, matchId);
	}

	createRoom(
		matchId: string,
		gameId: string,
		mode: MatchMode,
		players: Array<{
			socketId: string;
			user: SocketUser;
			shellSelection: string[];
		}>,
		options: { powerupsEnabled?: boolean; tournamentId?: string } = {},
	): MatchRoom {
		const roomPlayers = players
			.slice(0, MAX_PLAYERS)
			.map((player, index) => ({
				...player,
				side: index,
				ready: false,
				connected: true,
			}));
		const engine = this.engines.get(gameId);
		const powerupsEnabled = options.powerupsEnabled ?? false;

		const room: MatchRoom = {
			matchId,
			gameId,
			mode,
			tournamentId: options.tournamentId,
			status: "pending",
			createdAt: Date.now(),
			players: roomPlayers,
			enteredUserIds: new Set(),
			spectators: new Map(),
			seq: 0,
			state: engine.createInitialState(
				{
					matchId,
					gameId,
					mode,
					players,
					powerupsEnabled,
				},
				roomPlayers,
			),
			replayFrames: [],
			replayEvents: [],
			replayEnabled: !powerupsEnabled,
			replayDisabledReason: powerupsEnabled ? "powerups-enabled" : null,
			replayStartedAt: null,
			replayLastSampleAt: null,
			replayLastKeyframeAt: null,
			replayLastSnapshot: null,
		};

		this.rooms.set(matchId, room);
		for (const player of roomPlayers) {
			this.userRoom.set(player.user.id, matchId);
			this.bindSeatSocket(matchId, null, player.socketId);
		}
		return room;
	}

	getRoom(matchId: string): MatchRoom | null {
		return this.rooms.get(matchId) ?? null;
	}

	getActiveRooms(): MatchRoom[] {
		// Called from the 30 Hz arena loop and the bot driver: build the result
		// in one pass instead of spreading the whole map and filtering it.
		const active: MatchRoom[] = [];
		for (const room of this.rooms.values()) {
			if (room.status === "active") active.push(room);
		}
		return active;
	}

	getRoomForUser(userId: number): MatchRoom | null {
		const matchId = this.userRoom.get(userId);
		return matchId ? this.getRoom(matchId) : null;
	}

	hasActiveRoom(userId: number): boolean {
		const room = this.getRoomForUser(userId);
		return (
			!!room && room.status !== "finished" && room.status !== "abandoned"
		);
	}

	setReady(matchId: string, userId: number): MatchRoom | null {
		const room = this.getRoom(matchId);
		const player = room?.players.find((p) => p.user.id === userId);
		if (!room || !player) return null;
		player.ready = true;
		this.refreshSnapshotPlayers(room, true);
		return room;
	}

	/**
	 * A client's arena scene has actually mounted for this match
	 * (`game:arena-ready`) — a server-initiated launch (tournament minigame,
	 * lobby match, rematch) force-marks every seat `ready`/`connected` at
	 * creation time, well before any client has navigated in, so this is the
	 * only real signal of "the player is genuinely present." `BotPlayerService`
	 * holds CPU activity until every real seat has one (see `isBotSeat`).
	 */
	markArenaEntered(matchId: string, userId: number): MatchRoom | null {
		const room = this.getRoom(matchId);
		const player = room?.players.find((p) => p.user.id === userId);
		if (!room || !player) return null;
		room.enteredUserIds.add(userId);
		return room;
	}

	start(matchId: string): MatchRoom | null {
		const room = this.getRoom(matchId);
		if (!room) return null;
		this.engines.get(room.gameId).start(room);
		return room;
	}

	/**
	 * Rebind a user's seat to a (re)connecting socket — but only when the seat is
	 * actually vacant (R1). A second connection from the same user (another tab,
	 * a second device) must NOT hijack the seat of a socket that is still live and
	 * playing: otherwise, when that second socket later closes, `markDisconnected`
	 * would mark the actively-playing seat disconnected and arm a false forfeit.
	 *
	 * The seat is considered occupied when it is currently connected on a
	 * *different* socket that is still live. Liveness is probed via the optional
	 * `isSocketLive` predicate (the gateway passes a check against the Socket.IO
	 * server); if a genuinely dead socket never got a `markDisconnected` (a race),
	 * the seat still counts as vacant and the reconnect proceeds.
	 */
	reconnect(
		socketId: string,
		user: SocketUser,
		isSocketLive?: (socketId: string) => boolean,
	): ReconnectResult | null {
		const room = this.getRoomForUser(user.id);
		const player = room?.players.find((p) => p.user.id === user.id);
		if (!room || !player) return null;
		const heldByLiveOtherSocket =
			player.connected &&
			player.socketId !== socketId &&
			(isSocketLive?.(player.socketId) ?? true);
		if (heldByLiveOtherSocket) return { room, outcome: "occupied" };
		if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
		const previousSocketId = player.socketId;
		player.socketId = socketId;
		player.connected = true;
		player.reconnectExpiresAt = undefined;
		this.bindSeatSocket(room.matchId, previousSocketId, socketId);
		this.refreshSnapshotPlayers(room, true);
		return { room, outcome: "rebound" };
	}

	getUserMatchStatus(userId: number): {
		room: MatchRoom;
		side: number;
		reconnectExpiresAt: number | null;
	} | null {
		const room = this.getRoomForUser(userId);
		const player = room?.players.find(
			(candidate) => candidate.user.id === userId,
		);
		if (
			!room ||
			!player ||
			room.status === "finished" ||
			room.status === "abandoned"
		)
			return null;
		return {
			room,
			side: player.side,
			reconnectExpiresAt: player.reconnectExpiresAt ?? null,
		};
	}

	markDisconnected(
		socketId: string,
		onTimeout: (room: MatchRoom, player: RoomPlayer) => void,
		timeoutMs: number,
	): MatchRoom | null {
		const matchId = this.seatSocketRoom.get(socketId);
		const room = matchId ? this.rooms.get(matchId) : undefined;
		const player = room?.players.find((p) => p.socketId === socketId);
		if (
			!room ||
			!player ||
			room.status === "finished" ||
			room.status === "abandoned"
		)
			return null;

		player.connected = false;
		if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
		player.reconnectExpiresAt = Date.now() + timeoutMs;
		player.disconnectTimer = setTimeout(
			() => onTimeout(room, player),
			timeoutMs,
		);
		this.refreshSnapshotPlayers(room, true);
		return room;
	}

	markAway(
		userId: number,
		socketId: string,
		onTimeout: (room: MatchRoom, player: RoomPlayer) => void,
		timeoutMs: number,
	): MatchRoom | null {
		const room = this.getRoomForUser(userId);
		const player = room?.players.find(
			(candidate) => candidate.user.id === userId,
		);
		if (
			!room ||
			!player ||
			room.status === "finished" ||
			room.status === "abandoned"
		)
			return null;

		const previousSocketId = player.socketId;
		player.socketId = socketId;
		player.connected = false;
		this.bindSeatSocket(room.matchId, previousSocketId, socketId);
		if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
		player.reconnectExpiresAt = Date.now() + timeoutMs;
		player.disconnectTimer = setTimeout(
			() => onTimeout(room, player),
			timeoutMs,
		);
		this.refreshSnapshotPlayers(room, true);
		return room;
	}

	/**
	 * Hand a live seat to a CPU stand-in mid-match (a tournament player who
	 * quit for good): the seat keeps the real user's identity so the outcome
	 * stays credited to their account, but is played server-side from now on
	 * (`bot:` socket → BotPlayerService sweep). The user is unmapped from the
	 * room — `match:status` shows no match, `reconnect` can never hand the
	 * seat back, and they are free to queue elsewhere.
	 */
	convertSeatToBot(matchId: string, userId: number): MatchRoom | null {
		const room = this.getRoom(matchId);
		const player = room?.players.find(
			(candidate) => candidate.user.id === userId,
		);
		if (
			!room ||
			!player ||
			room.status === "finished" ||
			room.status === "abandoned"
		)
			return null;
		if (!isBotSeat(player)) {
			if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
			player.disconnectTimer = undefined;
			const previousSocketId = player.socketId;
			player.socketId = `${BOT_SOCKET_PREFIX}${userId}`;
			player.connected = true;
			player.reconnectExpiresAt = undefined;
			this.bindSeatSocket(room.matchId, previousSocketId, player.socketId);
		}
		this.userRoom.delete(userId);
		this.refreshSnapshotPlayers(room, true);
		return room;
	}

	addSpectator(
		matchId: string,
		socketId: string,
		user: SocketUser,
	): MatchRoom | null {
		const room = this.getRoom(matchId);
		if (!room || room.status === "finished" || room.status === "abandoned")
			return null;
		room.spectators.set(socketId, user);
		this.spectatorSocketRoom.set(socketId, room.matchId);
		return room;
	}

	removeSpectator(socketId: string): MatchRoom | null {
		const matchId = this.spectatorSocketRoom.get(socketId);
		if (!matchId) return null;
		this.spectatorSocketRoom.delete(socketId);
		const room = this.rooms.get(matchId);
		return room?.spectators.delete(socketId) ? room : null;
	}

	finish(
		matchId: string,
		winnerSide: number | null,
		abandoned = false,
	): MatchRoom | null {
		const room = this.getRoom(matchId);
		if (!room) return null;
		room.status = abandoned ? "abandoned" : "finished";
		room.state.phase = abandoned ? "abandoned" : "finished";
		room.state.winnerSide = winnerSide;
		room.state.seq = ++room.seq;
		room.finishedAt = Date.now();
		this.refreshSnapshotPlayers(room);
		for (const player of room.players) {
			if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
			this.userRoom.delete(player.user.id);
		}
		return room;
	}

	/**
	 * Evict a room and purge every index that referenced it (R2). Idempotent.
	 * Called when a rematch supersedes the room and by the finished-room sweep;
	 * any pending disconnect timers are cleared so they cannot fire against an
	 * evicted room.
	 */
	deleteRoom(matchId: string): boolean {
		const room = this.rooms.get(matchId);
		if (!room) return false;
		for (const player of room.players) {
			if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
			this.seatSocketRoom.delete(player.socketId);
			if (this.userRoom.get(player.user.id) === matchId)
				this.userRoom.delete(player.user.id);
		}
		for (const socketId of room.spectators.keys())
			this.spectatorSocketRoom.delete(socketId);
		return this.rooms.delete(matchId);
	}

	/**
	 * Drop finished/abandoned rooms whose retention window has elapsed (R2),
	 * bounding memory so long-running processes do not accumulate every match
	 * ever played. Rooms superseded by a rematch are evicted eagerly elsewhere;
	 * this is the backstop for everything else.
	 */
	/**
	 * Rooms still `pending` past `maxAgeMs` (R5). A matched player whose socket
	 * died in the window between the queue splice and room creation never sends
	 * `room:ready`, so the room can hang in `pending` forever and lock every
	 * seated user out of re-queueing. The gateway aborts these as a backstop.
	 */
	getStalePendingRooms(maxAgeMs: number, now: number = Date.now()): MatchRoom[] {
		return [...this.rooms.values()].filter(
			(room) =>
				room.status === "pending" &&
				room.createdAt !== undefined &&
				now - room.createdAt >= maxAgeMs,
		);
	}

	sweepFinishedRooms(now: number = Date.now()): number {
		let evicted = 0;
		for (const [matchId, room] of this.rooms) {
			const terminal =
				room.status === "finished" || room.status === "abandoned";
			if (
				terminal &&
				room.finishedAt !== undefined &&
				now - room.finishedAt >= FINISHED_ROOM_TTL_MS
			) {
				this.deleteRoom(matchId);
				evicted += 1;
			}
		}
		return evicted;
	}

	private refreshSnapshotPlayers(room: MatchRoom, bumpSeq = false): void {
		room.state.players = room.players.map(toSnapshotPlayer);
		room.state.seq = bumpSeq ? ++room.seq : room.seq;
	}
}
