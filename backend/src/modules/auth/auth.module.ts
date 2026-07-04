import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { FortyTwoStrategy } from "./strategies/forty-two.strategy";
import { GithubStrategy } from "./strategies/github.strategy";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { UsersModule } from "../users/users.module";
import { RateLimiterService } from "./rate-limiter.service";
import { RedisRateLimiterService } from "./redis-rate-limiter.service";
import { GuestCleanupService } from "./guest-cleanup.service";
import { GuestGuard } from "./guards/guest.guard";
import { TokenDenyListService } from "./token-deny-list.service";

@Module({
	imports: [
		UsersModule,
		PassportModule,
		ConfigModule,
		JwtModule.registerAsync({
			imports: [ConfigModule],
			useFactory: (config: ConfigService) => ({
				secret: config.get<string>("JWT_SECRET"),
				// Default TTL for tokens that don't specify their own expiresIn.
				signOptions: {
					expiresIn: config.get<string>("JWT_EXPIRES_IN", "24h"),
				},
			}),
			inject: [ConfigService],
		}),
	],
	providers: [
		AuthService,
		JwtStrategy,
		FortyTwoStrategy,
		GithubStrategy,
		RateLimiterService,
		RedisRateLimiterService,
		GuestCleanupService,
		GuestGuard,
		TokenDenyListService,
	],
	controllers: [AuthController],
	exports: [
		AuthService,
		GuestGuard,
		RateLimiterService,
		RedisRateLimiterService,
	],
})
export class AuthModule {}
