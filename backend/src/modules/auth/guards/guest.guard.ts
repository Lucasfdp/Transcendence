import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';

/**
 * Reject requests made by guest sessions on routes that require a real account
 * (e.g. leaderboard writes, profile updates).
 *
 * Apply after JwtAuthGuard so req.user is already populated:
 *   @UseGuards(JwtAuthGuard, GuestGuard)
 */
@Injectable()
export class GuestGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: { isGuest?: boolean } }>();
    if (req.user?.isGuest) {
      throw new ForbiddenException(
        'Guest accounts cannot perform this action. Please log in.',
      );
    }
    return true;
  }
}
