import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // GET /api/users/me — current logged in user
  @Get('me')
  getMe(@Request() req) {
    return req.user;
  }

  // GET /api/users/:username — public profile
  @Get(':username')
  getUser(@Param('username') username: string) {
    return this.usersService.findByUsername(username);
  }

  // GET /api/users — leaderboard / all users
  @Get()
  getAllUsers() {
    return this.usersService.findAll();
  }
}
