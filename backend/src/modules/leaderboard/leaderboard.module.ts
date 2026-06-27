import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserGameStats } from "../game-results/entities/user-game-stats.entity";
import { FriendsModule } from "../friends/friends.module";
import { UserRating } from "../matchmaking/entities/user-rating.entity";
import { LeaderboardController } from "./leaderboard.controller";
import { LeaderboardService } from "./leaderboard.service";

@Module({
	imports: [
		TypeOrmModule.forFeature([UserRating, UserGameStats]),
		FriendsModule,
	],
	providers: [LeaderboardService],
	controllers: [LeaderboardController],
})
export class LeaderboardModule {}
