import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { User } from "../users/entities/user.entity";
import { UsersModule } from "../users/users.module";
import { CasinoController } from "./casino.controller";
import { CasinoEngine } from "./casino.engine";
import { CasinoService } from "./casino.service";
import { DiceService } from "./dice.service";
import { FlipService } from "./flip.service";
import { MonteService } from "./monte.service";
import { MonteRoundService } from "./monte-round.service";
import { MonteRoundSweeper } from "./monte-round.sweeper";
import { PlinkoService } from "./plinko.service";
import { SlotsService } from "./slots.service";
import { MonteRound } from "./entities/monte-round.entity";
import { Wager } from "./entities/wager.entity";

/**
 * Fortune Wheel — the dojo's gambling den. Players wager the same cosmetic-only
 * coins they earn from matches; nothing here affects gameplay balance.
 *
 * Imports AuthModule for the shared RateLimiterService (spin throttling).
 */
@Module({
	imports: [
		TypeOrmModule.forFeature([Wager, MonteRound, User]),
		UsersModule,
		AuthModule,
	],
	controllers: [CasinoController],
	providers: [
		CasinoEngine,
		CasinoService,
		FlipService,
		MonteService,
		MonteRoundService,
		MonteRoundSweeper,
		SlotsService,
		DiceService,
		PlinkoService,
	],
	exports: [CasinoService],
})
export class CasinoModule {}
