import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpException,
	Param,
	ParseIntPipe,
	Post,
	Request,
	UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { GuestGuard } from "../auth/guards/guest.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { FriendRequestDto, FriendUserIdDto } from "./dto/friend-action.dto";
import { FriendView, FriendsService, PendingView } from "./friends.service";

/** Portable 429 — mirrors the helper in auth/chat controllers. */
const TooManyRequests = (msg: string): HttpException => new HttpException(msg, 429);

/**
 * Per-user cap on outbound friend requests. Generous for normal use, cheap to
 * abuse otherwise (each request persists a notification + WS push), so it is
 * keyed on the authenticated user id rather than the shared egress IP
 * (Bug Audit M7).
 */
const FRIEND_REQUEST_RATE_LIMIT_MAX = 20;
const FRIEND_REQUEST_RATE_LIMIT_WINDOW_MS = 60_000;

@ApiTags("friends")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("friends")
export class FriendsController {
	constructor(
		private readonly friendsService: FriendsService,
		private readonly rateLimiter: RateLimiterService,
	) {}

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

	/** GET /api/friends/blocked — list users the caller has blocked. */
	@Get("blocked")
	listBlocked(
		@Request() req: { user: { id: number } },
	): Promise<PendingView[]> {
		return this.friendsService.listBlocked(req.user.id);
	}

	/**
	 * POST /api/friends/request — send a friend request by username.
	 * Guest accounts cannot send requests (Bug Audit M4) — they're ephemeral
	 * and can't durably participate in the friend graph.
	 */
	@Post("request")
	@HttpCode(200)
	@UseGuards(GuestGuard)
	async sendRequest(
		@Request() req: { user: { id: number } },
		@Body() body: FriendRequestDto,
	): Promise<{ ok: boolean }> {
		if (
			!this.rateLimiter.allowKey(
				"friend-request",
				String(req.user.id),
				FRIEND_REQUEST_RATE_LIMIT_MAX,
				FRIEND_REQUEST_RATE_LIMIT_WINDOW_MS,
			)
		) {
			throw TooManyRequests(
				"Too many friend requests — try again shortly.",
			);
		}
		await this.friendsService.sendRequest(req.user.id, body.username);
		return { ok: true };
	}

	/**
	 * POST /api/friends/accept — accept an incoming pending request by userId.
	 * Guest accounts cannot accept requests (Bug Audit M4) — a guest can never
	 * be a valid addressee in the first place since sendRequest now rejects
	 * guest addressees, but this closes the loophole defensively too.
	 */
	@Post("accept")
	@HttpCode(200)
	@UseGuards(GuestGuard)
	async acceptRequest(
		@Request() req: { user: { id: number } },
		@Body() body: FriendUserIdDto,
	): Promise<{ ok: boolean }> {
		await this.friendsService.acceptRequest(req.user.id, body.userId);
		return { ok: true };
	}

	/**
	 * DELETE /api/friends/:userId — remove an established (accepted) friend.
	 * Works regardless of who originally sent the request. Scoped to accepted
	 * rows only — see POST /friends/decline for pending requests.
	 */
	@Delete(":userId")
	@HttpCode(200)
	async removeFriend(
		@Request() req: { user: { id: number } },
		@Param("userId", ParseIntPipe) userId: number,
	): Promise<{ ok: boolean }> {
		await this.friendsService.removeFriend(req.user.id, userId);
		return { ok: true };
	}

	/**
	 * POST /api/friends/decline — decline an incoming pending request, or
	 * cancel your own outgoing one. Idempotent: safe to call even if the
	 * request was already accepted or resolved from another surface.
	 */
	@Post("decline")
	@HttpCode(200)
	async declineOrCancel(
		@Request() req: { user: { id: number } },
		@Body() body: FriendUserIdDto,
	): Promise<{ ok: boolean }> {
		await this.friendsService.declineOrCancelRequest(req.user.id, body.userId);
		return { ok: true };
	}

	/**
	 * POST /api/friends/block — block a user by userId. Guests cannot block:
	 * they have no durable presence in the friend graph, so a guest block would
	 * be a meaningless ephemeral row (Decision 4, 2026-07-11).
	 */
	@Post("block")
	@HttpCode(200)
	@UseGuards(GuestGuard)
	async block(
		@Request() req: { user: { id: number } },
		@Body() body: FriendUserIdDto,
	): Promise<{ ok: boolean }> {
		await this.friendsService.block(req.user.id, body.userId);
		return { ok: true };
	}

	/**
	 * POST /api/friends/unblock — unblock a user by userId. Removes only the
	 * caller's own block row; a block the other user placed on the caller is
	 * left intact (Bug Audit H3/M1). Idempotent. Guest-guarded to match block
	 * (Decision 4, 2026-07-11).
	 */
	@Post("unblock")
	@HttpCode(200)
	@UseGuards(GuestGuard)
	async unblock(
		@Request() req: { user: { id: number } },
		@Body() body: FriendUserIdDto,
	): Promise<{ ok: boolean }> {
		await this.friendsService.unblock(req.user.id, body.userId);
		return { ok: true };
	}
}
