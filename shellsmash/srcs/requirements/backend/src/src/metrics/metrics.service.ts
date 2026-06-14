import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

const GUEST_POLL_INTERVAL_MS = 60_000;

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly registry: Registry;

  /** Exported so MetricsInterceptor can record per-request data. */
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status_code'>;
  readonly httpRequestDurationSeconds: Histogram<'method' | 'route'>;

  private readonly guestSessionsGauge: Gauge;
  private guestPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    this.registry = new Registry();

    // Default Node.js metrics: event loop lag, heap, GC, handles, etc.
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests processed',
      labelNames: ['method', 'route', 'status_code'] as const,
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route'] as const,
      // Balanced bucket spread for API latencies (5 ms → 10 s)
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.guestSessionsGauge = new Gauge({
      name: 'shellsmash_guest_sessions_total',
      help: 'Current number of active guest user accounts in the database',
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    // Initial poll immediately, then every 60 s
    void this.pollGuestSessions();
    this.guestPollTimer = setInterval(() => void this.pollGuestSessions(), GUEST_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.guestPollTimer !== null) {
      clearInterval(this.guestPollTimer);
      this.guestPollTimer = null;
    }
  }

  private async pollGuestSessions(): Promise<void> {
    try {
      const result = await this.dataSource.query<[{ count: string }]>(
        'SELECT COUNT(*) AS count FROM "users" WHERE "isGuest" = true',
      );
      this.guestSessionsGauge.set(Number(result[0]?.count ?? 0));
    } catch (err) {
      // Non-fatal: DB may still be initialising on first poll
      console.warn('[MetricsService] Guest session poll failed:', err);
    }
  }

  /** The METRICS_TOKEN required in the Authorization header. Undefined = no auth. */
  getMetricsToken(): string | undefined {
    return this.config.get<string>('METRICS_TOKEN') || undefined;
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
