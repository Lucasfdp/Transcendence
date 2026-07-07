import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { FriendsModule } from "../friends/friends.module";
import { Report } from "./entities/report.entity";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * ReportsModule — persists player reports and auto-blocks the reported user
 * via FriendsService (imported for its exported block() method).
 *
 * RateLimiterService is provided locally to throttle POST /reports (Bug Audit
 * M7); it's a stateless in-memory limiter with per-endpoint buckets, so a
 * dedicated instance here is equivalent to a shared one.
 */
@Module({
	imports: [TypeOrmModule.forFeature([Report]), FriendsModule],
	providers: [ReportsService, RateLimiterService],
	controllers: [ReportsController],
	exports: [ReportsService],
})
export class ReportsModule {}
