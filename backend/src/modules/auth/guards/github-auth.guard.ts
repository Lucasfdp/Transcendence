import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

@Injectable()
export class GithubAuthGuard extends AuthGuard('github') {
  override getAuthenticateOptions(context: ExecutionContext): Record<string, string> {
    const req = context.switchToHttp().getRequest<Request>();
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol ?? 'https';
    const host = req.headers.host ?? 'localhost';
    return {
      callbackURL: `${proto}://${host}/api/auth/github/callback`,
    };
  }

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
