import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GameResultsModule } from '../game-results/game-results.module';
import { ShellsModule } from '../shells/shells.module';
import { UsersModule } from '../users/users.module';
import { Match } from './entities/match.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { MatchSpectator } from './entities/match-spectator.entity';
import { UserRating } from './entities/user-rating.entity';
import { GameSessionService } from './game-session.service';
import { MatchesController } from './matches.controller';
import { MatchmakingGateway } from './matchmaking.gateway';
import { MatchmakingService } from './matchmaking.service';
import { PresenceService } from './presence.service';
import { RoomService } from './room.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Match, MatchPlayer, MatchSpectator, UserRating]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_SECRET') }),
      inject: [ConfigService],
    }),
    UsersModule,
    ShellsModule,
    GameResultsModule,
  ],
  controllers: [MatchesController],
  providers: [
    PresenceService,
    MatchmakingService,
    RoomService,
    GameSessionService,
    MatchmakingGateway,
  ],
})
export class MatchmakingModule {}
