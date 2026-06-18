import {
	Controller,
	Get,
	Headers,
	HttpCode,
	Res,
	UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";
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

			if (provided !== token) {
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
}
