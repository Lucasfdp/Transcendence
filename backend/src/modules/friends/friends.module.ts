import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PresenceModule } from "../presence/presence.module";
import { NotificationsModule } from "../notifications/notifications.module";
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
 */
@Module({
	imports: [
		TypeOrmModule.forFeature([Friendship, User]),
		PresenceModule,
		NotificationsModule,
	],
	providers: [FriendsService],
	controllers: [FriendsController],
	exports: [FriendsService],
})
export class FriendsModule {}
