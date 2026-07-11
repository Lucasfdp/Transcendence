import {
	Controller,
	Get,
	Headers,
	HttpCode,
	Res,
	UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";
import { timingSafeEqual } from "crypto";
import { MetricsService } from "./metrics.service";

/**
 * GET /api/metrics — Prometheus text-format metrics endpoint.
 *
 * Security: requires `Authorization: Bearer <METRICS_TOKEN>` when METRICS_TOKEN
 * is set in the environment.  If METRICS_TOKEN is absent, the endpoint is
 * unprotected (acceptable in a dev-only environment, never in production).
 */
@Controller("metrics")
export class MetricsController {
	constructor(private readonly metricsService: MetricsService) {}

	@Get()
	@HttpCode(200)
	async getMetrics(
		@Headers("authorization") authHeader: string | undefined,
		@Res() res: Response,
	): Promise<void> {
		const token = this.metricsService.getMetricsToken();

		if (token !== undefined) {
			const provided =
				typeof authHeader === "string" &&
				authHeader.startsWith("Bearer ")
					? authHeader.slice(7)
					: undefined;

			if (!this.tokensMatch(provided, token)) {
				throw new UnauthorizedException(
					"Invalid or missing metrics token",
				);
			}
		}

		const [metrics, contentType] = await Promise.all([
			this.metricsService.getMetrics(),
			Promise.resolve(this.metricsService.getContentType()),
		]);

		res.setHeader("Content-Type", contentType).end(metrics);
	}

	/**
	 * Constant-time token comparison (D7). A plain `!==` check leaks timing
	 * information proportional to the number of matching leading bytes,
	 * which an attacker can use to brute-force the token character by
	 * character. `timingSafeEqual` requires equal-length buffers, so we
	 * guard the length mismatch case first (that branch is safe to be
	 * fast — it never depends on the token's actual content).
	 */
	private tokensMatch(
		provided: string | undefined,
		expected: string,
	): boolean {
		if (provided === undefined) {
			return false;
		}

		const providedBuffer = Buffer.from(provided);
		const expectedBuffer = Buffer.from(expected);

		if (providedBuffer.length !== expectedBuffer.length) {
			return false;
		}

		return timingSafeEqual(providedBuffer, expectedBuffer);
	}
}
