import {
	Controller,
	Get,
	Query,
	Request,
	UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiQuery, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
	GameLeaderboardEntry,
	LeaderboardScope,
	LeaderboardService,
	OverallLeaderboardEntry,
} from "./leaderboard.service";

@ApiTags("leaderboard")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("leaderboard")
export class LeaderboardController {
	constructor(private readonly leaderboardService: LeaderboardService) {}

	/**
	 * GET /api/leaderboard?gameId=shell-curl&scope=global
	 *
	 * Returns ELO standings for a single game, ranked highest rating first.
	 * scope=friends limits results to accepted friends of the caller + caller.
	 */
	@Get()
	@ApiQuery({ name: "gameId", required: true })
	@ApiQuery({ name: "scope", enum: ["global", "friends"], required: false })
	getGameLeaderboard(
		@Request() req: { user: { id: number } },
		@Query("gameId") gameId: string,
		@Query("scope") scope: string = "global",
	): Promise<GameLeaderboardEntry[]> {
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
}
