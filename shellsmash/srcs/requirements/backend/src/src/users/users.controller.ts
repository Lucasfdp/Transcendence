import {
  Controller, Get, Param, Query, Request, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
  constructor(
    private readonly usersService:   UsersService,
    private readonly presence:       PresenceService,
    private readonly friendsService: FriendsService,
    @InjectDataSource()
    private readonly dataSource:     DataSource,
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
   * Excludes guests. Sorted by total_wins DESC → level DESC → username ASC.
   */
  private async queryAllTime(
    allowedIds: number[] | null,
  ): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [LEADERBOARD_LIMIT];
    let idFilter = '';
    if (allowedIds !== null) {
      params.push(allowedIds);
      idFilter = `AND u.id = ANY($${params.length})`;
    }

    return this.dataSource.query<Record<string, unknown>[]>(`
      SELECT
        u.id                      AS "userId",
        u.username,
        u.turtle_name             AS "turtleName",
        u.shell_skin              AS "shellSkin",
        u.avatar,
        u.level,
        COALESCE(p.total_wins,    0) AS wins,
        COALESCE(p.games_played,  0) AS "gamesPlayed"
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.is_guest = false
        ${idFilter}
      ORDER BY wins DESC, u.level DESC, u.username ASC
      LIMIT $1
    `, params);
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

    return this.dataSource.query<Record<string, unknown>[]>(`
      SELECT
        u.id                                                               AS "userId",
        u.username,
        u.turtle_name                                                       AS "turtleName",
        u.shell_skin                                                        AS "shellSkin",
        u.avatar,
        u.level,
        COALESCE(SUM(
          CASE WHEN mp.outcome = 'win' THEN 1 ELSE 0 END
        ), 0)::int                                                          AS wins,
        COALESCE(COUNT(mp.id), 0)::int                                      AS "gamesPlayed"
      FROM users u
      LEFT JOIN match_players mp ON mp.user_id = u.id
      LEFT JOIN matches       m  ON m.id = mp.match_id
                                AND m.created_at >= $1
      WHERE u.is_guest = false
        ${idFilter}
      GROUP BY u.id
      ORDER BY wins DESC, u.level DESC, u.username ASC
      LIMIT $2
    `, params);
  }
}
