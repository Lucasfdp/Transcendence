import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FriendsModule } from "../friends/friends.module";
import { PresenceModule } from "../presence/presence.module";
import { ShellsModule } from "../shells/shells.module";
import { Profile } from "../profiles/entities/profile.entity";
import { UserCosmetic } from "../customization/entities/user-cosmetic.entity";
import { User } from "./entities/user.entity";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { UserAccountActivityService } from "./user-account-activity.service";

@Module({
	imports: [
		TypeOrmModule.forFeature([User, Profile, UserCosmetic]),
		forwardRef(() => ShellsModule),
		PresenceModule,
		FriendsModule,
	],
	providers: [UsersService, UserAccountActivityService],
	controllers: [UsersController],
	exports: [UsersService, UserAccountActivityService],
})
export class UsersModule {}
