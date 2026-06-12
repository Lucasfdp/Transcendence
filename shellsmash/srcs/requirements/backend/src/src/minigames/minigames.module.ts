import { Module } from '@nestjs/common';
import { MiniGamesController } from './minigames.controller';

@Module({
  controllers: [MiniGamesController],
})
export class MiniGamesModule {}
