import {
  BadRequestException,
  Body,
  Controller, Delete, ForbiddenException, Get, HttpCode, HttpException,
  Post, Query, Req, Res,
  UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';

/** Portable 429 — TooManyRequestsException was added in later NestJS patches. */
const TooManyRequests = (msg: string): HttpException => new HttpException(msg, 429);
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RateLimiterService } from './rate-limiter.service';
import { User } from '../users/entities/user.entity';

// ── CSRF cookie name (NOT httpOnly — must be readable by JS) ─────────────────
const CSRF_COOKIE = 'csrf_token';

// ── Username validation: 1–20 alphanumeric + underscore ──────────────────────
const USERNAME_RE = /^[a-zA-Z0-9_]{1,20}$/;

function validateUsername(raw: string | undefined): string {
  if (!raw || !USERNAME_RE.test(raw)) {
    throw new BadRequestException(
      'username must be 1–20 alphanumeric characters or underscores',
    );
  }
  return raw;
}

function parseCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const t = part.trim();
    if (t.startsWith(`${name}=`)) return t.slice(name.length + 1);
  }
  return null;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService:  AuthService,
    private readonly rateLimiter:  RateLimiterService,
    private readonly usersService: UsersService,
  ) {}

  // ── GET /api/auth/me ─────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: Request & { user: { id: number } }): Promise<unknown> {
    const user = await this.usersService.findById(req.user.id);
    if (!user) throw new UnauthorizedException('Session expired or user not found');
    // passwordHash has select:false so it is absent from findById results.
    // The explicit omission below is a defence-in-depth guard.
    const { passwordHash: _pw, ...safe } = user as typeof user & { passwordHash?: unknown };
    void _pw;
    return safe;
  }

  // ── GET /api/auth/csrf-token ──────────────────────────────────────────────────
  // Issues a double-submit CSRF token:
  //   • Set as a non-httpOnly cookie (so JS can read it)
  //   • Returned in the body (for immediate use by the caller)
  // The frontend attaches it as X-CSRF-Token on every non-GET request.

  @Get('csrf-token')
  getCsrfToken(@Res({ passthrough: true }) res: Response): { csrfToken: string } {
    const token = randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path:     '/',
    });
    return { csrfToken: token };
  }

  // ── POST /api/auth/guest ──────────────────────────────────────────────────────
  // Creates an ephemeral guest user; sets a 2-hour httpOnly auth cookie.
  // Rate-limited: 10 requests / IP / minute.

  @Post('guest')
  @HttpCode(200)
  async guestLogin(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    this.validateCsrf(req);
    if (!this.rateLimiter.allow(req, 'guest', 10, 60_000)) {
      throw TooManyRequests('Too many guest sessions — try again later.');
    }
    const user = await this.authService.guestLogin();
    this.authService.issueAuthCookie(res, user, true);
    return { ok: true };
  }

  // ── POST /api/auth/register ───────────────────────────────────────────────────
  // Create a new local account (username + password).
  // Rate-limited: 5 attempts / IP / minute.
  // CSRF-validated — caller must include X-CSRF-Token header.

  @Post('register')
  @HttpCode(200)
  async localRegister(
    @Body() body: { username?: string; password?: string },
    @Req()  req:  Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    this.validateCsrf(req);

    if (!this.rateLimiter.allow(req, 'register', 5, 60_000)) {
      throw TooManyRequests('Too many registration attempts — try again later.');
    }

    const username = validateUsername(body.username);
    const password = body.password ?? '';

    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    if (password.length > 128) {
      throw new BadRequestException('Password must be at most 128 characters');
    }

    const user = await this.authService.localRegister(username, password);
    this.authService.issueAuthCookie(res, user);
    return { ok: true };
  }

  // ── POST /api/auth/login ──────────────────────────────────────────────────────
  // Authenticate an existing local account.
  // Rate-limited: 10 attempts / IP / minute.
  // CSRF-validated — caller must include X-CSRF-Token header.

  @Post('login')
  @HttpCode(200)
  async localLogin(
    @Body() body: { username?: string; password?: string },
    @Req()  req:  Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    this.validateCsrf(req);

    if (!this.rateLimiter.allow(req, 'login', 10, 60_000)) {
      throw TooManyRequests('Too many login attempts — try again later.');
    }

    const username = body.username?.trim() ?? '';
    const password = body.password ?? '';

    if (!username || !password) {
      throw new BadRequestException('username and password are required');
    }

    const user = await this.authService.localLogin(username, password);
    this.authService.issueAuthCookie(res, user);
    return { ok: true };
  }

  // ── DELETE /api/auth/session ──────────────────────────────────────────────────
  // Clears the auth cookie (logout).

  @Delete('session')
  @UseGuards(JwtAuthGuard)
  logout(@Res({ passthrough: true }) res: Response): { ok: boolean } {
    this.authService.clearAuthCookie(res);
    return { ok: true };
  }

  // ── GET /api/auth/42 ─────────────────────────────────────────────────────────
  // Redirects the browser to 42's OAuth authorization page.
  // TODO(#1): Protect with @UseGuards(FortyTwoAuthGuard) once keys are provisioned.

  @Get('42')
  fortyTwoLogin(@Res() res: Response): void {
    const clientId    = process.env.FORTYTWO_CLIENT_ID;
    const callbackUrl = process.env.FORTYTWO_CALLBACK_URL;
    if (!clientId || !callbackUrl) {
      throw new ForbiddenException('42 OAuth is not configured on this server.');
    }
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  callbackUrl,
      response_type: 'code',
      scope:         'public',
    });
    res.redirect(`https://api.intra.42.fr/oauth/authorize?${params.toString()}`);
  }

  // ── GET /api/auth/42/callback ─────────────────────────────────────────────────
  // 42 OAuth callback. Passport fills req.user via FortyTwoStrategy.validate().
  // Sets an httpOnly auth cookie then redirects to / — no token in the URL.
  // LandingScene detects the session via a subsequent GET /api/auth/me.
  // TODO(#1): Add @UseGuards(FortyTwoAuthGuard) once keys are provisioned.

  @Get('42/callback')
  async fortyTwoCallback(
    @Req() req: Request & { user?: User },
    @Res() res: Response,
  ): Promise<void> {
    if (!req.user) {
      res.redirect('/?auth_error=oauth_failed');
      return;
    }
    this.authService.issueAuthCookie(res, req.user);
    res.redirect('/');
  }

  // ── GET /api/auth/dev-login ───────────────────────────────────────────────────
  // Double-gated dev endpoint — both conditions must be met simultaneously:
  //   1. NODE_ENV !== 'production'   (Docker Compose env; cannot be spoofed)
  //   2. ENABLE_DEV_LOGIN === 'true' (must be explicit; absent = disabled)
  // Nginx also blocks this path at the network layer in production.

  @Get('dev-login')
  async devLogin(
    @Query('username') usernameRaw: string | undefined,
    @Req()  req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev login is disabled in production');
    }
    if (process.env.ENABLE_DEV_LOGIN !== 'true') {
      throw new ForbiddenException('Dev login requires ENABLE_DEV_LOGIN=true');
    }
    if (!this.rateLimiter.allow(req, 'dev-login', 5, 60_000)) {
      throw TooManyRequests('Too many dev-login attempts — try again later.');
    }
    const username = validateUsername(usernameRaw ?? 'KameMaster');
    const user     = await this.authService.devLogin(username);
    this.authService.issueAuthCookie(res, user);
    return { ok: true };
  }

  // ── CSRF validation ───────────────────────────────────────────────────────────

  private validateCsrf(req: Request): void {
    const headerToken = req.headers['x-csrf-token'] as string | undefined;
    const cookieToken = parseCookie(req.headers.cookie ?? '', CSRF_COOKIE);
    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      throw new UnauthorizedException('Invalid or missing CSRF token');
    }
  }
}
