import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FriendsModule } from "../friends/friends.module";
import { PresenceModule } from "../presence/presence.module";
import { ShellsModule } from "../shells/shells.module";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "./entities/user.entity";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
	imports: [
		TypeOrmModule.forFeature([User, Profile]),
		forwardRef(() => ShellsModule),
		PresenceModule,
		FriendsModule,
	],
	providers: [UsersService],
	controllers: [UsersController],
	exports: [UsersService],
})
export class UsersModule {}
