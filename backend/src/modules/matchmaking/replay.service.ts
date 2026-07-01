import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Match, MatchStatus } from "./entities/match.entity";
import { MatchPlayer, MatchOutcome } from "./entities/match-player.entity";
import {
	MatchReplay,
	MatchReplayEvent,
	MatchReplayFrame,
} from "./entities/match-replay.entity";
import { MatchReplaySave } from "./entities/match-replay-save.entity";
import { MatchRoom } from "./matchmaking.types";

const REPLAY_TTL_MS = 72 * 60 * 60 * 1000;
const REPLAY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MAX_SAVED_REPLAYS_PER_USER = 20;
const MAX_IMPORTED_REPLAY_FRAMES = 3_600;
const IMPORTABLE_REPLAY_GAME_IDS = new Set([
	"temple-curling",
	"bamboo-bash",
	"kame-knock",
	"bell-clash",
]);

export interface ReplayImportPlayerInput {
	side: number;
	userId: number | null;
	username: string;
}

export interface ReplayImportInput {
	gameId: string;
	mode: string;
	status: "finished" | "abandoned";
	createdAt?: string;
	finishedAt?: string | null;
	winnerSide?: number | null;
	playerNames?: string[];
	playerUserIds?: Array<number | null>;
	frames: MatchReplayFrame[];
	events?: MatchReplayEvent[];
}

export interface ReplaySummaryView {
	id: string;
	matchId: string;
	gameId: string;
	mode: string;
	status: string;
	frameCount: number;
	createdAt: string;
	finishedAt: string | null;
	expiresAt: string | null;
	winnerSide: number | null;
	playerUserIds: number[];
	playerNames: string[];
	isSavedByCurrentUser: boolean;
}

export interface ReplayDetailView extends ReplaySummaryView {
	frames: MatchReplayFrame[];
	events: MatchReplayEvent[];
}

