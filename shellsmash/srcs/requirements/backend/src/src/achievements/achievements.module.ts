import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';
import { UserAchievement } from './entities/user-achievement.entity';
import { UserCosmetic } from '../customization/entities/user-cosmetic.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserAchievement, UserCosmetic]), UsersModule],
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
