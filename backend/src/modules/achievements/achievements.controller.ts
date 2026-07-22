import {
	Controller,
	Get,
	Request,
	UnauthorizedException,
	UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UsersService } from "../users/users.service";
import { AchievementView } from "./achievements.constants";
import { AchievementsService } from "./achievements.service";

@ApiTags("achievements")
@ApiCookieAuth("auth-cookie")
@UseGuards(JwtAuthGuard)
@Controller("achievements")
export class AchievementsController {
	constructor(
		private readonly achievementsService: AchievementsService,
		private readonly usersService: UsersService,
	) {}

	@Get()
	async list(
		@Request() req: { user: { id: number } },
	): Promise<AchievementView[]> {
		const user = await this.usersService.findById(req.user.id);
		if (!user) throw new UnauthorizedException();
		return this.achievementsService.listForUser(user);
	}
}
