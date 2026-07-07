import {
	Body,
	Controller,
	HttpCode,
	HttpException,
	Post,
	Request,
	UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { CreateReportDto } from "./dto/create-report.dto";
import { ReportsService } from "./reports.service";

/** Portable 429 — mirrors the helper in auth/chat controllers. */
const TooManyRequests = (msg: string): HttpException => new HttpException(msg, 429);

/**
 * Per-user cap on reports. Reports have no dedup at the DB level (a user may
 * legitimately re-report after unblocking), so a per-user rate window is what
 * stops a flood of duplicate reports against the same target (Bug Audit M7).
 */
const REPORT_RATE_LIMIT_MAX = 10;
const REPORT_RATE_LIMIT_WINDOW_MS = 60_000;

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("reports")
export class ReportsController {
	constructor(
		private readonly reportsService: ReportsService,
		private readonly rateLimiter: RateLimiterService,
	) {}

	/** POST /api/reports — report a user (auto-blocks them). */
	@Post()
	@HttpCode(200)
	async create(
		@Request() req: { user: { id: number } },
		@Body() body: CreateReportDto,
	): Promise<{ ok: boolean }> {
		if (
			!this.rateLimiter.allowKey(
				"report",
				String(req.user.id),
				REPORT_RATE_LIMIT_MAX,
				REPORT_RATE_LIMIT_WINDOW_MS,
			)
		) {
			throw TooManyRequests("Too many reports — try again shortly.");
		}
		await this.reportsService.create(
			req.user.id,
			body.reportedId,
			body.category,
			body.message,
		);
		return { ok: true };
	}
}
