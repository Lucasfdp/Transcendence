import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
// TODO(#1): Uncomment once FORTYTWO_CLIENT_ID / FORTYTWO_CLIENT_SECRET are provisioned.
// import { FortyTwoStrategy } from './strategies/forty-two.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { RateLimiterService } from './rate-limiter.service';
import { GuestCleanupService } from './guest-cleanup.service';
import { GuestGuard } from './guards/guest.guard';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports:    [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret:      config.get<string>('JWT_SECRET'),
        // Default TTL for tokens that don't specify their own expiresIn.
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '24h') },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    // TODO(#1): FortyTwoStrategy,
    RateLimiterService,
    GuestCleanupService,
    GuestGuard,
  ],
  controllers: [AuthController],
  exports:     [AuthService, GuestGuard, RateLimiterService],
})
export class AuthModule {}
