import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "./modules/auth/auth.module";
import { FriendsModule } from "./modules/friends/friends.module";
import { UsersModule } from "./modules/users/users.module";
import { ProfilesModule } from "./modules/profiles/profiles.module";
import { MiniGamesModule } from "./modules/minigames/minigames.module";
import { GameResultsModule } from "./modules/game-results/game-results.module";
import { AchievementsModule } from "./modules/achievements/achievements.module";
import { CustomizationModule } from "./modules/customization/customization.module";
import { CardsModule } from "./modules/cards/cards.module";
import { CasinoModule } from "./modules/casino/casino.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { HealthModule } from "./modules/health/health.module";
import { PresenceModule } from "./modules/presence/presence.module";
import { ShellsModule } from "./modules/shells/shells.module";
import { MatchmakingModule } from "./modules/matchmaking/matchmaking.module";
import { LeaderboardModule } from "./modules/leaderboard/leaderboard.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { AppController } from "./app.controller";

@Module({
	imports: [
		ConfigModule.forRoot({ isGlobal: true }),

		TypeOrmModule.forRootAsync({
			imports: [ConfigModule],
			useFactory: (config: ConfigService) => ({
				type: "postgres",
				host: config.get("POSTGRES_HOST", "database"),
				port: config.get<number>("POSTGRES_PORT", 5432),
				username: config.get("POSTGRES_USER"),
				password: config.get("POSTGRES_PASSWORD"),
				database: config.get("POSTGRES_DB"),
				entities: [__dirname + "/**/*.entity{.ts,.js}"],
				migrations: [__dirname + "/migrations/**/*{.ts,.js}"],
				// synchronize creates the base schema on fresh installs (dev/staging only).
				// All 5 existing migrations are additive on top of this base schema —
				// there is no initial migration covering it. Production deployments must
				// run `npm run migration:run` manually after the base schema exists.
				// TODO(#initial-migration): generate an initial migration from current
				// entities so synchronize can be set to false everywhere.
				synchronize: config.get("NODE_ENV") !== "production",
				logging: config.get("NODE_ENV") === "development",
			}),
			inject: [ConfigService],
		}),

		// Feature modules
		AuthModule,
		PresenceModule,
		UsersModule,
		ProfilesModule,
		MiniGamesModule,
		AchievementsModule,
		CustomizationModule,
		CardsModule,
		CasinoModule,
		GameResultsModule,
		ShellsModule,
		FriendsModule,
		MatchmakingModule,
		LeaderboardModule,
		NotificationsModule,

		// Observability — must come after TypeOrmModule so DataSource is available
		MetricsModule,
		HealthModule,
	],
	controllers: [AppController],
})
export class AppModule {}
