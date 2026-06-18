import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserAchievement } from '../achievements/entities/user-achievement.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { CustomizationController } from './customization.controller';
import { CustomizationService } from './customization.service';
import { UserCosmetic } from './entities/user-cosmetic.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserCosmetic, UserAchievement, User]), UsersModule],
  controllers: [CustomizationController],
  providers: [CustomizationService],
  exports: [CustomizationService],
})
export class CustomizationModule {}
