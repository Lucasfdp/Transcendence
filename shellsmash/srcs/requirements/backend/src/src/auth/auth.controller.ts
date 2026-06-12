import { Controller, Get, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiTags } from '@nestjs/swagger';

// TODO(#1): Restore 42 OAuth routes (fortyTwoLogin, fortyTwoCallback) once
//           FORTYTWO_CLIENT_ID / FORTYTWO_CLIENT_SECRET are provisioned.

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // GET /api/auth/me — verify token and return current user
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() req) {
    return req.user;
  }

  // GET /api/auth/dev-login?username=KameMaster
  //
  // Security hotspot justification: this endpoint is double-gated —
  //   1. NODE_ENV !== 'production'  (set by Docker Compose; cannot be spoofed externally)
  //   2. ENABLE_DEV_LOGIN === 'true' (must be explicitly present in .env; absent by default)
  // The JWT issued is identical in privilege to one issued via 42 OAuth.
  // Both gates must be true simultaneously; missing either throws 403.
  @Get('dev-login')
  async devLogin(@Query('username') username: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev login is disabled in production');
    }
    if (process.env.ENABLE_DEV_LOGIN !== 'true') {
      throw new ForbiddenException('Dev login requires ENABLE_DEV_LOGIN=true');
    }
    return this.authService.devLogin(username ?? 'devturtle');
  }
}
