import { Module } from '@nestjs/common';
import { GameResultsController } from './game-results.controller';
import { GameResultsService }    from './game-results.service';
import { UsersModule }           from '../users/users.module';

@Module({
  imports:     [UsersModule],
  controllers: [GameResultsController],
  providers:   [GameResultsService],
})
export class GameResultsModule {}
