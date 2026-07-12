import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { ChatModule } from "../chat/chat.module";
import { FriendsModule } from "../friends/friends.module";
import { GameResultsModule } from "../game-results/game-results.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PresenceModule } from "../presence/presence.module";
import { ShellsModule } from "../shells/shells.module";
import { UsersModule } from "../users/users.module";
import { ArenaSimulationService } from "./arena-simulation.service";
import { Match } from "./entities/match.entity";
import { MatchPlayer } from "./entities/match-player.entity";
import { MatchReplay } from "./entities/match-replay.entity";
import { MatchReplaySave } from "./entities/match-replay-save.entity";
import { MatchSpectator } from "./entities/match-spectator.entity";
import { UserRating } from "./entities/user-rating.entity";
import { BellClashEngine } from "./engines/bell-clash.engine";
import { BambooBashEngine } from "./engines/bamboo-bash.engine";
import { GameEngineRegistry } from "./engines/game-engine.registry";
import { KameKnockEngine } from "./engines/kame-knock.engine";
import { ShellCurlEngine } from "./engines/shell-curl.engine";
import { GameSessionService } from "./game-session.service";
import { MatchFactoryService } from "./match-factory.service";
import { MatchLifecycleEvents } from "./match-lifecycle.events";
import { MatchesController } from "./matches.controller";
import { MatchmakingGateway } from "./matchmaking.gateway";
import { MatchmakingService } from "./matchmaking.service";
import { PrivateLobbiesService } from "./private-lobbies.service";
import { ReplayService } from "./replay.service";
import { RoomService } from "./room.service";

@Module({
	imports: [
		TypeOrmModule.forFeature([
			Match,
			MatchPlayer,
			MatchReplay,
			MatchReplaySave,
			MatchSpectator,
			UserRating,
		]),
		JwtModule.registerAsync({
			imports: [ConfigModule],
			useFactory: (config: ConfigService) => ({
				secret: config.get<string>("JWT_SECRET"),
			}),
			inject: [ConfigService],
		}),
		PresenceModule,
		UsersModule,
		ShellsModule,
		GameResultsModule,
		NotificationsModule,
		FriendsModule,
		ChatModule,
	],
	controllers: [MatchesController],
	providers: [
		MatchmakingService,
		ShellCurlEngine,
		BambooBashEngine,
		KameKnockEngine,
		BellClashEngine,
		GameEngineRegistry,
		RoomService,
		MatchFactoryService,
		MatchLifecycleEvents,
		ArenaSimulationService,
		PrivateLobbiesService,
		ReplayService,
		GameSessionService,
		MatchmakingGateway,
		// Backs the per-user socket chat-send rate limit (Bug Audit M7); the
		// gateway injects it as @Optional() so tests can omit it.
		RateLimiterService,
	],
	// Exported so future orchestrators outside this module (e.g. a tournament
	// module) can create matches and observe their lifecycle without reaching
	// into matchmaking internals.
	exports: [MatchFactoryService, MatchLifecycleEvents],
})
export class MatchmakingModule {}
