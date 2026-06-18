import {
  Controller, Get, InternalServerErrorException, Logger, Param, Query, Request,
  UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FriendsService } from '../friends/friends.service';
import { PresenceService } from '../presence/presence.service';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

// ── Constants ─────────────────────────────────────────────────────────────────
const LEADERBOARD_LIMIT = 50;
const WEEKLY_DAYS       = 7;

export type LbPeriod = 'all' | 'monthly' | 'weekly';
export type LbScope  = 'global' | 'friends';

export interface LeaderboardEntry {
  rank:        number;
  userId:      number;
  username:    string;
  turtleName:  string | null;
  shellSkin:   string;
  avatar:      string | null;
  level:       number;
  wins:        number;
  gamesPlayed: number;
  isOnline:    boolean;
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService:   UsersService,
    private readonly presence:       PresenceService,
    private readonly friendsService: FriendsService,
  ) {}

  // ── GET /api/users/me ────────────────────────────────────────────────────────

  @Get('me')
  async getMe(
    @Request() req: { user: { id: number } },
  ): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.usersService.findById(req.user.id);
    if (!user) throw new UnauthorizedException();
    const { passwordHash: _pw, ...safe } = user as User & { passwordHash?: unknown };
    void _pw;
    return safe as Omit<User, 'passwordHash'>;
  }

  // ── GET /api/users/leaderboard ───────────────────────────────────────────────
  //
  // Query params:
  //   period — 'all' (default) | 'monthly' | 'weekly'
  //   scope  — 'global' (default) | 'friends'
  //
  // 'all'     → fast path using profile.total_wins (no match join)
  // 'monthly' → counts wins in match_players for the current calendar month
  // 'weekly'  → counts wins in match_players for the last 7 days
  //
  // Declared BEFORE :username to prevent NestJS routing the literal string
  // 'leaderboard' into the :username param handler.

  @Get('leaderboard')
  @ApiQuery({ name: 'period', required: false, enum: ['all', 'monthly', 'weekly'] })
  @ApiQuery({ name: 'scope',  required: false, enum: ['global', 'friends']         })
  async getLeaderboard(
    @Request() req:    { user: { id: number; isGuest: boolean } },
    @Query('period')   period: LbPeriod = 'all',
    @Query('scope')    scope:  LbScope  = 'global',
  ): Promise<LeaderboardEntry[]> {
    try {
      const validPeriods: LbPeriod[] = ['all', 'monthly', 'weekly'];
      const validScopes:  LbScope[]  = ['global', 'friends'];
      const safePeriod: LbPeriod = validPeriods.includes(period) ? period : 'all';
      const safeScope:  LbScope  = validScopes.includes(scope)   ? scope  : 'global';

      // For scope=friends, collect the caller's friend IDs (+ self)
      let allowedIds: number[] | null = null;
      if (safeScope === 'friends') {
        const friendIds = await this.friendsService.getFriendIds(req.user.id);
        allowedIds = [...friendIds, req.user.id];
      }

      const rows = safePeriod === 'all'
        ? await this.queryAllTime(allowedIds)
        : await this.queryPeriod(safePeriod, allowedIds);

      return rows.map((row, idx) => ({
        rank:        idx + 1,
        userId:      Number(row.userId),
        username:    row.username      as string,
        turtleName:  (row.turtleName  as string | null) ?? null,
        shellSkin:   row.shellSkin     as string,
        avatar:      (row.avatar       as string | null) ?? null,
        level:       Number(row.level),
        wins:        Number(row.wins),
        gamesPlayed: Number(row.gamesPlayed),
        isOnline:    this.presence.isOnline(Number(row.userId)),
      }));
    } catch (err) {
      this.logger.error(
        `Leaderboard query failed [period=${period} scope=${scope}]: ${String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new InternalServerErrorException('Failed to load leaderboard');
    }
  }

  // ── GET /api/users/:username ─────────────────────────────────────────────────

  @Get(':username')
  async getUser(
    @Param('username') username: string,
  ): Promise<(Omit<User, 'passwordHash'> & { isOnline: boolean }) | null> {
    const user = await this.usersService.findByUsername(username);
    if (!user) return null;
    const { passwordHash: _pw, ...safe } = user as User & { passwordHash?: unknown };
    void _pw;
    return { ...(safe as Omit<User, 'passwordHash'>), isOnline: this.presence.isOnline(user.id) };
  }

  // ── GET /api/users — all users (internal use) ────────────────────────────────

  @Get()
  getAllUsers(): Promise<User[]> {
    return this.usersService.findAll();
  }

  // ── Private query helpers ────────────────────────────────────────────────────

  /**
   * Fast-path leaderboard using the pre-aggregated profile.total_wins column.
   * Loads all users via UsersService (which eager-loads profiles) and sorts in
   * JS — avoids raw SQL and any ORM column-naming ambiguity.
   * Excludes guests. Sorted by total_wins DESC → level DESC → username ASC.
   */
  private async queryAllTime(
    allowedIds: number[] | null,
  ): Promise<Record<string, unknown>[]> {
    const users = await this.usersService.findAll();
    return users
      .filter(u =>
        !u.isGuest &&
        (allowedIds === null || allowedIds.includes(u.id)),
      )
      .map(u => ({
        userId:      u.id,
        username:    u.username,
        turtleName:  u.turtleName ?? null,
        shellSkin:   u.shellSkin,
        avatar:      u.avatar ?? null,
        level:       u.level,
        wins:        u.profile?.totalWins   ?? 0,
        gamesPlayed: u.profile?.gamesPlayed ?? 0,
      }))
      .sort((a, b) => {
        const wDiff = (b.wins as number) - (a.wins as number);
        if (wDiff !== 0) return wDiff;
        const lDiff = (b.level as number) - (a.level as number);
        if (lDiff !== 0) return lDiff;
        return (a.username as string).localeCompare(b.username as string);
      })
      .slice(0, LEADERBOARD_LIMIT);
  }

  /**
   * Period-filtered leaderboard using match history.
   * Counts only wins (mp.outcome = 'win') from matches created within the
   * requested time window.  Uses a left join so players with zero period wins
   * still appear, sorted to the bottom.
   */
  private async queryPeriod(
    period: 'monthly' | 'weekly',
    allowedIds: number[] | null,
  ): Promise<Record<string, unknown>[]> {
    const cutoff =
      period === 'weekly'
        ? new Date(Date.now() - WEEKLY_DAYS * 24 * 60 * 60 * 1000)
        : (() => {
            const d = new Date();
            d.setDate(1);
            d.setHours(0, 0, 0, 0);
            return d;
          })();

    const params: unknown[] = [cutoff, LEADERBOARD_LIMIT];
    let idFilter = '';
    if (allowedIds !== null) {
      params.push(allowedIds);
      idFilter = `AND u.id = ANY($${params.length})`;
    }

    // NOTE: TypeORM's default naming strategy keeps camelCase column names in
    // PostgreSQL (no snake_case conversion).  All identifiers here must match
    // what TypeORM actually created in the DB (confirmed from schema logs).
    return this.usersService.getDataSource().query<Record<string, unknown>[]>(`
      SELECT
        u.id                                                               AS "userId",
        u.username,
        u."turtleName",
        u."shellSkin",
        u.avatar,
        u.level,
        COALESCE(SUM(
          CASE WHEN mp.outcome = 'win' THEN 1 ELSE 0 END
        ), 0)::int                                                          AS wins,
        COALESCE(COUNT(mp.id), 0)::int                                      AS "gamesPlayed"
      FROM users u
      LEFT JOIN match_players mp ON mp."userId" = u.id
      LEFT JOIN matches       m  ON m.id = mp."matchId"
                                AND m."createdAt" >= $1
      WHERE u."isGuest" = false
        ${idFilter}
      GROUP BY u.id
      ORDER BY wins DESC, u.level DESC, u.username ASC
      LIMIT $2
    `, params);
  }
}
