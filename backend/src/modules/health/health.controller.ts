import { Controller, Get } from "@nestjs/common";
import {
	HealthCheck,
	HealthCheckResult,
	HealthCheckService,
	TypeOrmHealthIndicator,
} from "@nestjs/terminus";
import { RedisHealthIndicator } from "./redis.health";

/**
 * GET /api/health
 *
 * Returns 200 when both PostgreSQL and Redis are reachable, 503 otherwise.
 * This endpoint is used by the Docker HEALTHCHECK in the backend Dockerfile.
 *
 * Response shape (200):
 *   { status: 'ok', info: { database: { status: 'up' }, redis: { status: 'up' } }, ... }
 *
 * Response shape (503):
 *   { status: 'error', error: { redis: { status: 'down', message: '...' } }, ... }
 */
@Controller("health")
export class HealthController {
	constructor(
		private readonly health: HealthCheckService,
		private readonly db: TypeOrmHealthIndicator,
		private readonly redis: RedisHealthIndicator,
	) {}

	@Get()
	@HealthCheck()
	check(): Promise<HealthCheckResult> {
		return this.health.check([
			() => this.db.pingCheck("database"),
			() => this.redis.pingCheck("redis"),
		]);
	}
}
