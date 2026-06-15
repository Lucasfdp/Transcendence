import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { AchievementView } from '../achievements/achievements.constants';
import { AchievementsService } from '../achievements/achievements.service';
import { SubmitResultDto } from './dto/submit-result.dto';
import { UserGameStats } from './entities/user-game-stats.entity';
import {
  COINS_PER_LOSS,
  COINS_PER_WIN,
  XP_PER_LOSS,
  XP_PER_WIN,
  xpForNextLevel,
} from './progression.constants';

export interface ProgressionResult {
  xpGained:    number;
  coinsGained: number;
  newXp:       number;
  newLevel:    number;
  newCoins:    number;
  leveledUp:   boolean;
  unlockedAchievements: AchievementView[];
}

@Injectable()
export class GameResultsService {
  constructor(
    private readonly usersService:         UsersService,
    private readonly achievementsService: AchievementsService,
    @InjectRepository(UserGameStats)
    private readonly userGameStatsRepo: Repository<UserGameStats>,
  ) {}

  async submitResult(user: User, dto: SubmitResultDto): Promise<ProgressionResult> {
    try {
      const isWin       = dto.outcome === 'win';
      const xpGained    = isWin ? XP_PER_WIN    : XP_PER_LOSS;
      const coinsGained = isWin ? COINS_PER_WIN  : COINS_PER_LOSS;

      // ── XP + level-up (loop handles multiple thresholds in a single call) ──
      let xp        = user.xp + xpGained;
      let level     = user.level;
      let leveledUp = false;

      while (xp >= xpForNextLevel(level)) {
        xp       -= xpForNextLevel(level);
        level    += 1;
        leveledUp = true;
      }

      // ── Coins ──────────────────────────────────────────────────────────────
      const coins = user.coins + coinsGained;

      // ── Profile stats ──────────────────────────────────────────────────────
      const profile = user.profile;
      if (isWin) {
        profile.totalWins += 1;
      } else {
        profile.totalLosses += 1;
      }
      profile.gamesPlayed += 1;
      profile.totalCoinsEarned = (profile.totalCoinsEarned ?? 0) + coinsGained;

      // ── Persist atomically via cascade save ───────────────────────────────
      // usersRepo.save(user) with cascade:true on the profile OneToOne
      // updates both rows in a single transaction.
      user.xp      = xp;
      user.level   = level;
      user.coins   = coins;
      user.profile = profile;

      await this.usersService.save(user);

      await this.updateGameStats(user, dto.gameId, isWin);

      const unlockedAchievements = await this.achievementsService.evaluateForUser(user);

      return {
        xpGained,
        coinsGained,
        newXp: xp,
        newLevel: level,
        newCoins: coins,
        leveledUp,
        unlockedAchievements,
      };
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException('Failed to record game result');
    }
  }

  private async updateGameStats(user: User, gameId: string, isWin: boolean): Promise<void> {
    const stats = await this.userGameStatsRepo.findOne({
      where: { user: { id: user.id }, gameId },
      relations: ['user'],
    }) ?? this.userGameStatsRepo.create({
      user,
      gameId,
      gamesPlayed: 0,
      totalWins: 0,
      totalLosses: 0,
    });

    stats.gamesPlayed += 1;
    if (isWin) stats.totalWins += 1;
    else stats.totalLosses += 1;

    await this.userGameStatsRepo.save(stats);
  }
}
