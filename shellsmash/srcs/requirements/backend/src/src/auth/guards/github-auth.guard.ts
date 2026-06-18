import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GithubAuthGuard extends AuthGuard('github') {
  handleRequest<TUser = unknown>(err: unknown, user: unknown, info: unknown): TUser {
    if (err) throw err;
    if (!user) {
      const detail = typeof info === 'object' && info !== null && 'message' in info
        ? String((info as { message?: string }).message)
        : 'GitHub OAuth authentication failed';
      throw new UnauthorizedException(detail);
    }
    return user as TUser;
  }
}
