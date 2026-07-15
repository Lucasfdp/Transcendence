import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { GameResultsService } from "../game-results/game-results.service";
import { UsersService } from "../users/users.service";
import { Match } from "./entities/match.entity";
import { MatchPlayer } from "./entities/match-player.entity";
import { UserRating } from "./entities/user-rating.entity";
import { GameEngineRegistry } from "./engines/game-engine.registry";
import { MatchLifecycleEvents } from "./match-lifecycle.events";
import { GameInputPayload, MatchRoom, RoomPlayer } from "./matchmaking.types";
import { ReplayService } from "./replay.service";
import { RoomService } from "./room.service";

const ELO_K = 32;
const ELO_SCALE = 400;

@Injectable()
export class GameSessionService implements OnModuleInit {
	private readonly logger = new Logger(GameSessionService.name);

	constructor(
		private readonly roomService: RoomService,
		private readonly engines: GameEngineRegistry,
		private readonly usersService: UsersService,
		private readonly gameResultsService: GameResultsService,
		private readonly replayService: ReplayService,
		private readonly dataSource: DataSource,
		@InjectRepository(Match) private readonly matchRepo: Repository<Match>,
		@InjectRepository(MatchPlayer)
		private readonly matchPlayerRepo: Repository<MatchPlayer>,
		@InjectRepository(UserRating)
		private readonly ratingRepo: Repository<UserRating>,
		private readonly matchEvents: MatchLifecycleEvents,
	) {}

	async onModuleInit(): Promise<void> {
		try {
			const updated = await this.matchRepo.update(
				{ status: "active" },
				{ status: "abandoned" },
			);
			this.logger.log(
				`Boot cleanup: marked ${updated.affected ?? 0} stale matches as abandoned`,
			);
		} catch (err: unknown) {
			// Postgres 42P01: table does not exist — fresh DB before migrations run.
			// Safe to skip; migrations will create the table on first run.
			const pg = err as { code?: string };
			if (pg?.code === "42P01") {
				this.logger.log(
					"Boot cleanup skipped — matches table not yet created (fresh database)",
				);
				return;
			}
			this.logger.error("Boot cleanup failed unexpectedly", err);
			throw err;
		}
	}

	handleInput(userId: number, input: GameInputPayload): MatchRoom | null {
		const room = this.roomService.getRoom(input.matchId);
		if (!room) return null;
		return this.engines.get(room.gameId).handleInput(room, userId, input);
	}

	advanceSimulation(room: MatchRoom, elapsedMs: number): boolean {
		return (
			this.engines
				.get(room.gameId)
				.advanceSimulation?.(room, elapsedMs) ?? false
		);
	}

	captureReplayFrame(room: MatchRoom, logicalStepMs: number): void {
		this.replayService.captureFrame(room, false, logicalStepMs);
	}

	async startIfReady(matchId: string): Promise<MatchRoom | null> {
		const room = this.roomService.getRoom(matchId);
		if (
			!room ||
			room.status !== "pending" ||
			!room.players.every((player) => player.ready)
		)
			return room;
		const started = this.roomService.start(matchId);
		await this.matchRepo.update(matchId, {
			status: "active",
			startedAt: new Date(),
		});
		if (started) this.matchEvents.emit({ type: "started", room: started });
		return started;
	}

	async finishIfEnded(room: MatchRoom): Promise<void> {
		if (room.status !== "finished" && room.status !== "abandoned") return;
		const finished =
			this.roomService.finish(
				room.matchId,
				room.state.winnerSide,
				room.status === "abandoned",
			) ?? room;
		this.cleanupEngineRoomState(finished);
		await this.persistFinishedRoom(
			finished,
			finished.status === "abandoned",
		);
	}

	async abandon(
		room: MatchRoom,
		abandonedPlayer: RoomPlayer,
	): Promise<MatchRoom | null> {
		const winnerSide = this.engines
			.get(room.gameId)
			.abandon(room, abandonedPlayer);
		const finished = this.roomService.finish(
			room.matchId,
			winnerSide,
			true,
		);
		if (finished) {
			this.cleanupEngineRoomState(finished);
			await this.persistFinishedRoom(finished, true);
		}
		return finished;
	}

	private cleanupEngineRoomState(room: MatchRoom): void {
		this.engines.get(room.gameId).onRoomClosed?.(room);
	}

