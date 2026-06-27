import {
	Controller,
	Get,
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
import { type BinderView, type PackResult } from "./cards.constants";
import { CardsService } from "./cards.service";

@ApiTags("cards")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("cards")
export class CardsController {
	constructor(
		private readonly cardsService: CardsService,
		private readonly usersService: UsersService,
	) {}

	/** GET /cards — the requesting player's binder (owned + locked + progress). */
	@Get()
	async binder(
		@Request() req: { user: { id: number } },
	): Promise<BinderView> {
		const user = await this.usersService.findById(req.user.id);
		if (!user) throw new UnauthorizedException();
		return this.cardsService.getBinder(user);
	}

	/** POST /cards/packs/open — spend coins to open one pack (CSRF-protected). */
	@Post("packs/open")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async openPack(
		@Request() req: { user: { id: number } },
	): Promise<PackResult> {
		const user = await this.usersService.findById(req.user.id);
		if (!user) throw new UnauthorizedException();
		return this.cardsService.openPack(user);
	}
}
