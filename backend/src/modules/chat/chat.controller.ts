import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpException,
	Param,
	ParseIntPipe,
	Patch,
	Post,
	Query,
	Req,
	Request,
	UploadedFile,
	UseGuards,
	UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "crypto";
import type { Request as ExpressRequest } from "express";
import { diskStorage } from "multer";
import { extname, join } from "path";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RateLimiterService } from "../auth/rate-limiter.service";
import {
	ChatService,
	ConversationSummaryView,
	GroupMemberView,
	MessageView,
	UnreadConversationView,
} from "./chat.service";
import {
	AddGroupMemberDto,
	CreateGroupDto,
	RenameGroupDto,
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

/**
 * Per-user cap on outbound messages (text + gif share the bucket), keyed on
 * the authenticated user id so it applies regardless of source IP. Mirrors the
 * socket-side limit in MatchmakingGateway so neither path can flood a
 * conversation (Bug Audit M7).
 */
const MESSAGE_SEND_RATE_LIMIT_MAX = 30;
const MESSAGE_SEND_RATE_LIMIT_WINDOW_MS = 10_000;

/** Hard cap on a single message-history page, to bound the query (Bug Audit M6). */
const MESSAGE_PAGE_MAX_LIMIT = 100;

/** Group-photo uploads — same accepted types, size cap, and destination as user avatars (users.controller.ts). */
const ALLOWED_IMAGE_MIMES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_UPLOAD_DIR = join(
	process.env.UPLOADS_DIR ?? join(process.cwd(), "uploads"),
	"avatars",
);

/**
 * Minimal type for the file object injected by multer's diskStorage — mirrors
 * the local definition in users.controller.ts to avoid a hard dependency on
 * @types/multer at the module boundary.
 */
interface MulterFile {
	mimetype: string;
	size: number;
	filename: string;
	path: string;
}

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

	/**
	 * GET /api/chat/unread — the caller's current unread-conversation digest.
	 * REST hydration source mirroring GET /notifications: the live
	 * `chat:unread-inbox` socket push only fires at connect time, but the game
	 * socket is a module-level singleton that survives route changes, so a
	 * freshly-mounted HomePage needs this to rebuild its unread set (Bug B1).
	 * Membership scoping lives inside the service.
	 */
	@Get("unread")
	listUnread(
		@Request() req: { user: { id: number } },
	): Promise<UnreadConversationView[]> {
		return this.chatService.listUnreadConversations(req.user.id);
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
	 * first. Pass `beforeId` (the oldest message id seen so far) to fetch the
	 * previous page. An id cursor, not a timestamp, so pages can't skip
	 * messages that share a millisecond (Bug B6).
	 */
	@Get("conversations/:id/messages")
	listMessages(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
		@Query("beforeId") beforeId?: string,
		@Query("limit") limit?: string,
	): Promise<MessageView[]> {
		const beforeIdNumber = this.parseOptionalId(beforeId);
		const limitNumber = this.parseOptionalPositiveInt(limit);
		return this.chatService.listMessages(conversationId, req.user.id, {
			beforeId: beforeIdNumber,
			limit: limitNumber,
		});
	}

	/** POST /api/chat/conversations/:id/messages — send a message (REST fallback path). */
	@Post("conversations/:id/messages")
	@HttpCode(201)
	async sendMessage(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
		@Body() body: SendMessageDto,
	): Promise<MessageView> {
		this.enforceSendRateLimit(req.user.id);
		const view = await this.chatService.sendMessage(
			conversationId,
			req.user.id,
			body.body,
		);
		this.chatService.broadcastMessage(view);
		return view;
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
	async sendGifMessage(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
		@Body() body: SendGifMessageDto,
	): Promise<MessageView> {
		this.enforceSendRateLimit(req.user.id);
		const view = await this.chatService.sendGifMessage(
			conversationId,
			req.user.id,
			body.slug,
		);
		this.chatService.broadcastMessage(view);
		return view;
	}

	/** Throw 429 if the user has exceeded the shared text+gif send window. */
	private enforceSendRateLimit(userId: number): void {
		if (
			!this.rateLimiter.allowKey(
				"chat-send",
				String(userId),
				MESSAGE_SEND_RATE_LIMIT_MAX,
				MESSAGE_SEND_RATE_LIMIT_WINDOW_MS,
			)
		) {
			throw TooManyRequests("You're sending messages too fast.");
		}
	}

	/**
	 * GET /api/chat/conversations/:id/members — list a group's members
	 * (participant-only). Backs the member-list UI (Decision 2).
	 */
	@Get("conversations/:id/members")
	listGroupMembers(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
	): Promise<GroupMemberView[]> {
		return this.chatService.listGroupMembers(conversationId, req.user.id);
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
	 * DELETE /api/chat/conversations/:id/members/:userId — owner-only: remove a
	 * member from a group (Decision 1, supersedes the 2026-07-07 "no kick"
	 * decision). Authorisation (owner check) lives in the service.
	 */
	@Delete("conversations/:id/members/:userId")
	@HttpCode(200)
	async kickGroupMember(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
		@Param("userId", ParseIntPipe) userId: number,
	): Promise<{ ok: boolean }> {
		await this.chatService.kickMember(conversationId, req.user.id, userId);
		return { ok: true };
	}

	/**
	 * PATCH /api/chat/conversations/:id — owner-only: rename a group
	 * (Decision 1). Owner check lives in the service.
	 */
	@Patch("conversations/:id")
	@HttpCode(200)
	async renameGroup(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
		@Body() body: RenameGroupDto,
	): Promise<{ ok: boolean }> {
		await this.chatService.renameGroup(conversationId, req.user.id, body.name);
		return { ok: true };
	}

	/**
	 * POST /api/chat/conversations/:id/avatar — owner-only: set the group
	 * photo. Accepts a single multipart file under the field name "avatar",
	 * written to the same persistent uploads volume as user avatars (served
	 * through /api/uploads/). Owner check lives in the service.
	 */
	@Post("conversations/:id/avatar")
	@HttpCode(200)
	@UseInterceptors(
		FileInterceptor("avatar", {
			storage: diskStorage({
				destination: AVATAR_UPLOAD_DIR,
				filename: (_req, file, cb) => {
					const ext = extname(file.originalname);
					cb(null, `${randomUUID()}${ext}`);
				},
			}),
			limits: { fileSize: AVATAR_MAX_BYTES },
			fileFilter: (_req, file, cb) => {
				cb(
					null,
					(ALLOWED_IMAGE_MIMES as readonly string[]).includes(
						file.mimetype,
					),
				);
			},
		}),
	)
	uploadGroupAvatar(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
		@UploadedFile() file: MulterFile,
	): Promise<{ avatarUrl: string }> {
		if (!file) {
			throw new BadRequestException(
				"No valid image file provided. Accepted types: JPEG, PNG, WebP, GIF. Max size: 2 MB.",
			);
		}
		return this.chatService.updateGroupAvatar(
			conversationId,
			req.user.id,
			file.filename,
		);
	}

	/**
	 * DELETE /api/chat/conversations/:id — owner-only: delete a group and all
	 * its messages (Decision 1). Owner check lives in the service.
	 */
	@Delete("conversations/:id")
	@HttpCode(200)
	async deleteGroup(
		@Request() req: { user: { id: number } },
		@Param("id", ParseIntPipe) conversationId: number,
	): Promise<{ ok: boolean }> {
		await this.chatService.deleteGroup(conversationId, req.user.id);
		return { ok: true };
	}

	/**
	 * POST /api/chat/conversations/:id/leave — leave a group. Members leave
	 * themselves; the owner-only kick action is DELETE .../members/:userId.
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

	private parseOptionalId(value?: string): number | undefined {
		if (value === undefined) return undefined;
		const parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			throw new BadRequestException("Invalid 'beforeId' value");
		}
		return parsed;
	}

	private parseOptionalPositiveInt(value?: string): number | undefined {
		if (value === undefined) return undefined;
		const parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			throw new BadRequestException("Invalid 'limit' value");
		}
		// Clamp rather than reject: an over-large page is a client bug (or an
		// attempt to load an unbounded page with sender relations), not worth a
		// 400 — but it must never reach the DB uncapped (Bug Audit M6).
		return Math.min(parsed, MESSAGE_PAGE_MAX_LIMIT);
	}
}
