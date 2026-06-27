import {
	Body,
	Controller,
	HttpCode,
	Post,
	Request,
	UnauthorizedException,
	UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UsersService } from "../users/users.service";
import { GameResultsService, ProgressionResult } from "./game-results.service";
import { SubmitResultDto } from "./dto/submit-result.dto";

@ApiTags("game-results")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("game-results")
export class GameResultsController {
	constructor(
		private readonly gameResultsService: GameResultsService,
		private readonly usersService: UsersService,
	) {}

	/**
	 * POST /api/game-results
	 *
	 * Records the outcome of a completed game session for the authenticated user
	 * and returns the XP / coins / level-up delta so the frontend can animate
	 * the progression feedback.
	 *
	 * Guest users receive a zero-delta response — no DB writes are performed.
	 */
	@Post()
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async submitResult(
		@Request() req: { user: { id: number } },
		@Body() dto: SubmitResultDto,
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

		return this.gameResultsService.submitResult(user, dto);
	}
}
