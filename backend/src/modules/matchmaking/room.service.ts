import { Injectable } from "@nestjs/common";
import { MatchMode } from "./entities/match.entity";
import { GameEngineRegistry } from "./engines/game-engine.registry";
import { MatchRoom, RoomPlayer, SocketUser } from "./matchmaking.types";

const MAX_PLAYERS = 5;

@Injectable()
export class RoomService {
	private readonly rooms = new Map<string, MatchRoom>();
	private readonly userRoom = new Map<number, string>();

	constructor(private readonly engines: GameEngineRegistry) {}

	createRoom(
		matchId: string,
		gameId: string,
		mode: MatchMode,
		players: Array<{
			socketId: string;
			user: SocketUser;
			shellSelection: string[];
		}>,
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

		const room: MatchRoom = {
			matchId,
			gameId,
			mode,
			status: "pending",
			players: roomPlayers,
			spectators: new Map(),
			seq: 0,
			state: engine.createInitialState(
				{ matchId, gameId, mode, players },
				roomPlayers,
			),
			replayFrames: [],
			replayEvents: [],
			replayLastCapturedSeq: null,
		};

		this.rooms.set(matchId, room);
		for (const player of roomPlayers)
			this.userRoom.set(player.user.id, matchId);
		return room;
	}

	getRoom(matchId: string): MatchRoom | null {
		return this.rooms.get(matchId) ?? null;
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

	start(matchId: string): MatchRoom | null {
		const room = this.getRoom(matchId);
		if (!room) return null;
		this.engines.get(room.gameId).start(room);
		return room;
	}

	reconnect(socketId: string, user: SocketUser): MatchRoom | null {
		const room = this.getRoomForUser(user.id);
		const player = room?.players.find((p) => p.user.id === user.id);
		if (!room || !player) return null;
		if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
		player.socketId = socketId;
		player.connected = true;
		player.reconnectExpiresAt = undefined;
		this.refreshSnapshotPlayers(room, true);
		return room;
	}

	getUserMatchStatus(
		userId: number,
	): {
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
		const room = [...this.rooms.values()].find((candidate) =>
			candidate.players.some((player) => player.socketId === socketId),
		);
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

		player.socketId = socketId;
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

	addSpectator(
		matchId: string,
		socketId: string,
		user: SocketUser,
	): MatchRoom | null {
		const room = this.getRoom(matchId);
		if (!room || room.status === "finished" || room.status === "abandoned")
			return null;
		room.spectators.set(socketId, user);
		return room;
	}

	removeSpectator(socketId: string): MatchRoom | null {
		for (const room of this.rooms.values()) {
			if (room.spectators.delete(socketId)) return room;
		}
		return null;
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
		this.refreshSnapshotPlayers(room);
		for (const player of room.players) {
			if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
			this.userRoom.delete(player.user.id);
		}
		return room;
	}

	private refreshSnapshotPlayers(room: MatchRoom, bumpSeq = false): void {
		room.state.players = room.players.map((player) => ({
			side: player.side,
			userId: player.user.id,
			username: player.user.username,
			connected: player.connected,
			ready: player.ready,
			reconnectExpiresAt: player.reconnectExpiresAt ?? null,
		}));
		room.state.seq = bumpSeq ? ++room.seq : room.seq;
	}
}
