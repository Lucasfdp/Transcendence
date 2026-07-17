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
}