	private async persistFinishedRoom(
		room: MatchRoom,
		abandoned: boolean,
	): Promise<void> {
		if (room.rewardsGranted) return;
		const winnerSide = room.state.winnerSide;
		const winnerUserId =
			winnerSide === null
				? null
				: (room.players.find((player) => player.side === winnerSide)
						?.user.id ?? null);

		try {
			await this.dataSource.transaction(async (manager) => {
				const matchRepo = manager.getRepository(Match);
				const matchPlayerRepo = manager.getRepository(MatchPlayer);
				const ratingRepo = manager.getRepository(UserRating);

				await matchRepo.update(room.matchId, {
					status: abandoned ? "abandoned" : "finished",
					winnerUserId,
					winnerSide,
					finishedAt: new Date(),
				});

				for (const player of room.players) {
					const outcome =
						winnerSide === null
							? "draw"
							: player.side === winnerSide
								? "win"
								: abandoned
									? "abandoned"
									: "loss";
					await matchPlayerRepo.update(
						{ matchId: room.matchId, userId: player.user.id },
						{ outcome },
					);
				}

				if (!abandoned) {
					// Reward eligibility is based on the recorded match outcome, not
					// the player's live socket state. A win/loss/draw was already
					// persisted to `match_players` above for every player in this
					// (non-abandoned) match, so a socket that blips right as the
					// final scoring input lands must not cost the player their
					// XP/coins/card drop (Bug Audit M6). Abandon-driven forfeits are
					// handled separately via `abandon()` with `abandoned = true`.
					for (const player of room.players) {
						const user = await this.usersService.findById(
							player.user.id,
						);
						if (!user || user.isGuest) continue;
						await this.gameResultsService.submitResult(user, {
							gameId: room.gameId,
							outcome:
								winnerSide === null
									? "draw"
									: player.side === winnerSide
										? "win"
										: "loss",
						});
					}
				}

				if (room.mode === "ranked" && winnerSide !== null) {
					await this.applyEloRatings(room, winnerSide, ratingRepo);
				}
			});
			await this.replayService.persistReplayForRoom(room);
			room.rewardsGranted = true;
			// Fires only after the outcome is fully persisted (statuses, rewards,
			// ratings, replay) so listeners can trust what they read. Listener
			// errors are contained inside MatchLifecycleEvents.emit.
			this.matchEvents.emit({
				type: abandoned ? "abandoned" : "finished",
				room,
			});
		} catch (err) {
			this.logger.error(
				`Failed to persist match ${room.matchId}: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
			throw err;
		}
	}

	private async applyEloRatings(
		room: MatchRoom,
		winnerSide: number,
		ratingRepo: Repository<UserRating>,
	): Promise<void> {
		const ratings: UserRating[] = [];
		for (const player of room.players) {
			let rating = await ratingRepo.findOne({
				where: { userId: player.user.id, gameId: room.gameId },
			});
			if (!rating) {
				rating = ratingRepo.create({
					userId: player.user.id,
					gameId: room.gameId,
				});
			}
			ratings.push(rating);
		}

		// Snapshot every player's pre-match rating before any updates are
		// applied. Reading `ratings[j].rating` inside the loop below would
		// pick up already-mutated values for players processed earlier in
		// the same match, making each player's expected score (and thus the
		// whole match) order-dependent and no longer zero-sum (Bug Audit H1).
		const preMatchRatings = ratings.map((r) => r.rating);

		for (let i = 0; i < room.players.length; i++) {
			const player = room.players[i];
			const rating = ratings[i];
			const won = player.side === winnerSide;
			const score = won ? 1 : 0;
			const playerRating = preMatchRatings[i];

			const opponentRatings = preMatchRatings.filter((_, j) => j !== i);
			const opponentRating =
				opponentRatings.reduce((sum, r) => sum + r, 0) /
				opponentRatings.length;

			const expected =
				1 /
				(1 + Math.pow(10, (opponentRating - playerRating) / ELO_SCALE));
			const delta = Math.round(ELO_K * (score - expected));
			rating.rating = Math.max(0, playerRating + delta);

			if (won) rating.wins += 1;
			else rating.losses += 1;

			await ratingRepo.save(rating);
		}
	}
}
