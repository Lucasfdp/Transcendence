import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UsersModule } from "../users/users.module";
import { AchievementsController } from "./achievements.controller";
import { AchievementsService } from "./achievements.service";
import { UserAchievement } from "./entities/user-achievement.entity";
import { UserCosmetic } from "../customization/entities/user-cosmetic.entity";
import { UserGameStats } from "../game-results/entities/user-game-stats.entity";
import { User } from "../users/entities/user.entity";

@Module({
	imports: [
		TypeOrmModule.forFeature([
			UserAchievement,
			UserCosmetic,
			UserGameStats,
			User,
		]),
		UsersModule,
	],
	controllers: [AchievementsController],
	providers: [AchievementsService],
	exports: [AchievementsService],
})
export class AchievementsModule {}
