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
	ReplayMetadataV2,
	REPLAY_CONTRACT_VERSION,
	ReplayContractVersion,
} from "./entities/match-replay.entity";
import { MatchReplaySave } from "./entities/match-replay-save.entity";
import { MatchRoom } from "./matchmaking.types";

const REPLAY_TTL_MS = 72 * 60 * 60 * 1000;
const REPLAY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const REPLAY_SAMPLE_MS = 50;
const REPLAY_KEYFRAME_MS = 1_000;
const MAX_SAVED_REPLAYS_PER_USER = 20;
const MAX_IMPORTED_REPLAY_FRAMES = 3_600;
// Upper bound on frames retained in memory for a single live match, so a
// pathological or unusually long match can never grow the room's replay buffer
// without limit (R3). When exceeded, the oldest complete rounds are trimmed —
// never the round in progress — which keeps the delta chain valid because the
// first frame of every round is always a keyframe.
const MAX_LIVE_REPLAY_FRAMES = 3_600;
const IMPORTABLE_REPLAY_GAME_IDS = new Set([
	"temple-curling",
	"bamboo-bash",
	"kame-knock",
	"bell-clash",
]);

export interface ReplayImportInput {
	gameId: string;
	mode: string;
	status: "finished" | "abandoned";
	createdAt?: string;
	finishedAt?: string | null;
	winnerSide?: number | null;
	metadata: ReplayMetadataV2;
	durationMs: number;
	frames: MatchReplayFrame[];
	events?: MatchReplayEvent[];
}

export interface ReplaySummaryView {
	id: string;
	matchId: string;
	replayVersion: ReplayContractVersion;
	contractVersion: ReplayContractVersion;
	metadata: ReplayMetadataV2;
	durationMs: number;
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

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function withoutRepeatedTrails(
	snapshot: Record<string, unknown>,
): Record<string, unknown> {
	const normalised = clone(snapshot);
	for (const collection of ["entities", "balls", "objects"] as const) {
		const values = normalised[collection];
		if (!Array.isArray(values)) continue;
		normalised[collection] = values.map((value) => {
			if (!value || typeof value !== "object") return value;
			const entity = { ...(value as Record<string, unknown>) };
			delete entity.trail;
			return entity;
		});
	}
	return normalised;
}

function roundOf(snapshot: Record<string, unknown>): number {
	const value =
		snapshot.roundNumber ?? snapshot.currentEnd ?? snapshot.turnNumber;
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: 0;
}

function phaseOf(snapshot: Record<string, unknown>): MatchReplayFrame["state"] {
	const phase = snapshot.phase;
	return phase === "pending" ||
		phase === "active" ||
		phase === "finished" ||
		phase === "abandoned"
		? phase
		: "active";
}

function diffSnapshot(
	previous: Record<string, unknown>,
	next: Record<string, unknown>,
): { changes: Record<string, unknown>; removals: string[] } {
	const changes: Record<string, unknown> = {};
	const removals: string[] = [];
	for (const [key, value] of Object.entries(next)) {
		if (JSON.stringify(previous[key]) !== JSON.stringify(value))
			changes[key] = clone(value);
	}
	for (const key of Object.keys(previous)) {
		if (!(key in next)) removals.push(key);
	}
	return { changes, removals };
}

function trimRoundPreRoll(
	frames: MatchReplayFrame[],
	events: MatchReplayEvent[],
	maximumPreRollMs: number,
): {
	frames: MatchReplayFrame[];
	events: MatchReplayEvent[];
	durationMs: number;
} {
	const roundStarts = new Map<number, number>();
	for (const frame of frames) {
		roundStarts.set(
			frame.round,
			Math.min(roundStarts.get(frame.round) ?? frame.tMs, frame.tMs),
		);
	}
	const cuts = new Map<number, { start: number; excess: number }>();
	for (const event of events) {
		if (
			!/(action:start|throw|launch)/.test(event.type) ||
			cuts.has(event.round)
		)
			continue;
		const start = roundStarts.get(event.round) ?? 0;
		const excess = Math.max(0, event.tMs - start - maximumPreRollMs);
		if (excess > 0) cuts.set(event.round, { start, excess });
	}
	const orderedCuts = [...cuts.values()].sort(
		(left, right) => left.start - right.start,
	);
	const transform = (tMs: number): number => {
		let shifted = tMs;
		for (const cut of orderedCuts) {
			if (tMs < cut.start) break;
			shifted -= Math.min(cut.excess, Math.max(0, tMs - cut.start));
		}
		return Math.max(0, Math.round(shifted));
	};
	const nextFrames = frames.map((frame, seq) => ({
		...frame,
		seq,
		tMs: transform(frame.tMs),
	}));
	const nextEvents = events.map((event, seq) => ({
		...event,
		seq,
		tMs: transform(event.tMs),
	}));
	return {
		frames: nextFrames,
		events: nextEvents,
		durationMs: nextFrames.at(-1)?.tMs ?? 0,
	};
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
		this.cleanupTimer = setInterval(
			() => void this.cleanupExpiredReplays(),
			REPLAY_CLEANUP_INTERVAL_MS,
		);
	}

