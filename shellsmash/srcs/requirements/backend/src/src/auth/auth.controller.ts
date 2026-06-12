import { Controller, Get, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
// import { Res } from '@nestjs/common'; // TODO: restore when 42 OAuth is enabled
import { AuthService } from './auth.service';
// import { FortyTwoAuthGuard } from './guards/ft-auth.guard'; // TODO: uncomment when 42 OAuth keys are set
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // TODO: restore when 42 OAuth keys are configured in .env
  // @Get('42')
  // @UseGuards(FortyTwoAuthGuard)
  // fortyTwoLogin() {}

  // @Get('42/callback')
  // @UseGuards(FortyTwoAuthGuard)
  // fortyTwoCallback(@Req() req, @Res() res) {
  //   const { access_token } = this.authService.issueJwt(req.user);
  //   const frontendUrl = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'https://localhost';
  //   return res.redirect(`${frontendUrl}/auth/callback?token=${access_token}`);
  // }

  // GET /api/auth/me — verify token and return user
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() req) {
    return req.user;
  }

  // GET /api/auth/dev-login?username=KameMaster
  // TODO: remove (or keep behind a feature flag) before going to production
  @Get('dev-login')
  async devLogin(@Query('username') username: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev login is disabled in production');
    }
    return this.authService.devLogin(username ?? 'devturtle');
  }
}
