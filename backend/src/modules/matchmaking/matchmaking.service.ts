import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ShellsService } from "../shells/shells.service";
import { Match, MatchMode } from "./entities/match.entity";
import { MatchPlayer } from "./entities/match-player.entity";
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
		@InjectRepository(Match) private readonly matchRepo: Repository<Match>,
		@InjectRepository(MatchPlayer)
		private readonly matchPlayerRepo: Repository<MatchPlayer>,
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
		const powerupsEnabled = payload.powerupsEnabled ?? true;
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

		const match = await this.matchRepo.save(
			this.matchRepo.create({ gameId, mode, status: "pending" }),
		);
		const room = this.roomService.createRoom(
			match.id,
			gameId,
			mode,
			players,
			{ powerupsEnabled: true },
		);
		await this.matchPlayerRepo.save(
			room.players.map((player) =>
				this.matchPlayerRepo.create({
					matchId: match.id,
					userId: player.user.id,
					side: player.side,
					outcome: null,
					shellSelection: player.shellSelection,
				}),
			),
		);

		return { matched: true, roomMatchId: match.id };
	}

	async createRematch(
		previousRoom: MatchRoom,
		players: RoomPlayer[],
	): Promise<MatchRoom> {
		const match = await this.matchRepo.save(
			this.matchRepo.create({
				gameId: previousRoom.gameId,
				mode: previousRoom.mode,
				status: "pending",
			}),
		);
		const room = this.roomService.createRoom(
			match.id,
			previousRoom.gameId,
			previousRoom.mode,
			players.map((player) => ({
				socketId: player.socketId,
				user: player.user,
				shellSelection: player.shellSelection,
			})),
			{ powerupsEnabled: previousRoom.state.powerupsEnabled },
		);
		await this.matchPlayerRepo.save(
			room.players.map((player) =>
				this.matchPlayerRepo.create({
					matchId: match.id,
					userId: player.user.id,
					side: player.side,
					outcome: null,
					shellSelection: player.shellSelection,
				}),
			),
		);
		return room;
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
