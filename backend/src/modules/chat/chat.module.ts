import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { FriendsModule } from "../friends/friends.module";
import { PresenceModule } from "../presence/presence.module";
import { User } from "../users/entities/user.entity";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ConversationParticipant } from "./entities/conversation-participant.entity";
import { Conversation } from "./entities/conversation.entity";
import { Message } from "./entities/message.entity";
import { GifService } from "./gif.service";

/**
 * ChatModule — dm and group conversations between friends.
 *
 * Imports the User repository directly (not UsersModule), same rationale as
 * FriendsModule: avoids a circular dependency risk if UsersModule ever needs
 * to import ChatModule. Imports FriendsModule for the adder-friend /
 * dm-freeze gating rules (see ChatService). Imports AuthModule solely for
 * RateLimiterService, used to throttle the /chat/gifs/search proxy.
 */
@Module({
	imports: [
		TypeOrmModule.forFeature([Conversation, ConversationParticipant, Message, User]),
		PresenceModule,
		FriendsModule,
		AuthModule,
	],
	providers: [ChatService, GifService],
	controllers: [ChatController],
	exports: [ChatService],
})
export class ChatModule {}
