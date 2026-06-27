import { Injectable, InternalServerErrorException } from "@nestjs/common";
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
				.orderBy("ur.rating", "DESC")
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
				.groupBy("u.id")
				.addGroupBy("u.username")
				.addGroupBy("u.turtleName")
				.addGroupBy("u.avatar")
				.addGroupBy("u.level")
				.orderBy("\"totalWins\"", "DESC")
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
			throw new InternalServerErrorException(
				"Failed to fetch overall leaderboard",
			);
		}
	}
}
