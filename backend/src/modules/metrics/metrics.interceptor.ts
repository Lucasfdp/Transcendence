import {
	CallHandler,
	ExecutionContext,
	HttpException,
	Injectable,
	NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import type { Request, Response } from "express";
import { MetricsService } from "./metrics.service";

/** Label used for the route dimension when Express has no matched route
 * template (e.g. requests that never reach a controller). Using a constant
 * instead of the raw path prevents unbounded label cardinality (D8). */
const UNMATCHED_ROUTE_LABEL = "unmatched";

/**
 * Globally registered interceptor that records per-request Prometheus metrics.
 *
 * Uses req.route?.path (the Express route template, e.g. "/users/:id") rather
 * than req.path to prevent high-cardinality label explosion from path params.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
	constructor(private readonly metricsService: MetricsService) {}

	intercept(
		context: ExecutionContext,
		next: CallHandler,
	): Observable<unknown> {
		if (context.getType() !== "http") {
			return next.handle();
		}

		const req = context.switchToHttp().getRequest<Request>();
		const res = context.switchToHttp().getResponse<Response>();
		const start = process.hrtime.bigint();
		const method = req.method;

		return next.handle().pipe(
			tap({
				next: () => this.record(req, res, method, start),
				// At this point NestJS's exception filter has NOT run yet, so
				// res.statusCode is still the pre-exception default (200).
				// Derive the real status from the thrown error instead (D2).
				error: (err: unknown) =>
					this.record(req, res, method, start, err),
			}),
		);
	}

	private record(
		req: Request,
		res: Response,
		method: string,
		start: bigint,
		error?: unknown,
	): void {
		const route =
			(req.route?.path as string | undefined) ?? UNMATCHED_ROUTE_LABEL;
		const statusCode = String(this.resolveStatusCode(res, error));
		const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;

		this.metricsService.httpRequestsTotal.inc({
			method,
			route,
			status_code: statusCode,
		});
		this.metricsService.httpRequestDurationSeconds.observe(
			{ method, route },
			durationSeconds,
		);
	}

	private resolveStatusCode(res: Response, error: unknown): number {
		if (error === undefined) {
			return res.statusCode;
		}
		return error instanceof HttpException ? error.getStatus() : 500;
	}
}
