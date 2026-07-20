import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { GameResultsService } from "../game-results/game-results.service";
import { UsersService } from "../users/users.service";
import { Profile } from "../profiles/entities/profile.entity";
import { Match } from "./entities/match.entity";
import { MatchPlayer } from "./entities/match-player.entity";
import { UserRating } from "./entities/user-rating.entity";
import { GameEngineRegistry } from "./engines/game-engine.registry";
import { MatchLifecycleEvents } from "./match-lifecycle.events";
import {
	GameInputPayload,
	MatchRoom,
	RoomPlayer,
	isBotSeat,
} from "./matchmaking.types";
import { ReplayService } from "./replay.service";
import { RoomService } from "./room.service";

const ELO_K = 32;
const ELO_SCALE = 400;

/**
 * Outcome of resolving an abandon (P5). `finished` — the match settled (forfeit
 * or natural end). `continued` — the seat was handed to a CPU stand-in and the
 * match plays on.
 */
export interface AbandonResult {
	room: MatchRoom;
	outcome: "finished" | "continued";
}

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

	/**
	 * Resolve a seat leaving/forfeiting (P5). In a match with three or more
	 * players where at least one other human seat remains, the match plays on:
	 * the leaving seat is handed to a CPU stand-in (`convertSeatToBot`, the same
	 * mechanism the tournament layer uses) so the remaining players are not
	 * robbed of their game by one drop-out. Otherwise (two-player matches, or a
	 * 3+ match reduced to a single human) the match settles as a forfeit, with
	 * the leaver taking the loss on their record.
	 */
	async abandon(
		room: MatchRoom,
		abandonedPlayer: RoomPlayer,
	): Promise<AbandonResult | null> {
		if (this.shouldContinueWithBot(room, abandonedPlayer)) {
			const continued = this.roomService.convertSeatToBot(
				room.matchId,
				abandonedPlayer.user.id,
			);
			if (continued) return { room: continued, outcome: "continued" };
			// convertSeatToBot no-op (already resolved / unseated) — fall through
			// and settle as a forfeit rather than leaving the match hanging.
		}
		const winnerSide = this.engines
			.get(room.gameId)
			.abandon(room, abandonedPlayer);
		const finished = this.roomService.finish(room.matchId, winnerSide, true);
		if (!finished) return null;
		this.cleanupEngineRoomState(finished);
		// The player who left/forfeited takes the loss on their record.
		await this.persistFinishedRoom(finished, true, abandonedPlayer);
		return { room: finished, outcome: "finished" };
	}

	/**
	 * Whether an abandon should keep the match alive with a CPU stand-in rather
	 * than ending it: only for 3+ player matches that still have another human
	 * (non-bot) seat besides the one leaving.
	 */
	private shouldContinueWithBot(
		room: MatchRoom,
		abandonedPlayer: RoomPlayer,
	): boolean {
		if (room.players.length < 3) return false;
		return room.players.some(
			(player) =>
				player.side !== abandonedPlayer.side && !isBotSeat(player),
		);
	}

	/**
	 * Abort a match with no winner (e.g. a tournament minigame whose tournament
	 * was cancelled because no real players remain). Recorded as `abandoned`
	 * with `winnerSide = null` — the same persistence path as a forfeit, so it
	 * settles cleanly and its `abandoned` lifecycle event unblocks any waiter
	 * (the tournament minigame coordinator). No per-player XP/coins are granted
	 * (abandoned path), and a winnerless-abandoned match applies no Elo.
	 */
	async abort(room: MatchRoom): Promise<MatchRoom | null> {
		const finished = this.roomService.finish(room.matchId, null, true);
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
		forfeitPlayer?: RoomPlayer,
	): Promise<void> {
		if (room.rewardsGranted) return;
		const winnerSide = room.state.winnerSide;
		const winnerUserId =
			winnerSide === null
				? null
				: (room.players.find((player) => player.side === winnerSide)
						?.user.id ?? null);

		try {
			const alreadyPersisted = await this.dataSource.transaction(
				async (manager) => {
					const matchRepo = manager.getRepository(Match);
					const matchPlayerRepo = manager.getRepository(MatchPlayer);
					const ratingRepo = manager.getRepository(UserRating);

					// Rankings Bug Audit M4: scope the UPDATE to the match's own
					// current status instead of writing it unconditionally. The
					// in-memory `room.rewardsGranted` guard above is only set
					// *after* this transaction (and replay persistence) succeed,
					// so a duplicate re-entry into finish/abandon (double
					// disconnect, gateway retry, or — after a process restart —
					// a freshly rehydrated room object that never carried the
					// flag) could otherwise re-run this whole transaction and
					// double-apply XP/coins/Elo. Scoping to `WHERE status =
					// 'active'` makes "already rewarded" a durable, atomically
					// checked DB fact (0 rows affected) instead of a
					// process-local boolean.
					const matchUpdate = await matchRepo.update(
						{ id: room.matchId, status: "active" },
						{
							status: abandoned ? "abandoned" : "finished",
							winnerUserId,
							winnerSide,
							finishedAt: new Date(),
						},
					);
					if (!matchUpdate.affected) return true;

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

					// A player who LEFT/forfeited the match takes a loss on their
					// overall record (leaving a match counts as a loss). A bare
					// stat bump — deliberately no consolation XP/coins/card-drop
					// for quitting. Inside the M4-guarded transition (past the
					// `affected` check above) so it can never double-count, and
					// never for a CPU stand-in or a guest.
					if (
						abandoned &&
						forfeitPlayer &&
						!forfeitPlayer.user.isGuest &&
						!isBotSeat(forfeitPlayer)
					) {
						const profileRepo = manager.getRepository(Profile);
						const profile = await profileRepo.findOne({
							where: { user: { id: forfeitPlayer.user.id } },
						});
						if (profile) {
							profile.totalLosses += 1;
							profile.gamesPlayed += 1;
							await profileRepo.save(profile);
						}
					}

					if (!abandoned) {
						// Reward eligibility is based on the recorded match outcome,
						// not the player's live socket state. A win/loss/draw was
						// already persisted to `match_players` above for every
						// player in this (non-abandoned) match, so a socket that
						// blips right as the final scoring input lands must not
						// cost the player their XP/coins/card drop (Bug Audit M6).
						// Abandon-driven forfeits are handled separately via
						// `abandon()` with `abandoned = true`.
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

					// Rankings Bug Audit M3: this used to require `winnerSide !==
					// null`, so a ranked draw skipped rating updates entirely —
					// `draws` never incremented on `user_ratings` and the match had
					// zero rating impact. The only way `winnerSide === null` and
					// `abandoned` are both true is `resolveAbandonWinner` finding no
					// single remaining leader (Bug Audit out-of-scope note: abandon
					// forfeits must keep applying Elo, so that case is deliberately
					// excluded here — unchanged from before). A genuine draw
					// (`!abandoned`) now reaches `applyEloRatings`, which scores it
					// 0.5 for every player per the standard Elo formula.
					if (
						room.mode === "ranked" &&
						(winnerSide !== null || !abandoned)
					) {
						await this.applyEloRatings(
							room,
							forfeitPlayer?.side ?? null,
							ratingRepo,
						);
					}
					return false;
				},
			);

			// Set the durable guard immediately after the transaction commits —
			// before replay persistence, which is a plain insert (not
			// idempotent). A replay failure below must never risk rewards being
			// re-applied on a retry (Rankings Bug Audit M4).
			room.rewardsGranted = true;
			if (alreadyPersisted) return;

			await this.replayService.persistReplayForRoom(room);
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

	/**
	 * Apply ranked Elo as a sum of pairwise games (P4). Each player is scored
	 * against every opponent by relative final placement (1 ahead / 0.5 tied / 0
	 * behind), the pairwise deltas are summed against the expected scores from
	 * pre-match ratings, and the total is normalised by the opponent count. This
	 * is the standard multiplayer-Elo construction: it stays zero-sum in
	 * expectation for any player count and — unlike the previous average-opponent
	 * design — a player can never gain rating from a tie for first they did not
	 * actually lead (a clear last place records a loss and loses rating).
	 *
	 * Placement comes from the per-side `score` array every engine maintains. A
	 * forfeiting seat (`forfeitSide`) is forced to last place regardless of the
	 * score it held when it left, preserving forfeit semantics.
	 */
	private async applyEloRatings(
		room: MatchRoom,
		forfeitSide: number | null,
		ratingRepo: Repository<UserRating>,
	): Promise<void> {
		const ratings: UserRating[] = [];
		for (const player of room.players) {
			// Rankings Bug Audit L6: locked so a concurrent finish/abandon
			// re-entry for the same player+game can't read-modify-write the same
			// row out from under this one. A user can only be in one active room
			// at a time (`matchmaking.service.ts`), so cross-match races are
			// already prevented at the app layer — this lock is belt-and-braces
			// alongside the M4 transaction guard and H1's unique constraint,
			// which converts a duplicate-insert race into a constraint error
			// instead of a silent duplicate row.
			let rating = await ratingRepo.findOne({
				where: { userId: player.user.id, gameId: room.gameId },
				lock: { mode: "pessimistic_write" },
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

		// Per-side final scores drive placement; a forfeiting seat is forced last.
		const rawScores = (room.state as { score?: number[] }).score ?? [];
		const effectiveScore = room.players.map((player) =>
			player.side === forfeitSide
				? Number.NEGATIVE_INFINITY
				: (rawScores[player.side] ?? 0),
		);

		const playerCount = room.players.length;
		// Rankings Bug Audit L5: a lone ranked player has no opponents to score
		// against; skip rather than divide by zero and persist a NaN rating.
		if (playerCount < 2) return;

		for (let i = 0; i < playerCount; i++) {
			const rating = ratings[i];
			const playerRating = preMatchRatings[i];

			let scoreSum = 0;
			let expectedSum = 0;
			let strictlyAhead = 0;
			let tiedWith = 0;
			for (let j = 0; j < playerCount; j++) {
				if (j === i) continue;
				const relative =
					effectiveScore[i] > effectiveScore[j]
						? 1
						: effectiveScore[i] < effectiveScore[j]
							? 0
							: 0.5;
				scoreSum += relative;
				expectedSum +=
					1 /
					(1 +
						Math.pow(
							10,
							(preMatchRatings[j] - playerRating) / ELO_SCALE,
						));
				if (relative === 1) strictlyAhead += 1;
				else if (relative === 0.5) tiedWith += 1;
			}

			const delta = Math.round(
				(ELO_K * (scoreSum - expectedSum)) / (playerCount - 1),
			);
			rating.rating = Math.max(0, playerRating + delta);

			// Win/loss/draw record from placement (P4): sole first is a win,
			// tied-for-first is a draw, anyone an opponent finished ahead of is a
			// loss — so a clear loser in a tie-for-first no longer records a draw.
			const opponentsAhead = playerCount - 1 - strictlyAhead - tiedWith;
			if (opponentsAhead > 0) rating.losses += 1;
			else if (tiedWith > 0) rating.draws += 1;
			else rating.wins += 1;

			await ratingRepo.save(rating);
		}
	}
}
