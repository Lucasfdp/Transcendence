import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Globally registered interceptor that records per-request Prometheus metrics.
 *
 * Uses req.route?.path (the Express route template, e.g. "/users/:id") rather
 * than req.path to prevent high-cardinality label explosion from path params.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req   = context.switchToHttp().getRequest<Request>();
    const res   = context.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();
    const method = req.method;

    return next.handle().pipe(
      tap({
        next:  () => this.record(req, res, method, start),
        error: () => this.record(req, res, method, start),
      }),
    );
  }

  private record(
    req: Request,
    res: Response,
    method: string,
    start: bigint,
  ): void {
    const route = (req.route?.path as string | undefined) ?? req.path;
    const statusCode = String(res.statusCode);
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
}
