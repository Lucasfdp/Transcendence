import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { FortyTwoStrategy } from "./strategies/forty-two.strategy";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { UsersModule } from "../users/users.module";
import { RateLimiterService } from "./rate-limiter.service";
import { RedisRateLimiterService } from "./redis-rate-limiter.service";
import { GuestCleanupService } from "./guest-cleanup.service";
import { GuestGuard } from "./guards/guest.guard";
import { TokenDenyListService } from "./token-deny-list.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthIdentity } from "./entities/auth-identity.entity";
import { AccountLinkConflict } from "./entities/account-link-conflict.entity";
import { AccountLinksService } from "./account-links.service";
import { OAuthStateService } from "./oauth-state.service";

@Module({
	imports: [
		UsersModule,
		TypeOrmModule.forFeature([AuthIdentity, AccountLinkConflict]),
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
		RateLimiterService,
		RedisRateLimiterService,
		GuestCleanupService,
		GuestGuard,
		TokenDenyListService,
		AccountLinksService,
		OAuthStateService,
	],
	controllers: [AuthController],
	exports: [
		AuthService,
		GuestGuard,
		RateLimiterService,
		RedisRateLimiterService,
		AccountLinksService,
	],
})
export class AuthModule {}
