import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import {
	Counter,
	Gauge,
	Histogram,
	Registry,
	collectDefaultMetrics,
} from "prom-client";

const GUEST_POLL_INTERVAL_MS = 60_000;

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(MetricsService.name);
	private readonly registry: Registry;

	/** Exported so MetricsInterceptor can record per-request data. */
	readonly httpRequestsTotal: Counter<"method" | "route" | "status_code">;
	readonly httpRequestDurationSeconds: Histogram<"method" | "route">;

	private readonly guestSessionsGauge: Gauge;
	private guestPollTimer: ReturnType<typeof setInterval> | null = null;

	// ── Matchmaking / real-time simulation metrics ────────────────────────────
	private readonly arenaTickDurationSeconds: Histogram;
	private readonly activeRoomsGauge: Gauge;
	private readonly replayFramesGauge: Gauge;
	private readonly droppedCatchUpStepsTotal: Counter;

	constructor(
		private readonly config: ConfigService,
		@InjectDataSource() private readonly dataSource: DataSource,
	) {
		this.registry = new Registry();

		// Default Node.js metrics: event loop lag, heap, GC, handles, etc.
		collectDefaultMetrics({ register: this.registry });

		this.httpRequestsTotal = new Counter({
			name: "http_requests_total",
			help: "Total number of HTTP requests processed",
			labelNames: ["method", "route", "status_code"] as const,
			registers: [this.registry],
		});

		this.httpRequestDurationSeconds = new Histogram({
			name: "http_request_duration_seconds",
			help: "HTTP request duration in seconds",
			labelNames: ["method", "route"] as const,
			// Balanced bucket spread for API latencies (5 ms → 10 s)
			buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
			registers: [this.registry],
		});

		// Named without a "_total" suffix: this is a Gauge (current count that
		// can go up or down), not a Counter. The "_total" suffix is a
		// Prometheus naming convention reserved for monotonically increasing
		// counters and trips promtool lint otherwise (D9).
		this.guestSessionsGauge = new Gauge({
			name: "shellsmash_guest_sessions",
			help: "Current number of active guest user accounts in the database",
			registers: [this.registry],
		});

		// Real-time simulation observability (converts the matchmaking capacity
		// findings from speculation into graphs): how long the 30 Hz fixed-step
		// loop takes, how many rooms/replay frames are live, and how often the
		// catch-up loop saturates (a proxy for the server clock falling behind
		// wall clock — R7).
		this.arenaTickDurationSeconds = new Histogram({
			name: "shellsmash_arena_tick_duration_seconds",
			help: "Duration of one arena fixed-step simulation pass in seconds",
			// Sub-millisecond to ~100 ms: a pass should be well under one 33 ms tick.
			buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.033, 0.05, 0.1],
			registers: [this.registry],
		});
		this.activeRoomsGauge = new Gauge({
			name: "shellsmash_active_rooms",
			help: "Current number of active match rooms being simulated",
			registers: [this.registry],
		});
		this.replayFramesGauge = new Gauge({
			name: "shellsmash_replay_frames",
			help: "Total replay frames buffered in memory across active rooms",
			registers: [this.registry],
		});
		this.droppedCatchUpStepsTotal = new Counter({
			name: "shellsmash_arena_dropped_catchup_steps_total",
			help: "Fixed-step catch-up steps dropped because the loop saturated",
			registers: [this.registry],
		});
	}

	/** Record one arena fixed-step pass duration (seconds). */
	observeArenaTick(seconds: number): void {
		this.arenaTickDurationSeconds.observe(seconds);
	}

	/** Set the current active-room and buffered-replay-frame gauges. */
	setSimulationGauges(activeRooms: number, replayFrames: number): void {
		this.activeRoomsGauge.set(activeRooms);
		this.replayFramesGauge.set(replayFrames);
	}

	/** Count catch-up steps the fixed-step loop had to drop under load. */
	incDroppedCatchUpSteps(count: number): void {
		if (count > 0) this.droppedCatchUpStepsTotal.inc(count);
	}

	onModuleInit(): void {
		// Initial poll immediately, then every 60 s
		void this.pollGuestSessions();
		this.guestPollTimer = setInterval(
			() => void this.pollGuestSessions(),
			GUEST_POLL_INTERVAL_MS,
		);
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
			this.logger.warn(`Guest session poll failed: ${String(err)}`);
		}
	}

	/** The METRICS_TOKEN required in the Authorization header. Undefined = no auth. */
	getMetricsToken(): string | undefined {
		return this.config.get<string>("METRICS_TOKEN") || undefined;
	}

	async getMetrics(): Promise<string> {
		return this.registry.metrics();
	}

	getContentType(): string {
		return this.registry.contentType;
	}
}
