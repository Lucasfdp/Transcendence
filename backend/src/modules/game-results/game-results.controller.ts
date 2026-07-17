import {
	Body,
	Controller,
	HttpCode,
	HttpException,
	Post,
	Request,
	UnauthorizedException,
	UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { UsersService } from "../users/users.service";
import { GameResultsService, ProgressionResult } from "./game-results.service";
import { SubmitLocalResultDto } from "./dto/submit-local-result.dto";

/** Portable 429 — mirrors the helper in auth/chat/reports controllers. */
const TooManyRequests = (msg: string): HttpException => new HttpException(msg, 429);

/**
 * Per-user cap on client-reported match completions. Local play submits one
 * result per finished game, so a real player cannot plausibly exceed this —
 * it only bounds an automated loop hitting the endpoint (Rankings Bug
 * Audit H2).
 */
const GAME_RESULT_RATE_LIMIT_MAX = 20;
const GAME_RESULT_RATE_LIMIT_WINDOW_MS = 60_000;

@ApiTags("game-results")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("game-results")
export class GameResultsController {
	constructor(
		private readonly gameResultsService: GameResultsService,
		private readonly usersService: UsersService,
		private readonly rateLimiter: RateLimiterService,
	) {}

	/**
	 * POST /api/game-results
	 *
	 * Records the outcome of a completed local-play game session for the
	 * authenticated user and returns the XP / coins / level-up delta so the
	 * frontend can animate the progression feedback.
	 *
	 * Rankings Bug Audit H2: this body is `SubmitLocalResultDto`, not the
	 * broader `SubmitResultDto` win/loss/draw/completed shape
	 * `GameResultsService.submitResult` otherwise accepts — a client can only
	 * ever report `outcome: "completed"` here. Server-authoritative online
	 * matches report win/loss/draw by calling `submitResult()` directly from
	 * `GameSessionService`, bypassing this HTTP surface entirely, so
	 * win/loss/draw counters (and the leaderboard's `totalWins` ranking they
	 * feed) can never be forged by a client loop against this endpoint.
	 *
	 * Guest users receive a zero-delta response — no DB writes are performed.
	 */
	@Post()
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async submitResult(
		@Request() req: { user: { id: number } },
		@Body() dto: SubmitLocalResultDto,
	): Promise<ProgressionResult> {
		const user = await this.usersService.findById(req.user.id);
		if (!user) throw new UnauthorizedException();

		if (user.isGuest) {
			return {
				xpGained: 0,
				coinsGained: 0,
				newXp: 0,
				newLevel: 1,
				newCoins: 0,
				leveledUp: false,
				unlockedAchievements: [],
				cardDrop: null,
			};
		}

		if (
			!this.rateLimiter.allowKey(
				"game-result",
				String(req.user.id),
				GAME_RESULT_RATE_LIMIT_MAX,
				GAME_RESULT_RATE_LIMIT_WINDOW_MS,
			)
		) {
			throw TooManyRequests(
				"Too many game results submitted — try again shortly.",
			);
		}

		return this.gameResultsService.submitResult(user, dto);
	}
}
