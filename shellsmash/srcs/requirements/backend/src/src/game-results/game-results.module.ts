import { Module } from '@nestjs/common';
import { GameResultsController } from './game-results.controller';
import { GameResultsService }    from './game-results.service';
import { UsersModule }           from '../users/users.module';
import { AchievementsModule }    from '../achievements/achievements.module';

@Module({
  imports:     [UsersModule, AchievementsModule],
  controllers: [GameResultsController],
  providers:   [GameResultsService],
})
export class GameResultsModule {}
