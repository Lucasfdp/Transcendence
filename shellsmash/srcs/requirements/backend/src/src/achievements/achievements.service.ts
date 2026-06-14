import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ACHIEVEMENTS, AchievementDefinition, AchievementView } from './achievements.constants';
import { UserAchievement } from './entities/user-achievement.entity';
import { UserCosmetic } from '../customization/entities/user-cosmetic.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AchievementsService {
  constructor(
    @InjectRepository(UserAchievement)
    private readonly userAchievementsRepo: Repository<UserAchievement>,
    @InjectRepository(UserCosmetic)
    private readonly userCosmeticsRepo: Repository<UserCosmetic>,
  ) {}

  async listForUser(user: User): Promise<AchievementView[]> {
    const unlocked = await this.findUnlockedByUser(user.id);
    return ACHIEVEMENTS.map((achievement) => this.toView(achievement, user, unlocked.get(achievement.id)));
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
        if (achievement.rewardCosmeticId) {
          await this.grantCosmetic(user, achievement.rewardCosmeticId);
        }
        newlyUnlocked.push(this.toView(achievement, user, saved));
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

  private toView(achievement: AchievementDefinition, user: User, row?: UserAchievement): AchievementView {
    const progress = achievement.progress(user);
    return {
      id: achievement.id,
      title: achievement.title,
      description: achievement.description,
      unlockDescription: achievement.unlockDescription,
      rewardLabel: achievement.rewardLabel,
      rewardCosmeticId: achievement.rewardCosmeticId,
      progressCurrent: progress.current,
      progressTarget: progress.target,
      unlocked: Boolean(row),
      unlockedAt: row?.unlockedAt?.toISOString() ?? null,
    };
  }

  private async grantCosmetic(user: User, cosmeticId: string): Promise<void> {
    try {
      await this.userCosmeticsRepo.save(this.userCosmeticsRepo.create({ user, cosmeticId }));
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '23505') return;
      throw new InternalServerErrorException('Failed to unlock cosmetic reward');
    }
  }
}
