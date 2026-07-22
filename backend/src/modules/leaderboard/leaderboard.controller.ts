import {
	BadRequestException,
	Controller,
	Get,
	Query,
	Request,
	UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiQuery, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { KNOWN_GAME_IDS } from "../game-results/game-ids.constants";
import {
	GameLeaderboardEntry,
	LeaderboardScope,
	LeaderboardService,
	OverallLeaderboardEntry,
	TournamentLeaderboardEntry,
} from "./leaderboard.service";

@ApiTags("leaderboard")
@ApiCookieAuth("auth-cookie")
@UseGuards(JwtAuthGuard)
@Controller("leaderboard")
export class LeaderboardController {
	constructor(private readonly leaderboardService: LeaderboardService) {}

	/**
	 * GET /api/leaderboard?gameId=temple-curling&scope=global
	 *
	 * Returns ELO standings for a single game, ranked highest rating first.
	 * scope=friends limits results to accepted friends of the caller + caller.
	 */
	@Get()
	@ApiQuery({ name: "gameId", required: true, enum: KNOWN_GAME_IDS })
	@ApiQuery({ name: "scope", enum: ["global", "friends"], required: false })
	getGameLeaderboard(
		@Request() req: { user: { id: number } },
		@Query("gameId") gameId: string,
		@Query("scope") scope: string = "global",
	): Promise<GameLeaderboardEntry[]> {
		// Rankings Bug Audit M1: an absent `gameId` used to reach the service
		// and bind `undefined` into the query builder, which TypeORM throws on
		// — surfaced to the client as a generic 500 instead of a 400. A
		// present-but-unrecognized id used to silently return `[]`, which is
		// harmless but indistinguishable from a genuinely empty board and
		// masks `gameId` drift between this API and the frontend's
		// `RANKED_GAMES` list. Validate against the shared, single-source-of-
		// truth game id list so both cases become an explicit 400.
		if (
			!gameId ||
			!KNOWN_GAME_IDS.includes(gameId as (typeof KNOWN_GAME_IDS)[number])
		) {
			throw new BadRequestException(
				`gameId is required and must be one of: ${KNOWN_GAME_IDS.join(", ")}`,
			);
		}
		const resolvedScope: LeaderboardScope =
			scope === "friends" ? "friends" : "global";
		return this.leaderboardService.getGameLeaderboard(
			req.user.id,
			gameId,
			resolvedScope,
		);
	}

	/**
	 * GET /api/leaderboard/overall?scope=global
	 *
	 * Returns a cross-game leaderboard ranked by total wins across all games
	 * (casual + ranked, including private lobby matches).
	 */
	@Get("overall")
	@ApiQuery({ name: "scope", enum: ["global", "friends"], required: false })
	getOverallLeaderboard(
		@Request() req: { user: { id: number } },
		@Query("scope") scope: string = "global",
	): Promise<OverallLeaderboardEntry[]> {
		const resolvedScope: LeaderboardScope =
			scope === "friends" ? "friends" : "global";
		return this.leaderboardService.getOverallLeaderboard(
			req.user.id,
			resolvedScope,
		);
	}

	/**
	 * GET /api/leaderboard/tournaments?scope=global
	 *
	 * Rankings Bug Audit §5.1: a separate board ranked by finished
	 * "The Parrot's Shell" tournament wins (`tournaments.winnerUserId`),
	 * distinct from the per-match Total/per-game boards above.
	 */
	@Get("tournaments")
	@ApiQuery({ name: "scope", enum: ["global", "friends"], required: false })
	getTournamentLeaderboard(
		@Request() req: { user: { id: number } },
		@Query("scope") scope: string = "global",
	): Promise<TournamentLeaderboardEntry[]> {
		const resolvedScope: LeaderboardScope =
			scope === "friends" ? "friends" : "global";
		return this.leaderboardService.getTournamentLeaderboard(
			req.user.id,
			resolvedScope,
		);
	}
}
