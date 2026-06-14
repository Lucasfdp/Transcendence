import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ACHIEVEMENTS, AchievementDefinition, AchievementView } from './achievements.constants';
import { UserAchievement } from './entities/user-achievement.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AchievementsService {
  constructor(
    @InjectRepository(UserAchievement)
    private readonly userAchievementsRepo: Repository<UserAchievement>,
  ) {}

  async listForUser(user: User): Promise<AchievementView[]> {
    const unlocked = await this.findUnlockedByUser(user.id);
    return ACHIEVEMENTS.map((achievement) => this.toView(achievement, unlocked.get(achievement.id)));
  }

  async evaluateForUser(user: User): Promise<AchievementView[]> {
    const unlocked = await this.findUnlockedByUser(user.id);
    const newlyUnlocked: AchievementView[] = [];

    for (const achievement of ACHIEVEMENTS) {
      if (unlocked.has(achievement.id) || !achievement.isUnlocked(user)) continue;

      const record = this.userAchievementsRepo.create({
        user,
        achievementId: achievement.id,
      });

      try {
        const saved = await this.userAchievementsRepo.save(record);
        unlocked.set(achievement.id, saved);
        newlyUnlocked.push(this.toView(achievement, saved));
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === '23505') continue;
        throw new InternalServerErrorException('Failed to unlock achievement');
      }
    }

    return newlyUnlocked;
  }

  private async findUnlockedByUser(userId: number): Promise<Map<string, UserAchievement>> {
    try {
      const rows = await this.userAchievementsRepo.find({
        where: { user: { id: userId } },
        relations: ['user'],
      });
      return new Map(rows.map((row) => [row.achievementId, row]));
    } catch {
      throw new InternalServerErrorException('Failed to fetch achievements');
    }
  }

  private toView(achievement: AchievementDefinition, row?: UserAchievement): AchievementView {
    return {
      id: achievement.id,
      title: achievement.title,
      description: achievement.description,
      unlockDescription: achievement.unlockDescription,
      rewardLabel: achievement.rewardLabel,
      unlocked: Boolean(row),
      unlockedAt: row?.unlockedAt?.toISOString() ?? null,
    };
  }
}
