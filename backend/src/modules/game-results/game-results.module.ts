import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameResultsController } from './game-results.controller';
import { GameResultsService }    from './game-results.service';
import { UsersModule }           from '../users/users.module';
import { AchievementsModule }    from '../achievements/achievements.module';
import { UserGameStats } from './entities/user-game-stats.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([UserGameStats]), UsersModule, AchievementsModule],
  controllers: [GameResultsController],
  providers:   [GameResultsService],
  exports:     [GameResultsService],
})
export class GameResultsModule {}
