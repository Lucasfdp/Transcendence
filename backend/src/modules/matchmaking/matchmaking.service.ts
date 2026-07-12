import { BadRequestException, Injectable } from "@nestjs/common";
import { ShellsService } from "../shells/shells.service";
import { MatchMode } from "./entities/match.entity";
import { MatchFactoryService } from "./match-factory.service";
import { QueueJoinPayload, SocketUser } from "./matchmaking.types";
import type { MatchRoom, RoomPlayer } from "./matchmaking.types";
import { RoomService } from "./room.service";

interface QueueEntry {
	socketId: string;
	user: SocketUser;
	gameId: string;
	mode: MatchMode;
	playerCount: number;
	powerupsEnabled: boolean;
	shellSelection: string[];
	joinedAt: number;
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;

@Injectable()
export class MatchmakingService {
	private readonly queues = new Map<string, QueueEntry[]>();
	private readonly queuedUsers = new Map<number, string>();

	constructor(
		private readonly shellsService: ShellsService,
		private readonly roomService: RoomService,
		private readonly matchFactory: MatchFactoryService,
	) {}

	async joinQueue(
		socketId: string,
		user: SocketUser,
		payload: QueueJoinPayload,
	): Promise<{ matched: false } | { matched: true; roomMatchId: string }> {
		const gameId = payload.gameId;
		const mode = payload.mode ?? "casual";
		const playerCount = Math.max(
			MIN_PLAYERS,
			Math.min(MAX_PLAYERS, Math.floor(Number(payload.playerCount ?? 2))),
		);
		const shellSelection = payload.shellSelection ?? [];
		const powerupsEnabled = payload.powerupsEnabled ?? false;
		if (!gameId) throw new BadRequestException("gameId is required");
		if (!["casual", "ranked"].includes(mode))
			throw new BadRequestException("Invalid mode");
		if (mode === "ranked" && user.isGuest)
			throw new BadRequestException("Ranked requires a persistent user");
		if (
			this.queuedUsers.has(user.id) ||
			this.roomService.hasActiveRoom(user.id)
		) {
			throw new BadRequestException(
				"User is already queued or in an active match",
			);
		}
		if (!user.isGuest && shellSelection.length)
			await this.shellsService.validateSelection(user.id, shellSelection);

		const key = this.queueKey(gameId, mode, playerCount);
		const queue = this.queues.get(key) ?? [];
		queue.push({
			socketId,
			user,
			gameId,
			mode,
			playerCount,
			powerupsEnabled,
			shellSelection,
			joinedAt: Date.now(),
		});
		this.queues.set(key, queue);
		this.queuedUsers.set(user.id, key);

		const uniqueUserIds = new Set(queue.map((entry) => entry.user.id));
		if (queue.length < playerCount || uniqueUserIds.size < playerCount) {
			return { matched: false };
		}

		const players = queue.splice(0, playerCount);
		for (const player of players) this.queuedUsers.delete(player.user.id);
		if (!queue.length) this.queues.delete(key);

		// Each queued player may have requested a different `powerupsEnabled`
		// value; the room needs one resolved setting. The first player to join
		// the queue (players[0], since `players` was spliced off the front in
		// join order) acts as the room's effective host and decides the
		// setting for everyone matched into their queue slot (Bug Audit M1 —
		// this was previously hard-coded to `true` and silently ignored
		// every player's preference, including their own).
		const room = await this.matchFactory.createMatch({
			gameId,
			mode,
			players,
			powerupsEnabled: players[0].powerupsEnabled,
		});

		return { matched: true, roomMatchId: room.matchId };
	}

	async createRematch(
		previousRoom: MatchRoom,
		players: RoomPlayer[],
	): Promise<MatchRoom> {
		return this.matchFactory.createMatch({
			gameId: previousRoom.gameId,
			mode: previousRoom.mode,
			players: players.map((player) => ({
				socketId: player.socketId,
				user: player.user,
				shellSelection: player.shellSelection,
			})),
			powerupsEnabled: previousRoom.state.powerupsEnabled,
		});
	}

	leaveQueue(userId: number): void {
		const key = this.queuedUsers.get(userId);
		if (!key) return;
		const queue = this.queues.get(key) ?? [];
		const nextQueue = queue.filter((entry) => entry.user.id !== userId);
		if (nextQueue.length) this.queues.set(key, nextQueue);
		else this.queues.delete(key);
		this.queuedUsers.delete(userId);
	}

	removeSocket(socketId: string): void {
		for (const entry of this.queues.entries()) {
			const [key, queue] = entry;
			const removed = queue.filter(
				(candidate) => candidate.socketId === socketId,
			);
			if (!removed.length) continue;
			for (const candidate of removed)
				this.queuedUsers.delete(candidate.user.id);
			const nextQueue = queue.filter(
				(candidate) => candidate.socketId !== socketId,
			);
			if (nextQueue.length) this.queues.set(key, nextQueue);
			else this.queues.delete(key);
		}
	}

	private queueKey(
		gameId: string,
		mode: MatchMode,
		playerCount: number,
	): string {
		return `${gameId}:${mode}:${playerCount}`;
	}
}