	onModuleDestroy(): void {
		if (this.cleanupTimer) clearInterval(this.cleanupTimer);
	}

	captureFrame(
		room: MatchRoom,
		force = false,
		logicalStepMs?: number,
	): void {
		if (!room.replayEnabled || room.state.powerupsEnabled) return;
		const now = Date.now();
		if (room.replayStartedAt === null) room.replayStartedAt = now;
		if (
			!force &&
			logicalStepMs === undefined &&
			room.replayLastSampleAt !== null &&
			now - room.replayLastSampleAt < REPLAY_SAMPLE_MS
		)
			return;
		const tMs =
			logicalStepMs === undefined
				? Math.max(
						0,
						now - room.replayStartedAt,
						room.replayFrames[room.replayFrames.length - 1]?.tMs ?? 0,
					)
				: Math.max(
						0,
						(room.replayFrames[room.replayFrames.length - 1]?.tMs ??
							-logicalStepMs) + logicalStepMs,
					);
		const snapshot = withoutRepeatedTrails(
			clone(room.state) as unknown as Record<string, unknown>,
		);
		const keyframe =
			force ||
			room.replayLastSnapshot === null ||
			room.replayLastKeyframeAt === null ||
			tMs - room.replayLastKeyframeAt >= REPLAY_KEYFRAME_MS ||
			roundOf(snapshot) !== roundOf(room.replayLastSnapshot);
		const encoded = keyframe
			? { changes: snapshot, removals: [] as string[] }
			: diffSnapshot(room.replayLastSnapshot ?? {}, snapshot);
		if (
			!keyframe &&
			Object.keys(encoded.changes).length === 0 &&
			encoded.removals.length === 0
		) {
			room.replayLastSampleAt = now;
			return;
		}
		room.replayFrames.push({
			seq: room.replayFrames.length,
			tMs,
			round: roundOf(snapshot),
			state: phaseOf(snapshot),
			type: keyframe ? "keyframe" : "delta",
			changes: encoded.changes,
			removals: encoded.removals,
		});
		room.replayLastSnapshot = snapshot;
		room.replayLastSampleAt = now;
		if (keyframe) room.replayLastKeyframeAt = tMs;
		this.trimLiveFramesToBudget(room);
	}