@Injectable()
export class ReplayService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(ReplayService.name);
	private cleanupTimer: NodeJS.Timeout | null = null;

	constructor(
		private readonly dataSource: DataSource,
		@InjectRepository(MatchReplay)
		private readonly replayRepo: Repository<MatchReplay>,
		@InjectRepository(MatchReplaySave)
		private readonly replaySaveRepo: Repository<MatchReplaySave>,
	) {}

	onModuleInit(): void {
		void this.cleanupExpiredReplays();
		this.cleanupTimer = setInterval(() => {
			void this.cleanupExpiredReplays();
		}, REPLAY_CLEANUP_INTERVAL_MS);
	}

	onModuleDestroy(): void {
		if (this.cleanupTimer) clearInterval(this.cleanupTimer);
	}

	captureFrame(room: MatchRoom, force = false): void {
		const now = Date.now();
		const hasSeqChange = room.replayLastCapturedSeq !== room.state.seq;
		if (!force && !hasSeqChange) return;
		if (room.replayStartedAt === null) room.replayStartedAt = now;
		const deltaMs =
			room.replayLastRecordedAt === null
				? 0
				: Math.max(0, now - room.replayLastRecordedAt);
		const tickTs = Math.max(0, now - room.replayStartedAt);
		room.replayFrames.push({
			seq: room.state.seq,
			recordedAt: new Date(now).toISOString(),
			recordedAtMs: now,
			tickTs,
			deltaMs,
			snapshot: JSON.parse(JSON.stringify(room.state)) as Record<
				string,
				unknown
			>,
		});
		room.replayLastCapturedSeq = room.state.seq;
		room.replayLastRecordedAt = now;
	}

	recordEvent(
		room: MatchRoom,
		type: string,
		payload: Record<string, unknown>,
	): void {
		const now = Date.now();
		if (room.replayStartedAt === null) room.replayStartedAt = now;
		room.replayEvents.push({
			type,
			seq: room.state.seq,
			recordedAt: new Date(now).toISOString(),
			recordedAtMs: now,
			tickTs: Math.max(0, now - room.replayStartedAt),
			payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
		});
	}

	async persistReplayForRoom(room: MatchRoom): Promise<void> {
		this.captureFrame(room, true);
		await this.replayRepo.save(
			this.replayRepo.create({
				matchId: room.matchId,
				gameId: room.gameId,
				mode: room.mode,
				frames: room.replayFrames,
				events: room.replayEvents,
				frameCount: room.replayFrames.length,
				expiresAt: new Date(Date.now() + REPLAY_TTL_MS),
			}),
		);
	}

	async listForUser(userId: number): Promise<ReplaySummaryView[]> {
		await this.cleanupExpiredReplays();
		const replays = await this.replayRepo
			.createQueryBuilder("replay")
			.leftJoinAndSelect("replay.match", "match")
			.leftJoinAndSelect("match.players", "players")
			.leftJoinAndSelect("players.user", "playerUser")
			.leftJoinAndSelect("replay.saves", "saves")
			.leftJoinAndSelect("saves.user", "saveUser")
			.where(
				`EXISTS (
					SELECT 1
					FROM match_players mp
					WHERE mp."matchId" = replay."matchId"
					  AND mp."userId" = :userId
				)`,
				{ userId },
			)
			.andWhere(
				`(
					replay."expiresAt" IS NULL
					OR replay."expiresAt" > NOW()
					OR EXISTS (
						SELECT 1
						FROM match_replay_saves mrs
						WHERE mrs."replayId" = replay.id
						  AND mrs."userId" = :userId
					)
				)`,
				{ userId },
			)
			.orderBy(`COALESCE(match."finishedAt", replay."createdAt")`, "DESC")
			.getMany();

		return replays.map((replay) => this.toSummary(replay, userId));
	}

	async getForUser(matchId: string, userId: number): Promise<ReplayDetailView> {
		await this.cleanupExpiredReplays();
		const replay = await this.replayRepo.findOne({
			where: { matchId },
			relations: ["match", "match.players", "match.players.user", "saves", "saves.user"],
		});
		if (!replay) throw new BadRequestException("Replay not found");
		if (!this.canAccessReplay(replay, userId)) {
			throw new ForbiddenException("You do not have access to this replay");
		}

		return {
			...this.toSummary(replay, userId),
			frames: replay.frames,
			events: replay.events ?? [],
		};
	}

	async saveForUser(
		matchId: string,
		user: { id: number },
	): Promise<ReplaySummaryView> {
		await this.cleanupExpiredReplays();
		return this.dataSource.transaction(async (manager) => {
			const replayRepo = manager.getRepository(MatchReplay);
			const saveRepo = manager.getRepository(MatchReplaySave);
			const replay = await replayRepo.findOne({
				where: { matchId },
				relations: ["match", "match.players", "match.players.user", "saves", "saves.user"],
			});
			if (!replay) throw new BadRequestException("Replay not found");
			if (!this.canAccessReplay(replay, user.id)) {
				throw new ForbiddenException("You cannot save this replay");
			}

			const alreadySaved = replay.saves.some((save) => save.user.id === user.id);
			if (!alreadySaved) {
				const currentCount = await saveRepo
					.createQueryBuilder("save")
					.leftJoin("save.user", "user")
					.where(`user.id = :userId`, { userId: user.id })
					.getCount();

				if (currentCount >= MAX_SAVED_REPLAYS_PER_USER) {
					throw new BadRequestException(
						`Replay save limit reached (${MAX_SAVED_REPLAYS_PER_USER})`,
					);
				}

				await saveRepo.save(saveRepo.create({ replay, user }));
			}

			replay.expiresAt = null;
			await replayRepo.save(replay);
			const refreshed = await replayRepo.findOneOrFail({
				where: { id: replay.id },
				relations: ["match", "match.players", "match.players.user", "saves", "saves.user"],
			});
			return this.toSummary(refreshed, user.id);
		});
	}

	async importSingleplayerReplayForUser(
		user: { id: number },
		input: ReplayImportInput,
	): Promise<ReplaySummaryView> {
		await this.cleanupExpiredReplays();
		this.validateImportedReplay(input);

		return this.dataSource.transaction(async (manager) => {
			const replayRepo = manager.getRepository(MatchReplay);
			const matchRepo = manager.getRepository(Match);
			const playerRepo = manager.getRepository(MatchPlayer);

			const createdAt = this.parseReplayDate(input.createdAt) ?? new Date();
			const finishedAt =
				this.parseReplayDate(input.finishedAt ?? undefined) ?? createdAt;
			const status = input.status as MatchStatus;

			const match = await matchRepo.save(
				matchRepo.create({
					gameId: input.gameId,
					mode: "casual",
					status,
					winnerUserId:
						input.winnerSide === 0 && status === "finished" ? user.id : null,
					winnerSide:
						typeof input.winnerSide === "number" ? input.winnerSide : null,
					startedAt: createdAt,
					finishedAt,
				}),
			);

			const participants = this.buildImportedReplayPlayers(user.id, input);
			await playerRepo.save(
				participants.map((player) =>
					playerRepo.create({
						matchId: match.id,
						match,
						userId: player.userId,
						side: player.side,
						outcome: this.resolveImportedOutcome(
							player.side,
							input.winnerSide ?? null,
							status,
						),
						shellSelection: [],
					}),
				),
			);

			const replay = await replayRepo.save(
				replayRepo.create({
					matchId: match.id,
					match,
					gameId: input.gameId,
					mode: input.mode,
					frames: input.frames,
					events: input.events ?? [],
					frameCount: input.frames.length,
					expiresAt: new Date(Date.now() + REPLAY_TTL_MS),
				}),
			);

			const refreshed = await replayRepo.findOneOrFail({
				where: { id: replay.id },
				relations: ["match", "match.players", "match.players.user", "saves", "saves.user"],
			});
			return this.toSummary(refreshed, user.id);
		});
	}

	async unsaveForUser(matchId: string, userId: number): Promise<ReplaySummaryView> {
		await this.cleanupExpiredReplays();
		return this.dataSource.transaction(async (manager) => {
			const replayRepo = manager.getRepository(MatchReplay);
			const saveRepo = manager.getRepository(MatchReplaySave);
			const replay = await replayRepo.findOne({
				where: { matchId },
				relations: ["match", "match.players", "match.players.user", "saves", "saves.user"],
			});
			if (!replay) throw new BadRequestException("Replay not found");
			if (!this.canAccessReplay(replay, userId)) {
				throw new ForbiddenException("You cannot modify this replay");
			}

			const save = replay.saves.find((entry) => entry.user.id === userId);
			if (save) await saveRepo.remove(save);

			const remaining = await saveRepo
				.createQueryBuilder("save")
				.leftJoin("save.replay", "replay")
				.where(`replay.id = :replayId`, { replayId: replay.id })
				.getCount();

			replay.expiresAt =
				remaining > 0 ? null : new Date(Date.now() + REPLAY_TTL_MS);
			await replayRepo.save(replay);

			const refreshed = await replayRepo.findOneOrFail({
				where: { id: replay.id },
				relations: ["match", "match.players", "match.players.user", "saves", "saves.user"],
			});
			return this.toSummary(refreshed, userId);
		});
	}

	async cleanupExpiredReplays(): Promise<void> {
		try {
			await this.replayRepo
				.createQueryBuilder()
				.delete()
				.from(MatchReplay)
				.where(`"expiresAt" IS NOT NULL`)
				.andWhere(`"expiresAt" <= NOW()`)
				.andWhere(
					`NOT EXISTS (
						SELECT 1
						FROM match_replay_saves mrs
						WHERE mrs."replayId" = match_replays.id
					)`,
				)
				.execute();
		} catch (err) {
			this.logger.warn(
				`Replay cleanup skipped: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	}

	private validateImportedReplay(input: ReplayImportInput): void {
		if (!IMPORTABLE_REPLAY_GAME_IDS.has(input.gameId)) {
			throw new BadRequestException("Replay import is not supported for this game");
		}
		if (input.status !== "finished" && input.status !== "abandoned") {
			throw new BadRequestException("Replay status must be finished or abandoned");
		}
		if (!Array.isArray(input.frames) || input.frames.length === 0) {
			throw new BadRequestException("Replay frames are required");
		}
		if (input.frames.length > MAX_IMPORTED_REPLAY_FRAMES) {
			throw new BadRequestException(
				`Replay exceeds frame limit (${MAX_IMPORTED_REPLAY_FRAMES})`,
			);
		}
	}

	private parseReplayDate(value?: string): Date | null {
		if (!value) return null;
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	private buildImportedReplayPlayers(
		userId: number,
		input: ReplayImportInput,
	): ReplayImportPlayerInput[] {
		const playerCount = Math.max(
			1,
			input.playerNames?.length ?? 0,
			input.playerUserIds?.length ?? 0,
			Array.isArray(input.frames[0]?.snapshot?.["players"])
				? (input.frames[0]?.snapshot?.["players"] as unknown[]).length
				: 0,
		);
		return Array.from({ length: playerCount }, (_value, index) => ({
			side: index,
			userId: index === 0 ? userId : input.playerUserIds?.[index] ?? null,
			username: input.playerNames?.[index] ?? `Player ${index + 1}`,
		}));
	}

	private resolveImportedOutcome(
		side: number,
		winnerSide: number | null,
		status: MatchStatus,
	): MatchOutcome {
		if (status === "abandoned") return "abandoned";
		if (winnerSide === null) return "draw";
		return winnerSide === side ? "win" : "loss";
	}

	private canAccessReplay(replay: MatchReplay, userId: number): boolean {
		const isParticipant =
			replay.match.players?.some((player) => player.userId === userId) ?? false;
		const isSaved =
			replay.saves?.some((save) => save.user.id === userId) ?? false;
		const notExpired =
			replay.expiresAt === null || replay.expiresAt.getTime() > Date.now();
		return (isParticipant && notExpired) || isSaved;
	}

	private toSummary(replay: MatchReplay, userId: number): ReplaySummaryView {
		const players = [...(replay.match.players ?? [])].sort(
			(a, b) => a.side - b.side,
		);
		return {
			id: replay.id,
			matchId: replay.matchId,
			gameId: replay.gameId,
			mode: replay.mode,
			status: replay.match.status,
			frameCount: replay.frameCount,
			createdAt: replay.createdAt.toISOString(),
			finishedAt: replay.match.finishedAt?.toISOString() ?? null,
			expiresAt: replay.expiresAt?.toISOString() ?? null,
			winnerSide: replay.match.winnerSide,
			playerUserIds: players.map((player) => player.userId ?? 0),
			playerNames: players.map(
				(player) => player.user?.username ?? `Player ${player.side + 1}`,
			),
			isSavedByCurrentUser:
				replay.saves?.some((save) => save.user.id === userId) ?? false,
		};
	}
}
