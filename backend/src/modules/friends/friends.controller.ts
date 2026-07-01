import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
	ParseIntPipe,
	Post,
	Request,
	UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { FriendRequestDto, FriendUserIdDto } from "./dto/friend-action.dto";
import { FriendView, FriendsService, PendingView } from "./friends.service";

@ApiTags("friends")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("friends")
export class FriendsController {
	constructor(private readonly friendsService: FriendsService) {}

	/** GET /api/friends — list all accepted friends with live online status. */
	@Get()
	listFriends(
		@Request() req: { user: { id: number } },
	): Promise<FriendView[]> {
		return this.friendsService.listFriends(req.user.id);
	}

	/** GET /api/friends/pending — list incoming pending requests. */
	@Get("pending")
	listPending(
		@Request() req: { user: { id: number } },
	): Promise<PendingView[]> {
		return this.friendsService.listPending(req.user.id);
	}

	/** GET /api/friends/outgoing — list outgoing pending requests. */
	@Get("outgoing")
	listOutgoing(
		@Request() req: { user: { id: number } },
	): Promise<PendingView[]> {
		return this.friendsService.listOutgoing(req.user.id);
	}

	/** GET /api/friends/suggestions — "People you may know" (friends-of-friends). */
	@Get("suggestions")
	getSuggestions(
		@Request() req: { user: { id: number } },
	): Promise<PendingView[]> {
		return this.friendsService.getSuggestions(req.user.id);
	}

	/** POST /api/friends/request — send a friend request by username. */
	@Post("request")
	@HttpCode(200)
	async sendRequest(
		@Request() req: { user: { id: number } },
		@Body() body: FriendRequestDto,
	): Promise<{ ok: boolean }> {
		await this.friendsService.sendRequest(req.user.id, body.username);
		return { ok: true };
	}

	/** POST /api/friends/accept — accept an incoming pending request by userId. */
	@Post("accept")
	@HttpCode(200)
	async acceptRequest(
		@Request() req: { user: { id: number } },
		@Body() body: FriendUserIdDto,
	): Promise<{ ok: boolean }> {
		await this.friendsService.acceptRequest(req.user.id, body.userId);
		return { ok: true };
	}

	/**
	 * DELETE /api/friends/:userId — remove a friend or decline a pending request.
	 * Works regardless of who originally sent the request.
	 */
	@Delete(":userId")
	@HttpCode(200)
	async removeOrDecline(
		@Request() req: { user: { id: number } },
		@Param("userId", ParseIntPipe) userId: number,
	): Promise<{ ok: boolean }> {
		await this.friendsService.removeOrDecline(req.user.id, userId);
		return { ok: true };
	}

	/** POST /api/friends/block — block a user by userId. */
	@Post("block")
	@HttpCode(200)
	async block(
		@Request() req: { user: { id: number } },
		@Body() body: FriendUserIdDto,
	): Promise<{ ok: boolean }> {
		await this.friendsService.block(req.user.id, body.userId);
		return { ok: true };
	}
}