	/**
	 * Bound the in-memory live replay buffer (R3). Drops the oldest complete
	 * rounds — never the round currently in progress — because the first frame
	 * of every round is a keyframe, so whole-round trimming preserves the
	 * "buffer starts with a keyframe" invariant the delta reconstructor relies
	 * on. Sequence numbers are then compacted so `seq` stays contiguous from
	 * zero, which both the next push (`seq: replayFrames.length`) and the import
	 * contract (`seq === index`) require. A single round longer than the budget
	 * is left intact rather than corrupting the delta chain; that is not
	 * reachable in normal play for these launch-based games.
	 */
	private trimLiveFramesToBudget(room: MatchRoom): void {
		if (room.replayFrames.length <= MAX_LIVE_REPLAY_FRAMES) return;
		const currentRound =
			room.replayFrames[room.replayFrames.length - 1].round;
		let trimmed = false;
		while (
			room.replayFrames.length > MAX_LIVE_REPLAY_FRAMES &&
			room.replayFrames[0].round < currentRound
		) {
			const oldestRound = room.replayFrames[0].round;
			let cut = 0;
			while (
				cut < room.replayFrames.length &&
				room.replayFrames[cut].round === oldestRound
			)
				cut += 1;
			room.replayFrames.splice(0, cut);
			room.replayEvents = room.replayEvents.filter(
				(event) => event.round !== oldestRound,
			);
			trimmed = true;
		}
		if (!trimmed) return;
		room.replayFrames.forEach((frame, index) => {
			frame.seq = index;
		});
		room.replayEvents.forEach((event, index) => {
			event.seq = index;
		});
	}

	recordEvent(
		room: MatchRoom,
		type: string,
		payload: Record<string, unknown>,
	): void {
		if (!room.replayEnabled || room.state.powerupsEnabled) return;
		this.captureFrame(room, true, 0);
		const snapshot = room.state as unknown as Record<string, unknown>;
		room.replayEvents.push({
			seq: room.replayEvents.length,
			tMs: room.replayFrames[room.replayFrames.length - 1]?.tMs ?? 0,
			round: roundOf(snapshot),
			type,
			payload: clone(payload),
		});
	}

