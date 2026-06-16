import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ACHIEVEMENTS, AchievementContext, AchievementDefinition, AchievementView,
} from './achievements.constants';
import { UserAchievement } from './entities/user-achievement.entity';
import { findCosmetic } from '../customization/customization.constants';
import { UserCosmetic } from '../customization/entities/user-cosmetic.entity';
import { UserGameStats } from '../game-results/entities/user-game-stats.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AchievementsService {
  constructor(
    @InjectRepository(UserAchievement)
    private readonly userAchievementsRepo: Repository<UserAchievement>,
    @InjectRepository(UserCosmetic)
    private readonly userCosmeticsRepo: Repository<UserCosmetic>,
    @InjectRepository(UserGameStats)
    private readonly userGameStatsRepo: Repository<UserGameStats>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async listForUser(user: User): Promise<AchievementView[]> {
    const unlocked = await this.findUnlockedByUser(user.id);
    const context = await this.buildContext(user);
    return ACHIEVEMENTS.map((achievement) => this.toView(achievement, context, unlocked.get(achievement.id)));
  }

  async evaluateForUser(user: User): Promise<AchievementView[]> {
    const unlocked = await this.findUnlockedByUser(user.id);
    const context = await this.buildContext(user);
    const newlyUnlocked: AchievementView[] = [];

    for (const achievement of ACHIEVEMENTS) {
      if (unlocked.has(achievement.id) || !achievement.isUnlocked(context)) continue;

      const record = this.userAchievementsRepo.create({
        user,
        achievementId: achievement.id,
      });

      try {
        const saved = await this.userAchievementsRepo.save(record);
        unlocked.set(achievement.id, saved);
        await this.applyReward(user, achievement);
        newlyUnlocked.push(this.toView(achievement, context, saved));
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === '23505') continue;
        throw new InternalServerErrorException('Failed to unlock achievement');
      }
    }

    return newlyUnlocked;
  }

  private async buildContext(user: User): Promise<AchievementContext> {
    const rows = await this.userGameStatsRepo.find({
      where: { user: { id: user.id } },
      relations: ['user'],
    });
    return {
      user,
      gameStats: new Map(rows.map((row) => [row.gameId, row])),
    };
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

  private toView(achievement: AchievementDefinition, context: AchievementContext, row?: UserAchievement): AchievementView {
    const progress = achievement.progress(context);
    const rewardLabel = achievement.reward.label;
    return {
      id: achievement.id,
      title: achievement.title,
      description: achievement.description,
      unlockDescription: achievement.unlockDescription,
      ...(rewardLabel ? { rewardLabel } : {}),
      reward: achievement.reward,
      progressCurrent: progress.current,
      progressTarget: progress.target,
      unlocked: Boolean(row),
      unlockedAt: row?.unlockedAt?.toISOString() ?? null,
    };
  }

  private async applyReward(user: User, achievement: AchievementDefinition): Promise<void> {
    if (achievement.reward.type === 'cosmetic') {
      await this.grantCosmetic(user, achievement.reward.cosmeticId);
      return;
    }
    if (achievement.reward.type === 'coins') {
      user.coins = (user.coins ?? 0) + achievement.reward.amount;
      await this.usersRepo.save(user);
    }
  }

  private async grantCosmetic(user: User, cosmeticId: string): Promise<void> {
    if (!findCosmetic(cosmeticId)) throw new InternalServerErrorException('Invalid cosmetic reward');

    try {
      await this.userCosmeticsRepo.save(this.userCosmeticsRepo.create({ user, cosmeticId }));
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '23505') return;
      throw new InternalServerErrorException('Failed to unlock cosmetic reward');
    }
  }
}
