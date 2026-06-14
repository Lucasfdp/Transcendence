import {
  Controller, Get, Param, UseGuards, Request, UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from './entities/user.entity';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /api/users/me — current logged-in user, fetched fresh from the DB.
  // Returns the full User record (minus passwordHash) so the frontend always
  // sees up-to-date level, xp, coins, and profile data.
  @Get('me')
  async getMe(@Request() req: { user: { id: number } }): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.usersService.findById(req.user.id);
    if (!user) throw new UnauthorizedException();
    const { passwordHash: _pw, ...safe } = user as User & { passwordHash?: unknown };
    return safe as Omit<User, 'passwordHash'>;
  }

  // GET /api/users/leaderboard — top 50 players by level then xp
  @Get('leaderboard')
  async getLeaderboard(): Promise<
    Pick<User, 'id' | 'username' | 'turtleName' | 'level' | 'coins' | 'shellSkin'>[]
  > {
    const users = await this.usersService.findAll();
    return [...users]
      .sort((a, b) => b.level - a.level || b.xp - a.xp)
      .slice(0, 50)
      .map(({ id, username, turtleName, level, coins, shellSkin }) => ({
        id, username, turtleName, level, coins, shellSkin,
      }));
  }

  // GET /api/users/:username — public profile
  @Get(':username')
  getUser(@Param('username') username: string): Promise<User | null> {
    return this.usersService.findByUsername(username);
  }

  // GET /api/users — all users (admin / internal use)
  @Get()
  getAllUsers(): Promise<User[]> {
    return this.usersService.findAll();
  }
}
