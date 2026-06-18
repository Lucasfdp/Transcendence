import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GameResultsModule } from '../game-results/game-results.module';
import { PresenceModule } from '../presence/presence.module';
import { ShellsModule } from '../shells/shells.module';
import { UsersModule } from '../users/users.module';
import { Match } from './entities/match.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { MatchSpectator } from './entities/match-spectator.entity';
import { UserRating } from './entities/user-rating.entity';
import { BellClashEngine } from './engines/bell-clash.engine';
import { BambooBashEngine } from './engines/bamboo-bash.engine';
import { GameEngineRegistry } from './engines/game-engine.registry';
import { KameKnockEngine } from './engines/kame-knock.engine';
import { ShellCurlEngine } from './engines/shell-curl.engine';
import { GameSessionService } from './game-session.service';
import { MatchesController } from './matches.controller';
import { MatchmakingGateway } from './matchmaking.gateway';
import { MatchmakingService } from './matchmaking.service';
import { RoomService } from './room.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Match, MatchPlayer, MatchSpectator, UserRating]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_SECRET') }),
      inject: [ConfigService],
    }),
    PresenceModule,
    UsersModule,
    ShellsModule,
    GameResultsModule,
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
    GameSessionService,
    MatchmakingGateway,
  ],
})
export class MatchmakingModule {}
