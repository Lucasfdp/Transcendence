import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { SubmitResultDto } from './dto/submit-result.dto';
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
}

@Injectable()
export class GameResultsService {
  constructor(private readonly usersService: UsersService) {}

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

      // ── Persist atomically via cascade save ───────────────────────────────
      // usersRepo.save(user) with cascade:true on the profile OneToOne
      // updates both rows in a single transaction.
      user.xp      = xp;
      user.level   = level;
      user.coins   = coins;
      user.profile = profile;

      await this.usersService.save(user);

      return { xpGained, coinsGained, newXp: xp, newLevel: level, newCoins: coins, leveledUp };
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException('Failed to record game result');
    }
  }
}
