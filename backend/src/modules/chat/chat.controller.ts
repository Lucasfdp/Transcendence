import {
	BadRequestException,
	Body,
	Controller,
	Get,
	HttpCode,
	HttpException,
	Param,
	ParseIntPipe,
	Post,
	Query,
	Req,
	Request,
	UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request as ExpressRequest } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RateLimiterService } from "../auth/rate-limiter.service";
import {
	ChatService,
	ConversationSummaryView,
	MessageView,
} from "./chat.service";
import {
	AddGroupMemberDto,
	CreateGroupDto,
	SendGifMessageDto,
	SendMessageDto,
	StartDirectMessageDto,
} from "./dto/chat.dto";
import { Conversation } from "./entities/conversation.entity";
import { GifSearchResult, GifService } from "./gif.service";

/** Portable 429 — mirrors the helper in auth.controller.ts (TooManyRequestsException landed later). */
const TooManyRequests = (msg: string): HttpException => new HttpException(msg, 429);

/** Per-IP cap on gif search calls — generous enough for a debounced picker, cheap to abuse otherwise. */
const GIF_SEARCH_RATE_LIMIT_MAX = 30;
const GIF_SEARCH_RATE_LIMIT_WINDOW_MS = 60_000;

@ApiTags("chat")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("chat")
export class ChatController {
	constructor(
		private readonly chatService: ChatService,
		private readonly gifService: GifService,
		private readonly rateLimiter: RateLimiterService,
	) {}

	/** GET /api/chat/conversations — list every conversation the user belongs to. */
	@Get("conversations")
	listConversations(
		@Request() req: { user: { id: number } },
	): Promise<ConversationSummaryView[]> {
		return this.chatService.listConversations(req.user.id);
	}

	/** POST /api/chat/conversations/direct — get or create a dm with another user. */
	@Post("conversations/direct")
	@HttpCode(200)
	startDirectMessage(
		@Request() req: { user: { id: number } },
		@Body() body: StartDirectMessageDto,
	): Promise<Conversation> {
		return this.chatService.getOrCreateDirectConversation(
			req.user.id,
			body.userId,
		);
	}

	/** POST /api/chat/conversations/group — create a group conversation. */
	@Post("conversations/group")
	@HttpCode(201)
	createGroup(
		@Request() req: { user: { id: number } },
		@Body() body: CreateGroupDto,
	): Promise<Conversation> {
		return this.chatService.createGroup(
			req.user.id,
			body.name,
			body.memberUserIds,
		);
	}

	/**
	 * GET /api/chat/conversations/:id/messages — paginated history, newest
	 * first. Pass `before` (an ISO timestamp) to fetch the previous page.
	 */
	@Get("conversations/:id/messages")
	listMessages(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
		@Query("before") before?: string,
		@Query("limit") limit?: string,
	): Promise<MessageView[]> {
		const beforeDate = this.parseOptionalDate(before);
		const limitNumber = this.parseOptionalPositiveInt(limit);
		return this.chatService.listMessages(conversationId, req.user.id, {
			before: beforeDate,
			limit: limitNumber,
		});
	}

	/** POST /api/chat/conversations/:id/messages — send a message (REST fallback path). */
	@Post("conversations/:id/messages")
	@HttpCode(201)
	sendMessage(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
		@Body() body: SendMessageDto,
	): Promise<MessageView> {
		return this.chatService.sendMessage(conversationId, req.user.id, body.body);
	}

	/**
	 * GET /api/chat/gifs/search?q=... — proxy a gif search to Klipy. Rate
	 * limited per-IP since it's an authenticated but otherwise unrestricted
	 * fan-out to a paid third-party API.
	 */
	@Get("gifs/search")
	searchGifs(
		@Req() req: ExpressRequest,
		@Query("q") q?: string,
	): Promise<GifSearchResult[]> {
		if (!this.rateLimiter.allow(
			req,
			"gif-search",
			GIF_SEARCH_RATE_LIMIT_MAX,
			GIF_SEARCH_RATE_LIMIT_WINDOW_MS,
		)) {
			throw TooManyRequests("Too many gif searches — try again shortly.");
		}
		const query = q?.trim() ?? "";
		if (!query) return Promise.resolve([]);
		return this.gifService.search(query);
	}

	/**
	 * POST /api/chat/conversations/:id/messages/gif — send a gif message
	 * (REST fallback path, mirrors POST .../messages for text).
	 */
	@Post("conversations/:id/messages/gif")
	@HttpCode(201)
	sendGifMessage(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
		@Body() body: SendGifMessageDto,
	): Promise<MessageView> {
		return this.chatService.sendGifMessage(conversationId, req.user.id, body.slug);
	}

	/**
	 * POST /api/chat/conversations/:id/members — add a friend to an existing
	 * group. The caller must be a current participant and a friend of the
	 * user being added.
	 */
	@Post("conversations/:id/members")
	@HttpCode(200)
	async addGroupMember(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
		@Body() body: AddGroupMemberDto,
	): Promise<{ ok: boolean }> {
		await this.chatService.addGroupMember(conversationId, req.user.id, body.userId);
		return { ok: true };
	}

	/**
	 * POST /api/chat/conversations/:id/leave — leave a group. There is no
	 * "remove member" action by design; this is the only way membership
	 * changes downward.
	 */
	@Post("conversations/:id/leave")
	@HttpCode(200)
	async leaveGroup(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
	): Promise<{ ok: boolean }> {
		await this.chatService.leaveGroup(conversationId, req.user.id);
		return { ok: true };
	}

	/** POST /api/chat/conversations/:id/read — move the caller's read cursor to now. */
	@Post("conversations/:id/read")
	@HttpCode(200)
	async markRead(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
	): Promise<{ ok: boolean }> {
		await this.chatService.markRead(conversationId, req.user.id);
		return { ok: true };
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	private parseOptionalDate(value?: string): Date | undefined {
		if (!value) return undefined;
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			throw new BadRequestException("Invalid 'before' timestamp");
		}
		return parsed;
	}

	private parseOptionalPositiveInt(value?: string): number | undefined {
		if (value === undefined) return undefined;
		const parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			throw new BadRequestException("Invalid 'limit' value");
		}
		return parsed;
	}
}