	async persistReplayForRoom(room: MatchRoom): Promise<void> {
		if (!room.replayEnabled || room.state.powerupsEnabled) return;
		this.captureFrame(room, true, 0);
		if (room.replayFrames.length === 0) return;
		const preRollMs = Number(process.env.REPLAY_ROUND_PREROLL_MS ?? 3000);
		const timeline = trimRoundPreRoll(
			room.replayFrames,
			room.replayEvents,
			preRollMs,
		);
		const durationMs = timeline.durationMs;
		const metadata: ReplayMetadataV2 = {
			contractVersion: REPLAY_CONTRACT_VERSION,
			origin: "online",
			gameId: room.gameId,
			mode: room.mode,
			participants: room.state.players.map((player) => ({
				side: player.side,
				userId: player.userId,
				username: player.username,
				turtleName: player.turtleName,
				shellSkin: player.shellSkin,
				trailEffect: player.trailEffect,
				hubBackground: player.hubBackground,
				hubBackgroundAlter: player.hubBackgroundAlter,
			})),
			durationMs,
			sampleHz: 20,
			keyframeIntervalMs: REPLAY_KEYFRAME_MS,
			preRollMs,
			statistics: { winnerSide: room.state.winnerSide },
			powerupsEnabled: false,
		};
		await this.replayRepo.save(
			this.replayRepo.create({
				matchId: room.matchId,
				gameId: room.gameId,
				mode: room.mode,
				contractVersion: REPLAY_CONTRACT_VERSION,
				metadata,
				durationMs,
				frames: timeline.frames,
				events: timeline.events,
				frameCount: timeline.frames.length,
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
				`EXISTS (SELECT 1 FROM match_players mp WHERE mp."matchId" = replay."matchId" AND mp."userId" = :userId) OR EXISTS (SELECT 1 FROM match_replay_saves mrs WHERE mrs."replayId" = replay.id AND mrs."userId" = :userId)`,
				{ userId },
			)
			.andWhere(`replay."contractVersion" = :version`, {
				version: REPLAY_CONTRACT_VERSION,
			})
			.andWhere(`replay.metadata ->> 'powerupsEnabled' = 'false'`)
			.andWhere(
				`replay."expiresAt" IS NULL OR replay."expiresAt" > NOW() OR EXISTS (SELECT 1 FROM match_replay_saves mrs WHERE mrs."replayId" = replay.id AND mrs."userId" = :userId)`,
				{ userId },
			)
			.orderBy(`COALESCE(match."finishedAt", replay."createdAt")`, "DESC")
			.getMany();
		return replays.map((replay) => this.toSummary(replay, userId));
	}

	async getForUser(
		matchId: string,
		userId: number,
	): Promise<ReplayDetailView> {
		await this.cleanupExpiredReplays();
		const replay = await this.findReplay(matchId);
		if (
			!replay ||
			replay.contractVersion !== REPLAY_CONTRACT_VERSION ||
			replay.metadata.powerupsEnabled !== false
		)
			throw new BadRequestException("Replay not found");
		if (!this.canAccessReplay(replay, userId))
			throw new ForbiddenException(
				"You do not have access to this replay",
			);
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
				relations: [
					"match",
					"match.players",
					"match.players.user",
					"saves",
					"saves.user",
				],
			});
			if (!replay) throw new BadRequestException("Replay not found");
			if (!this.canAccessReplay(replay, user.id))
				throw new ForbiddenException("You cannot save this replay");
			if (!replay.saves.some((save) => save.user.id === user.id)) {
				const currentCount = await saveRepo
					.createQueryBuilder("save")
					.leftJoin("save.user", "user")
					.where(`user.id = :userId`, { userId: user.id })
					.getCount();
				if (currentCount >= MAX_SAVED_REPLAYS_PER_USER)
					throw new BadRequestException(
						`Replay save limit reached (${MAX_SAVED_REPLAYS_PER_USER})`,
					);
				await manager
					.createQueryBuilder()
					.insert()
					.into("match_replay_saves")
					.values({ replayId: replay.id, userId: user.id })
					.execute();
			}
			await replayRepo.update(replay.id, { expiresAt: null });
			return this.toSummary(
				await replayRepo.findOneOrFail({
					where: { id: replay.id },
					relations: [
						"match",
						"match.players",
						"match.players.user",
						"saves",
						"saves.user",
					],
				}),
				user.id,
			);
		});
	}

	async unsaveForUser(
		matchId: string,
		userId: number,
	): Promise<ReplaySummaryView> {
		await this.cleanupExpiredReplays();
		return this.dataSource.transaction(async (manager) => {
			const replayRepo = manager.getRepository(MatchReplay);
			const saveRepo = manager.getRepository(MatchReplaySave);
			const replay = await replayRepo.findOne({
				where: { matchId },
				relations: [
					"match",
					"match.players",
					"match.players.user",
					"saves",
					"saves.user",
				],
			});
			if (!replay) throw new BadRequestException("Replay not found");
			if (!this.canAccessReplay(replay, userId))
				throw new ForbiddenException("You cannot modify this replay");
			const save = replay.saves.find((entry) => entry.user.id === userId);
			if (save) await saveRepo.remove(save);
			const remaining = await saveRepo
				.createQueryBuilder("save")
				.leftJoin("save.replay", "replay")
				.where(`replay.id = :replayId`, { replayId: replay.id })
				.getCount();
			await replayRepo.update(replay.id, {
				expiresAt:
					remaining > 0 ? null : new Date(Date.now() + REPLAY_TTL_MS),
			});
			return this.toSummary(
				await replayRepo.findOneOrFail({
					where: { id: replay.id },
					relations: [
						"match",
						"match.players",
						"match.players.user",
						"saves",
						"saves.user",
					],
				}),
				userId,
			);
		});
	}

	async importSingleplayerReplayForUser(
		user: { id: number },
		input: ReplayImportInput,
	): Promise<ReplaySummaryView> {
		await this.cleanupExpiredReplays();
		this.validateImportedReplay(input);
		return this.dataSource.transaction(async (manager) => {
			const createdAt =
				this.parseReplayDate(input.createdAt) ?? new Date();
			const finishedAt =
				this.parseReplayDate(input.finishedAt ?? undefined) ??
				createdAt;
			const status = input.status as MatchStatus;
			const matchRepo = manager.getRepository(Match);
			const match = await matchRepo.save(
				matchRepo.create({
					gameId: input.gameId,
					mode: "casual",
					status,
					winnerUserId:
						input.winnerSide === 0 && status === "finished"
							? user.id
							: null,
					winnerSide: input.winnerSide ?? null,
					startedAt: createdAt,
					finishedAt,
				}),
			);
			const participants = input.metadata.participants;
			await manager
				.getRepository(MatchPlayer)
				.save(
					participants.map((player) =>
						manager
							.getRepository(MatchPlayer)
							.create({
								matchId: match.id,
								match,
								userId:
									player.side === 0 ? user.id : player.userId,
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
			const replayRepo = manager.getRepository(MatchReplay);
			const replay = await replayRepo.save(
				replayRepo.create({
					matchId: match.id,
					match,
					gameId: input.gameId,
					mode: input.mode,
					contractVersion: REPLAY_CONTRACT_VERSION,
					metadata: input.metadata,
					durationMs: input.durationMs,
					frames: input.frames,
					events: input.events ?? [],
					frameCount: input.frames.length,
					expiresAt: new Date(Date.now() + REPLAY_TTL_MS),
				}),
			);
			return this.toSummary(
				await replayRepo.findOneOrFail({
					where: { id: replay.id },
					relations: [
						"match",
						"match.players",
						"match.players.user",
						"saves",
						"saves.user",
					],
				}),
				user.id,
			);
		});
	}

	validateImportedReplay(input: ReplayImportInput): void {
		if (!IMPORTABLE_REPLAY_GAME_IDS.has(input.gameId))
			throw new BadRequestException(
				"Replay import is not supported for this game",
			);
		if (input.status !== "finished" && input.status !== "abandoned")
			throw new BadRequestException(
				"Replay status must be finished or abandoned",
			);
		if (
			!input.metadata ||
			input.metadata.contractVersion !== REPLAY_CONTRACT_VERSION
		)
			throw new BadRequestException(
				"Replay metadata must use contract version 2",
			);
		if (input.metadata.powerupsEnabled !== false)
			throw new BadRequestException(
				"Replays are unavailable while power-ups are enabled",
			);
		if (
			input.metadata.gameId !== input.gameId ||
			input.metadata.mode !== input.mode
		)
			throw new BadRequestException(
				"Replay metadata does not match the import",
			);
		if (
			!Array.isArray(input.metadata.participants) ||
			input.metadata.participants.length < 1 ||
			input.metadata.participants.length > 5
		)
			throw new BadRequestException(
				"Replay must contain between one and five participants",
			);
		input.metadata.participants.forEach((participant, index) => {
			if (
				participant.side !== index ||
				typeof participant.username !== "string" ||
				!participant.username.trim()
			)
				throw new BadRequestException(
					"Replay participants must use contiguous sides and valid names",
				);
		});
		if (
			!Number.isInteger(input.durationMs) ||
			input.durationMs < 0 ||
			input.durationMs !== input.metadata.durationMs
		)
			throw new BadRequestException("Replay duration is invalid");
		if (
			!Array.isArray(input.frames) ||
			input.frames.length === 0 ||
			input.frames.length > MAX_IMPORTED_REPLAY_FRAMES
		)
			throw new BadRequestException("Replay frame count is invalid");
		let previousTMs = -1;
		for (let index = 0; index < input.frames.length; index += 1) {
			const frame = input.frames[index];
			if (
				frame.seq !== index ||
				!Number.isInteger(frame.tMs) ||
				frame.tMs < previousTMs ||
				frame.tMs < 0 ||
				frame.tMs > input.durationMs
			)
				throw new BadRequestException(
					`Replay frame ${index} has an invalid timeline`,
				);
			if (index === 0 && frame.type !== "keyframe")
				throw new BadRequestException(
					"Replay must begin with a keyframe",
				);
			if (
				!Array.isArray(frame.removals) ||
				!frame.changes ||
				typeof frame.changes !== "object"
			)
				throw new BadRequestException(
					`Replay frame ${index} is malformed`,
				);
			for (const collection of [
				"entities",
				"balls",
				"objects",
			] as const) {
				const entities = frame.changes[collection];
				if (!Array.isArray(entities)) continue;
				for (const entity of entities) {
					if (!entity || typeof entity !== "object")
						throw new BadRequestException(
							`Replay frame ${index} contains an invalid entity`,
						);
					const value = entity as Record<string, unknown>;
					if (
						(typeof value.id !== "string" &&
							typeof value.id !== "number") ||
						typeof value.x !== "number" ||
						!Number.isFinite(value.x) ||
						Math.abs(value.x) > 2 ||
						typeof value.y !== "number" ||
						!Number.isFinite(value.y) ||
						Math.abs(value.y) > 2
					)
						throw new BadRequestException(
							`Replay frame ${index} contains an out-of-range entity`,
						);
					for (const velocity of [value.vx, value.vy]) {
						if (
							velocity !== undefined &&
							(typeof velocity !== "number" ||
								!Number.isFinite(velocity))
						)
							throw new BadRequestException(
								`Replay frame ${index} contains an invalid velocity`,
							);
					}
				}
			}
			previousTMs = frame.tMs;
		}
		const firstPlayers = input.frames[0]?.changes.players;
		const firstScore =
			input.frames[0]?.changes.score ?? input.frames[0]?.changes.scores;
		if (
			!Array.isArray(firstPlayers) ||
			firstPlayers.length !== input.metadata.participants.length ||
			!Array.isArray(firstScore) ||
			firstScore.length !== input.metadata.participants.length
		)
			throw new BadRequestException(
				"Replay participants and scores must have matching lengths",
			);
		const finalFrame = input.frames.at(-1);
		if (finalFrame?.tMs !== input.durationMs)
			throw new BadRequestException(
				"Replay duration must match the final frame",
			);
		if (input.status === "finished" && finalFrame.state !== "finished")
			throw new BadRequestException(
				"Finished replay must end in the finished state",
			);
		let previousEventTMs = -1;
		for (let index = 0; index < (input.events ?? []).length; index += 1) {
			const event = input.events?.[index];
			if (
				!event ||
				event.seq !== index ||
				!Number.isInteger(event.tMs) ||
				event.tMs < previousEventTMs ||
				event.tMs > input.durationMs
			)
				throw new BadRequestException(
					`Replay event ${index} has an invalid timeline`,
				);
			previousEventTMs = event.tMs;
		}
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
					`NOT EXISTS (SELECT 1 FROM match_replay_saves mrs WHERE mrs."replayId" = match_replays.id)`,
				)
				.execute();
		} catch (err) {
			this.logger.warn(
				`Replay cleanup skipped: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	private findReplay(matchId: string): Promise<MatchReplay | null> {
		return this.replayRepo.findOne({
			where: { matchId },
			relations: [
				"match",
				"match.players",
				"match.players.user",
				"saves",
				"saves.user",
			],
		});
	}

	private parseReplayDate(value?: string): Date | null {
		if (!value) return null;
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
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
		const participant =
			replay.match.players?.some((player) => player.userId === userId) ??
			false;
		const saved =
			replay.saves?.some((save) => save.user.id === userId) ?? false;
		const current =
			replay.expiresAt === null ||
			replay.expiresAt.getTime() > Date.now();
		return (participant && current) || saved;
	}

	private toSummary(replay: MatchReplay, userId: number): ReplaySummaryView {
		const players = [...(replay.match.players ?? [])].sort(
			(a, b) => a.side - b.side,
		);
		return {
			id: replay.id,
			matchId: replay.matchId,
			replayVersion: replay.contractVersion,
			contractVersion: replay.contractVersion,
			metadata: replay.metadata,
			durationMs: replay.durationMs,
			gameId: replay.gameId,
			mode: replay.mode,
			status: replay.match.status,
			frameCount: replay.frameCount,
			createdAt: replay.createdAt.toISOString(),
			finishedAt: replay.match.finishedAt?.toISOString() ?? null,
			expiresAt: replay.expiresAt?.toISOString() ?? null,
			winnerSide: replay.match.winnerSide,
			playerUserIds: players.map((player) => player.userId ?? 0),
			playerNames: replay.metadata.participants.map(
				(player) => player.username,
			),
			isSavedByCurrentUser:
				replay.saves?.some((save) => save.user.id === userId) ?? false,
		};
	}
}
