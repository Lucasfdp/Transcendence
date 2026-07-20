import {
	Injectable,
	InternalServerErrorException,
	Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UserGameStats } from "../game-results/entities/user-game-stats.entity";
import { FriendsService } from "../friends/friends.service";
import { UserRating } from "../matchmaking/entities/user-rating.entity";
import { Tournament } from "../tournaments/entities/tournament.entity";

export interface GameLeaderboardEntry {
	rank: number;
	userId: number;
	username: string;
	turtleName: string | null;
	avatar: string | null;
	level: number;
	rating: number;
	wins: number;
	losses: number;
	draws: number;
}

export interface OverallLeaderboardEntry {
	rank: number;
	userId: number;
	username: string;
	turtleName: string | null;
	avatar: string | null;
	level: number;
	totalWins: number;
}

/** Tournament-championship entry: how many finished tournaments a user has won. */
export interface TournamentLeaderboardEntry {
	rank: number;
	userId: number;
	username: string;
	turtleName: string | null;
	avatar: string | null;
	level: number;
	tournamentWins: number;
}

export type LeaderboardScope = "global" | "friends";

const MAX_LEADERBOARD_ROWS = 100;

@Injectable()
export class LeaderboardService {
	private readonly logger = new Logger(LeaderboardService.name);

	constructor(
		@InjectRepository(UserRating)
		private readonly userRatingRepo: Repository<UserRating>,
		@InjectRepository(UserGameStats)
		private readonly userGameStatsRepo: Repository<UserGameStats>,
		@InjectRepository(Tournament)
		private readonly tournamentRepo: Repository<Tournament>,
		private readonly friendsService: FriendsService,
	) {}

	/**
	 * Returns ranked ELO standings for a specific game.
	 * Scope "friends" includes only accepted friends of callerId plus the
	 * caller themselves.
	 */
	async getGameLeaderboard(
		callerId: number,
		gameId: string,
		scope: LeaderboardScope,
	): Promise<GameLeaderboardEntry[]> {
		try {
			const qb = this.userRatingRepo
				.createQueryBuilder("ur")
				.innerJoin("ur.user", "u")
				.select([
					"ur.userId        AS \"userId\"",
					"u.username       AS username",
					"u.turtleName     AS \"turtleName\"",
					"u.avatar         AS avatar",
					"u.level          AS level",
					"ur.rating        AS rating",
					"ur.wins          AS wins",
					"ur.losses        AS losses",
					"ur.draws         AS draws",
				])
				.where("ur.gameId = :gameId", { gameId })
				.andWhere("u.isGuest = false")
				// Rankings Bug Audit L4: `isDevAccount` is a legacy flag from the
				// removed dev-login flow that no current code path sets — excluded
				// here defensively so a manually-flagged test/dev account can never
				// pollute the public board.
				.andWhere("u.isDevAccount = false")
				// Rankings Bug Audit N1 (2026-07-20): tournament CPU accounts are
				// real `users` rows whose match results persist — excluded so a
				// bot can never occupy a ranking position.
				.andWhere("u.isBot = false")
				// Rankings Bug Audit N3 (2026-07-20): a merged-away duplicate keeps
				// its pre-merge stats row; excluded so it can't occupy a second
				// board position under the canonical account's identity.
				.andWhere("u.mergedIntoUserId IS NULL")
				// Rankings Bug Audit M5: rating alone gives no stable order for
				// ties, so tied players could flip position between refreshes and
				// the LIMIT 100 cutoff would be arbitrary among a tie at #100.
				// Break ties by wins, then alphabetically for full determinism.
				.orderBy("ur.rating", "DESC")
				.addOrderBy("ur.wins", "DESC")
				.addOrderBy("u.username", "ASC")
				.limit(MAX_LEADERBOARD_ROWS);

			if (scope === "friends") {
				const friendIds = await this.friendsService.getFriendIds(callerId);
				// Always include the caller so they can see their own rank
				const allowedIds = [...new Set([callerId, ...friendIds])];
				qb.andWhere("ur.userId IN (:...allowedIds)", { allowedIds });
			}

			const rows = await qb.getRawMany<{
				userId: string;
				username: string;
				turtleName: string | null;
				avatar: string | null;
				level: string;
				rating: string;
				wins: string;
				losses: string;
				draws: string;
			}>();

			return rows.map((row, index) => ({
				rank: index + 1,
				userId: Number(row.userId),
				username: row.username,
				turtleName: row.turtleName ?? null,
				avatar: row.avatar ?? null,
				level: Number(row.level),
				rating: Number(row.rating),
				wins: Number(row.wins),
				losses: Number(row.losses),
				draws: Number(row.draws),
			}));
		} catch (err) {
			if (err instanceof InternalServerErrorException) throw err;
			// Rankings Bug Audit L2: the generic message below is all prod logs
			// would otherwise show — under H1, that's an indistinguishable
			// "Failed to fetch game leaderboard" whether the cause is a missing
			// table, a bad query, or a transient DB blip. Log the real error.
			this.logger.error(
				`getGameLeaderboard failed for gameId=${gameId}: ${
					err instanceof Error ? err.message : String(err)
				}`,
				err instanceof Error ? err.stack : undefined,
			);
			throw new InternalServerErrorException(
				"Failed to fetch game leaderboard",
			);
		}
	}

