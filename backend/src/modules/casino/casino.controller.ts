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
import {
	type SpinResolution,
	type SpinResult,
	type WheelView,
} from "./casino.constants";
import { CasinoService } from "./casino.service";
import { type DiceConfig } from "./dice.constants";
import { DiceService } from "./dice.service";
import { type FlipConfig } from "./flip.constants";
import { FlipService } from "./flip.service";
import { type MonteConfig } from "./monte.constants";
import { MonteService } from "./monte.service";
import { type PlinkoView } from "./plinko.constants";
import { PlinkoService } from "./plinko.service";
import { type SlotsView } from "./slots.constants";
import { SlotsService } from "./slots.service";
import { DiceDto } from "./dto/dice.dto";
import { FlipDto } from "./dto/flip.dto";
import { MonteDto } from "./dto/monte.dto";
import { PlinkoDto } from "./dto/plinko.dto";
import { SlotsSpinDto } from "./dto/slots.dto";
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
		private readonly flipService: FlipService,
		private readonly monteService: MonteService,
		private readonly slotsService: SlotsService,
		private readonly diceService: DiceService,
		private readonly plinkoService: PlinkoService,
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

	/** GET /casino/flip — Shell Flip multiplier, RTP, bounds and balance. */
	@Get("flip")
	async flipConfig(@Request() req: AuthedRequest): Promise<FlipConfig> {
		const user = await this.requireUser(req);
		return this.flipService.getFlipConfig(user);
	}

	/** POST /casino/flip — call a shell side and stake coins (CSRF-protected). */
	@Post("flip")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async flip(
		@Request() req: AuthedRequest,
		@Body() dto: FlipDto,
	): Promise<SpinResolution> {
		this.enforceSpinRate(req);
		const user = await this.requireUser(req);
		return this.flipService.flip(user, dto.pick, dto.stake, {
			clientSeed: dto.clientSeed,
		});
	}

	/** GET /casino/monte — Three-Shell Monte tiers, RTP, bounds and balance. */
	@Get("monte")
	async monteConfig(@Request() req: AuthedRequest): Promise<MonteConfig> {
		const user = await this.requireUser(req);
		return this.monteService.getMonteConfig(user);
	}

	/** POST /casino/monte — guess a shell and stake coins (CSRF-protected). */
	@Post("monte")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async monte(
		@Request() req: AuthedRequest,
		@Body() dto: MonteDto,
	): Promise<SpinResolution> {
		this.enforceSpinRate(req);
		const user = await this.requireUser(req);
		return this.monteService.monte(user, dto.pick, dto.shells, dto.stake, {
			clientSeed: dto.clientSeed,
		});
	}

	/** GET /casino/slots — reel, paytable, RTP, bounds and balance. */
	@Get("slots")
	async slotsView(@Request() req: AuthedRequest): Promise<SlotsView> {
		const user = await this.requireUser(req);
		return this.slotsService.getSlotsView(user);
	}

	/** POST /casino/slots — stake coins and spin the reels (CSRF-protected). */
	@Post("slots")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async slots(
		@Request() req: AuthedRequest,
		@Body() dto: SlotsSpinDto,
	): Promise<SpinResolution> {
		this.enforceSpinRate(req);
		const user = await this.requireUser(req);
		return this.slotsService.slots(user, dto.stake, {
			clientSeed: dto.clientSeed,
		});
	}

	/** GET /casino/dice — Koi Dice range, target bounds, wager bounds and balance. */
	@Get("dice")
	async diceConfig(@Request() req: AuthedRequest): Promise<DiceConfig> {
		const user = await this.requireUser(req);
		return this.diceService.getDiceConfig(user);
	}

	/** POST /casino/dice — call a direction/target and stake coins (CSRF-protected). */
	@Post("dice")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async dice(
		@Request() req: AuthedRequest,
		@Body() dto: DiceDto,
	): Promise<SpinResolution> {
		this.enforceSpinRate(req);
		const user = await this.requireUser(req);
		return this.diceService.dice(user, dto.direction, dto.target, dto.stake, {
			clientSeed: dto.clientSeed,
		});
	}

	/** GET /casino/plinko — Shell Drop row tiers, paytables, bounds and balance. */
	@Get("plinko")
	async plinkoView(@Request() req: AuthedRequest): Promise<PlinkoView> {
		const user = await this.requireUser(req);
		return this.plinkoService.getPlinkoView(user);
	}

	/** POST /casino/plinko — pick a risk tier and stake coins (CSRF-protected). */
	@Post("plinko")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async plinko(
		@Request() req: AuthedRequest,
		@Body() dto: PlinkoDto,
	): Promise<SpinResolution> {
		this.enforceSpinRate(req);
		const user = await this.requireUser(req);
		return this.plinkoService.drop(user, dto.rows, dto.stake, {
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
