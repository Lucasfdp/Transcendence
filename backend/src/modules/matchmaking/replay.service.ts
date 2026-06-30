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
import { MatchReplay, MatchReplayFrame } from "./entities/match-replay.entity";
import { MatchReplaySave } from "./entities/match-replay-save.entity";
import { MatchRoom } from "./matchmaking.types";

const REPLAY_TTL_MS = 72 * 60 * 60 * 1000;
const REPLAY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MAX_SAVED_REPLAYS_PER_USER = 20;

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

	captureFrame(room: MatchRoom): void {
		if (room.replayLastCapturedSeq === room.state.seq) return;
		room.replayFrames.push({
			seq: room.state.seq,
			recordedAt: new Date().toISOString(),
			snapshot: JSON.parse(JSON.stringify(room.state)) as Record<
				string,
				unknown
			>,
		});
		room.replayLastCapturedSeq = room.state.seq;
	}

	async persistReplayForRoom(room: MatchRoom): Promise<void> {
		this.captureFrame(room);
		await this.replayRepo.save(
			this.replayRepo.create({
				matchId: room.matchId,
				gameId: room.gameId,
				mode: room.mode,
				frames: room.replayFrames,
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
