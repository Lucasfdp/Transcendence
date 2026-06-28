import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpException,
	Post,
	Request,
	UnauthorizedException,
	UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request as ExpressRequest } from "express";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RateLimiterService } from "../auth/rate-limiter.service";
import type { User } from "../users/entities/user.entity";
import { UsersService } from "../users/users.service";
import { type SpinResult, type WheelView } from "./casino.constants";
import { CasinoService } from "./casino.service";
import { FreeSpinDto, SpinDto } from "./dto/spin.dto";

/** Authenticated request: JwtAuthGuard attaches the decoded user. */
type AuthedRequest = ExpressRequest & { user: { id: number } };

/** Spin rate-limit bucket: a generous cap to stop scripted spamming. */
const SPIN_BUCKET = "casino-spin";
const SPIN_MAX_PER_WINDOW = 30;
const SPIN_WINDOW_MS = 60_000;

/** Portable 429 — TooManyRequestsException is absent in this NestJS version. */
const tooManyRequests = (): HttpException =>
	new HttpException("Too many spins — slow down.", 429);

@ApiTags("casino")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("casino")
export class CasinoController {
	constructor(
		private readonly casinoService: CasinoService,
		private readonly usersService: UsersService,
		private readonly rateLimiter: RateLimiterService,
	) {}

	/** GET /casino/wheel — layout, odds, bounds, balance, free-spin availability. */
	@Get("wheel")
	async wheel(@Request() req: AuthedRequest): Promise<WheelView> {
		const user = await this.requireUser(req);
		return this.casinoService.getWheelView(user);
	}

	/** POST /casino/wheel/free — take the daily free spin (CSRF-protected). */
	@Post("wheel/free")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async freeSpin(
		@Request() req: AuthedRequest,
		@Body() dto: FreeSpinDto,
	): Promise<SpinResult> {
		this.enforceSpinRate(req);
		const user = await this.requireUser(req);
		return this.casinoService.freeSpin(user, { clientSeed: dto.clientSeed });
	}

	/** POST /casino/wheel/spin — stake coins on a wagered spin (CSRF-protected). */
	@Post("wheel/spin")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async spin(
		@Request() req: AuthedRequest,
		@Body() dto: SpinDto,
	): Promise<SpinResult> {
		this.enforceSpinRate(req);
		const user = await this.requireUser(req);
		return this.casinoService.wageredSpin(user, dto.stake, {
			clientSeed: dto.clientSeed,
		});
	}

	/** Resolve the authenticated player or reject the request. */
	private async requireUser(req: AuthedRequest): Promise<User> {
		const user = await this.usersService.findById(req.user.id);
		if (!user) throw new UnauthorizedException();
		return user;
	}

	/** Throttle spins per client IP; throws 429 when the window is exceeded. */
	private enforceSpinRate(req: AuthedRequest): void {
		if (
			!this.rateLimiter.allow(
				req,
				SPIN_BUCKET,
				SPIN_MAX_PER_WINDOW,
				SPIN_WINDOW_MS,
			)
		) {
			throw tooManyRequests();
		}
	}
}
