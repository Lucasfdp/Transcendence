import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FriendsModule } from "../friends/friends.module";
import { Report } from "./entities/report.entity";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * ReportsModule — persists player reports and auto-blocks the reported user
 * via FriendsService (imported for its exported block() method).
 */
@Module({
	imports: [TypeOrmModule.forFeature([Report]), FriendsModule],
	providers: [ReportsService],
	controllers: [ReportsController],
	exports: [ReportsService],
})
export class ReportsModule {}
