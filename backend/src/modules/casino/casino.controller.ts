import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpException,
	Post,
	Param,
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
	type CasinoGame,
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
import {
	type MonteRoundResolveResult,
	type MonteRoundStartResult,
	type MonteRoundStepsResult,
} from "./monte-round.constants";
import { MonteRoundService } from "./monte-round.service";
import { MonteService } from "./monte.service";
import { type PlinkoView } from "./plinko.constants";
import { PlinkoService } from "./plinko.service";
import { type SlotsView } from "./slots.constants";
import { SlotsService } from "./slots.service";
import { DiceDto } from "./dto/dice.dto";
import { FlipDto } from "./dto/flip.dto";
import {
	ResolveMonteRoundDto,
	StartMonteRoundDto,
} from "./dto/monte-round.dto";
import { PlinkoDto } from "./dto/plinko.dto";
import { SlotsSpinDto } from "./dto/slots.dto";
import { FreeSpinDto, SpinDto } from "./dto/spin.dto";

/** Authenticated request: JwtAuthGuard attaches the decoded user. */
type AuthedRequest = ExpressRequest & { user: { id: number } };

/**
 * Spin rate-limit bucket: a generous cap to stop scripted spamming.
 *
 * Bug Audit 2.1: this used to be a single bucket shared across all six games,
 * keyed by client IP (`rateLimiter.allow`). Two failure modes followed: (1) a
 * single engaged player could exceed it alone — Koi Dice's ~1.65s animation
 * alone reaches ~36 rolls/min, and the shared bucket aggregated across every
 * game, so alternating games got there even faster than one game could; (2)
 * keying by IP meant every player behind one NAT (a campus, or any shared
 * egress) shared one bucket — one player's spins could starve everyone
 * else's. Fixed by keying on the authenticated user id (`allowKey`, exactly
 * what it exists for — see its own doc) with a per-game bucket suffix, so one
 * fast game can no longer starve the others, and a slightly higher ceiling
 * that comfortably covers every game's fastest reachable rate.
 */
const SPIN_BUCKET = "casino-spin";
const SPIN_MAX_PER_WINDOW = 40;
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
		private readonly monteRoundService: MonteRoundService,
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
		this.enforceSpinRate(req, "wheel");
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
		this.enforceSpinRate(req, "wheel");
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
		this.enforceSpinRate(req, "flip");
		const user = await this.requireUser(req);
		return this.flipService.flip(user, dto.pick, dto.stake, {
			clientSeed: dto.clientSeed,
		});
	}

	/**
	 * GET /casino/monte — Three-Shell Monte tiers, RTP, bounds and balance, plus
	 * any round already in progress so a reloaded client can resume it instead of
	 * forfeiting its already-debited stake to the TTL.
	 */
	@Get("monte")
	async monteConfig(@Request() req: AuthedRequest): Promise<MonteConfig> {
		const user = await this.requireUser(req);
		const config = this.monteService.getMonteConfig(user);
		const activeRound = await this.monteRoundService.getActiveRound(user);
		return { ...config, activeRound };
	}

	/** POST /casino/monte/rounds — start a committed round (CSRF-protected). */
	@Post("monte/rounds")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async startMonteRound(
		@Request() req: AuthedRequest,
		@Body() dto: StartMonteRoundDto,
	): Promise<MonteRoundStartResult> {
		this.enforceSpinRate(req, "monte");
		const user = await this.requireUser(req);
		return this.monteRoundService.startRound(
			user,
			dto.stake,
			dto.clientSeed ?? "",
		);
	}

	/**
	 * GET /casino/monte/rounds/:roundId/steps — just-in-time swap delivery.
	 *
	 * Read-only and idempotent, so it's outside the spin throttle (the client
	 * polls it a handful of times per round while the shuffle animates). The
	 * service returns only the swaps whose scheduled time has elapsed, so the
	 * winning slot can't be precomputed from an early call.
	 */
	@Get("monte/rounds/:roundId/steps")
	async monteRoundSteps(
		@Request() req: AuthedRequest,
		@Param("roundId") roundId: string,
	): Promise<MonteRoundStepsResult> {
		const user = await this.requireUser(req);
		return this.monteRoundService.getSteps(user, roundId);
	}

	/** POST /casino/monte/rounds/:roundId/resolve — settle a slot choice. */
	@Post("monte/rounds/:roundId/resolve")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	async resolveMonteRound(
		@Request() req: AuthedRequest,
		@Param("roundId") roundId: string,
		@Body() dto: ResolveMonteRoundDto,
	): Promise<MonteRoundResolveResult> {
		this.enforceSpinRate(req, "monte");
		const user = await this.requireUser(req);
		return this.monteRoundService.resolveRound(
			user,
			roundId,
			dto.selectedSlot,
		);
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
		this.enforceSpinRate(req, "slots");
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
		this.enforceSpinRate(req, "dice");
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
		this.enforceSpinRate(req, "drop");
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

	/**
	 * Throttle spins per authenticated player, one bucket per game so a fast
	 * game (e.g. Koi Dice) can't starve the others (Bug Audit 2.1). JwtAuthGuard
	 * has already populated `req.user.id` by the time this runs. Throws 429
	 * when the window is exceeded.
	 */
	private enforceSpinRate(req: AuthedRequest, game: CasinoGame): void {
		if (
			!this.rateLimiter.allowKey(
				`${SPIN_BUCKET}:${game}`,
				String(req.user.id),
				SPIN_MAX_PER_WINDOW,
				SPIN_WINDOW_MS,
			)
		) {
			throw tooManyRequests();
		}
	}
}
