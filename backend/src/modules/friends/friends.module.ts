import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PresenceModule } from "../presence/presence.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { User } from "../users/entities/user.entity";
import { Friendship } from "./entities/friendship.entity";
import { FriendsController } from "./friends.controller";
import { FriendsService } from "./friends.service";

/**
 * FriendsModule — manages friend requests, friendships, and blocks.
 *
 * Imports User repository directly (not UsersModule) to avoid a circular
 * dependency with UsersModule, which imports FriendsModule for leaderboard
 * scope filtering.
 *
 * RateLimiterService is provided locally (rather than importing AuthModule) to
 * throttle POST /friends/request — importing AuthModule here would create a
 * cycle (AuthModule → UsersModule → FriendsModule). The limiter is in-memory
 * per-instance, and each endpoint namespaces its own bucket, so a dedicated
 * instance here is functionally equivalent (Bug Audit M7).
 */
@Module({
	imports: [
		TypeOrmModule.forFeature([Friendship, User]),
		PresenceModule,
		NotificationsModule,
	],
	providers: [FriendsService, RateLimiterService],
	controllers: [FriendsController],
	exports: [FriendsService],
})
export class FriendsModule {}
