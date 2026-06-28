import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { User } from "../users/entities/user.entity";
import { UsersModule } from "../users/users.module";
import { CasinoController } from "./casino.controller";
import { CasinoService } from "./casino.service";
import { Wager } from "./entities/wager.entity";

/**
 * Fortune Wheel — the dojo's gambling den. Players wager the same cosmetic-only
 * coins they earn from matches; nothing here affects gameplay balance.
 *
 * Imports AuthModule for the shared RateLimiterService (spin throttling).
 */
@Module({
	imports: [TypeOrmModule.forFeature([Wager, User]), UsersModule, AuthModule],
	controllers: [CasinoController],
	providers: [CasinoService],
	exports: [CasinoService],
})
export class CasinoModule {}