	/**
	 * Returns a cross-game leaderboard ranked by total wins across all games.
	 * Aggregates user_game_stats rows (which include both casual and ranked wins).
	 */
	async getOverallLeaderboard(
		callerId: number,
		scope: LeaderboardScope,
	): Promise<OverallLeaderboardEntry[]> {
		try {
			const qb = this.userGameStatsRepo
				.createQueryBuilder("ugs")
				.innerJoin("ugs.user", "u")
				.select([
					"u.id             AS \"userId\"",
					"u.username       AS username",
					"u.turtleName     AS \"turtleName\"",
					"u.avatar         AS avatar",
					"u.level          AS level",
					"SUM(ugs.totalWins) AS \"totalWins\"",
				])
				.where("u.isGuest = false")
				// Rankings Bug Audit L4: see getGameLeaderboard — same defensive
				// exclusion of the legacy dev-account flag.
				.andWhere("u.isDevAccount = false")
				// Rankings Bug Audit N1/N3 (2026-07-20): see getGameLeaderboard.
				.andWhere("u.isBot = false")
				.andWhere("u.mergedIntoUserId IS NULL")
				.groupBy("u.id")
				.addGroupBy("u.username")
				.addGroupBy("u.turtleName")
				.addGroupBy("u.avatar")
				.addGroupBy("u.level")
				// Rankings Bug Audit M5: stable tie-break, mirroring getGameLeaderboard.
				.orderBy("\"totalWins\"", "DESC")
				.addOrderBy("u.level", "DESC")
				.addOrderBy("u.username", "ASC")
				.limit(MAX_LEADERBOARD_ROWS);

			if (scope === "friends") {
				const friendIds = await this.friendsService.getFriendIds(callerId);
				const allowedIds = [...new Set([callerId, ...friendIds])];
				qb.andWhere("u.id IN (:...allowedIds)", { allowedIds });
			}

			const rows = await qb.getRawMany<{
				userId: string;
				username: string;
				turtleName: string | null;
				avatar: string | null;
				level: string;
				totalWins: string;
			}>();

			return rows.map((row, index) => ({
				rank: index + 1,
				userId: Number(row.userId),
				username: row.username,
				turtleName: row.turtleName ?? null,
				avatar: row.avatar ?? null,
				level: Number(row.level),
				totalWins: Number(row.totalWins),
			}));
		} catch (err) {
			if (err instanceof InternalServerErrorException) throw err;
			this.logger.error(
				`getOverallLeaderboard failed for callerId=${callerId}: ${
					err instanceof Error ? err.message : String(err)
				}`,
				err instanceof Error ? err.stack : undefined,
			);
			throw new InternalServerErrorException(
				"Failed to fetch overall leaderboard",
			);
		}
	}

	/**
	 * Rankings Bug Audit §5.1 (2026-07-20): a separate tournament-wins board,
	 * ranked by how many "The Parrot's Shell" tournaments a user has won.
	 * Source of truth is `tournaments.winnerUserId`, written durably once a
	 * tournament reaches VICTORY (`tournament-runtime.service.ts`); a
	 * collective DEFEAT leaves it null and is correctly excluded below.
	 */
	async getTournamentLeaderboard(
		callerId: number,
		scope: LeaderboardScope,
	): Promise<TournamentLeaderboardEntry[]> {
		try {
			const qb = this.tournamentRepo
				.createQueryBuilder("t")
				.innerJoin("t.winnerUser", "u")
				.select([
					"u.id             AS \"userId\"",
					"u.username       AS username",
					"u.turtleName     AS \"turtleName\"",
					"u.avatar         AS avatar",
					"u.level          AS level",
					"COUNT(*)         AS \"tournamentWins\"",
				])
				.where("t.status = :status", { status: "finished" })
				.andWhere("t.winnerUserId IS NOT NULL")
				.andWhere("u.isGuest = false")
				.andWhere("u.isDevAccount = false")
				// Rankings Bug Audit N1: a CPU can technically win a tournament —
				// excluded here for the same reason as the other two boards.
				.andWhere("u.isBot = false")
				// Rankings Bug Audit N3: see getGameLeaderboard.
				.andWhere("u.mergedIntoUserId IS NULL")
				.groupBy("u.id")
				.addGroupBy("u.username")
				.addGroupBy("u.turtleName")
				.addGroupBy("u.avatar")
				.addGroupBy("u.level")
				// Rankings Bug Audit M5: stable tie-break, mirroring the other boards.
				.orderBy("\"tournamentWins\"", "DESC")
				.addOrderBy("u.level", "DESC")
				.addOrderBy("u.username", "ASC")
				.limit(MAX_LEADERBOARD_ROWS);

			if (scope === "friends") {
				const friendIds = await this.friendsService.getFriendIds(callerId);
				const allowedIds = [...new Set([callerId, ...friendIds])];
				qb.andWhere("u.id IN (:...allowedIds)", { allowedIds });
			}

			const rows = await qb.getRawMany<{
				userId: string;
				username: string;
				turtleName: string | null;
				avatar: string | null;
				level: string;
				tournamentWins: string;
			}>();

			return rows.map((row, index) => ({
				rank: index + 1,
				userId: Number(row.userId),
				username: row.username,
				turtleName: row.turtleName ?? null,
				avatar: row.avatar ?? null,
				level: Number(row.level),
				tournamentWins: Number(row.tournamentWins),
			}));
		} catch (err) {
			if (err instanceof InternalServerErrorException) throw err;
			this.logger.error(
				`getTournamentLeaderboard failed for callerId=${callerId}: ${
					err instanceof Error ? err.message : String(err)
				}`,
				err instanceof Error ? err.stack : undefined,
			);
			throw new InternalServerErrorException(
				"Failed to fetch tournament leaderboard",
			);
		}
	}
}
