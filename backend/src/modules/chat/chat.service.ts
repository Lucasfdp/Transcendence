import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, In, LessThan, Not, Repository } from "typeorm";
import type { Server } from "socket.io";
import { FriendsService } from "../friends/friends.service";
import { PresenceService } from "../presence/presence.service";
import { User } from "../users/entities/user.entity";
import { ConversationParticipant } from "./entities/conversation-participant.entity";
import { Conversation, ConversationType } from "./entities/conversation.entity";
import {
	Message,
	MESSAGE_BODY_MAX_LENGTH,
	MessageType,
} from "./entities/message.entity";
import { GifService } from "./gif.service";

/** Fallback message body when a gif's Klipy title is blank. */
const GIF_FALLBACK_TITLE = "GIF";

/** Default page size for paginated message history fetches. */
const DEFAULT_MESSAGE_PAGE_SIZE = 50;

/** Length of the preview text denormalised onto the conversation for list views. */
const MESSAGE_PREVIEW_MAX_LENGTH = 120;

/** Socket.IO room name for a conversation — shared with MatchmakingGateway. */
export function chatRoomName(conversationId: number): string {
	return `chat:${conversationId}`;
}

/**
 * Pushed once to a socket on connect — every conversation currently unread
 * for that user (see ChatService.listUnreadConversations).
 */
export const WS_EVENT_CHAT_UNREAD_INBOX = "chat:unread-inbox" as const;

/**
 * Pushed live exactly once per read→unread *transition* — i.e. the first
 * message since a participant last read a conversation, not every message
 * after that. This is deliberately a separate, chat-only event family
 * (rather than folding into NotificationsService's `notification:*` events)
 * so a chat message never persists a `Notification` row; "unread" is fully
 * derived from `Conversation.lastMessageAt` vs.
 * `ConversationParticipant.lastReadAt`, with nothing to keep in sync.
 */
export const WS_EVENT_CHAT_UNREAD = "chat:unread" as const;

/**
 * Pushed to every one of a user's OWN connected sockets after they mark a
 * conversation read — so a second open tab/device clears its unread
 * indicator immediately instead of waiting for its next reconnect.
 */
export const WS_EVENT_CHAT_READ_SYNC = "chat:read-sync" as const;

export interface ConversationSummaryView {
	id: number;
	type: ConversationType;
	/** Group name, or the other participant's username for a dm. */
	name: string | null;
	/** The other participant's id, for a dm. Null for groups. */
	otherUserId: number | null;
	/** The other participant's avatar, for a dm. Null for groups. */
	avatar: string | null;
	lastMessageAt: string | null;
	lastMessagePreview: string | null;
}

export interface MessageView {
	id: number;
	conversationId: number;
	senderId: number;
	senderUsername: string;
	type: MessageType;
	body: string;
	metadata: Record<string, unknown> | null;
	createdAt: string;
}

export interface ListMessagesOptions {
	/** Fetch messages strictly older than this timestamp (pagination cursor). */
	before?: Date;
	limit?: number;
}

/**
 * Trusted metadata for a `type: "gif"` message — always built server-side
 * from GifService.getBySlug, never from client-supplied fields. See
 * ChatService.sendGifMessage.
 */
export interface GifMessageMetadata extends Record<string, unknown> {
	provider: "klipy";
	slug: string;
	url: string;
	previewUrl: string;
	width: number;
	height: number;
}

export interface UnreadConversationView {
	conversationId: number;
	type: ConversationType;
	/** Group name, or the sender's username for a dm — always from the recipient's POV. */
	title: string;
	preview: string | null;
	lastMessageAt: string;
}

@Injectable()
export class ChatService {
	/** Set by MatchmakingGateway.afterInit() — same wiring NotificationsService uses. */
	private server: Server | null = null;

	constructor(
		@InjectRepository(Conversation)
		private readonly conversationRepo: Repository<Conversation>,
		@InjectRepository(ConversationParticipant)
		private readonly participantRepo: Repository<ConversationParticipant>,
		@InjectRepository(Message)
		private readonly messageRepo: Repository<Message>,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
		private readonly presence: PresenceService,
		private readonly friendsService: FriendsService,
		private readonly gifService: GifService,
	) {}

	/** Called once by MatchmakingGateway.afterInit() to wire up real-time push. */
	setServer(server: Server): void {
		this.server = server;
	}

	/**
	 * Canonical `min(userId):max(userId)` key for a dm pair — order-independent
	 * so `dmKeyFor(a, b) === dmKeyFor(b, a)`. Matches the unique index on
	 * `conversations.dmKey` (migration `20260704010000-add-conversations-dmkey`).
	 */
	private dmKeyFor(userAId: number, userBId: number): string {
		return userAId < userBId
			? `${userAId}:${userBId}`
			: `${userBId}:${userAId}`;
	}

	/**
	 * Find the existing dm conversation between two users, or create one.
	 * Idempotent — never creates a second dm conversation for the same pair,
	 * even under a race between two concurrent calls for the same pair
	 * (Bug Audit M3): the lookup and the insert both go through the same
	 * `dmKey`, which is backed by a DB-level unique index, so a losing
	 * concurrent insert fails with `23505` and is handled by re-reading the
	 * winner's row instead of erroring out.
	 *
	 * An existing conversation is always returned regardless of current
	 * friendship status (a DM is frozen, never deleted, once the users are no
	 * longer friends — see sendMessage). Starting a *brand-new* DM requires
	 * being friends right now.
	 */
	async getOrCreateDirectConversation(
		userAId: number,
		userBId: number,
	): Promise<Conversation> {
		try {
			if (userAId === userBId) {
				throw new BadRequestException("You cannot message yourself");
			}

			const dmKey = this.dmKeyFor(userAId, userBId);

			const existing = await this.conversationRepo.findOne({
				where: { dmKey },
			});
			if (existing) return existing;

			const areFriends = await this.friendsService.areFriends(
				userAId,
				userBId,
			);
			if (!areFriends) {
				throw new ForbiddenException(
					"You can only start a conversation with a friend",
				);
			}

			const other = await this.userRepo.findOne({ where: { id: userBId } });
			if (!other) throw new NotFoundException("User not found");

			let conversation: Conversation;
			try {
				conversation = await this.conversationRepo.manager.transaction(
					async (em) => {
						const created = await em.save(
							em.create(Conversation, { type: "dm", dmKey }),
						);
						await em.save(ConversationParticipant, [
							em.create(ConversationParticipant, {
								conversationId: created.id,
								userId: userAId,
							}),
							em.create(ConversationParticipant, {
								conversationId: created.id,
								userId: userBId,
							}),
						]);
						return created;
					},
				);
			} catch (err: unknown) {
				// Unique violation on dmKey: a concurrent call for the same pair
				// won the race and created the conversation first. Re-read and
				// return that row instead of failing — this is what makes the
				// operation actually idempotent under concurrency, not just
				// "usually" idempotent (Bug Audit M3).
				const pg = err as { code?: string };
				if (pg?.code === "23505") {
					const raceWinner = await this.conversationRepo.findOne({
						where: { dmKey },
					});
					if (raceWinner) {
						this.joinLiveParticipants(raceWinner.id, [userAId, userBId]);
						return raceWinner;
					}
				}
				throw err;
			}

			// Bring any already-connected participant sockets into the room now,
			// so live delivery works immediately without waiting for a reconnect.
			this.joinLiveParticipants(conversation.id, [userAId, userBId]);
			return conversation;
		} catch (err) {
			if (
				err instanceof BadRequestException ||
				err instanceof NotFoundException ||
				err instanceof ForbiddenException
			) {
				throw err;
			}
			throw new InternalServerErrorException(
				"Failed to start direct conversation",
			);
		}
	}

	/**
	 * Create a group conversation. `ownerId` is always added as a participant;
	 * duplicates and the owner's own id are silently dropped from
	 * `memberUserIds`.
	 *
	 * The owner must be friends with every member being added — group
	 * membership requires a friendship with whoever added you, not with every
	 * other member (see addGroupMember for the same rule applied later).
	 */
	async createGroup(
		ownerId: number,
		name: string,
		memberUserIds: number[],
	): Promise<Conversation> {
		try {
			const trimmedName = name.trim();
			if (trimmedName.length === 0) {
				throw new BadRequestException("Group name cannot be empty");
			}

			const uniqueMemberIds = [
				...new Set(memberUserIds.filter((id) => id !== ownerId)),
			];
			if (uniqueMemberIds.length === 0) {
				throw new BadRequestException(
					"A group needs at least one other member",
				);
			}

			const members = await this.userRepo.find({
				where: { id: In(uniqueMemberIds) },
			});
			if (members.length !== uniqueMemberIds.length) {
				throw new NotFoundException("One or more members were not found");
			}

			const friendChecks = await Promise.all(
				uniqueMemberIds.map((id) => this.friendsService.areFriends(ownerId, id)),
			);
			if (friendChecks.some((isFriend) => !isFriend)) {
				throw new ForbiddenException("You can only add friends to a group");
			}

			const conversation = await this.conversationRepo.manager.transaction(
				async (em) => {
					const created = await em.save(
						em.create(Conversation, {
							type: "group",
							name: trimmedName,
							ownerId,
						}),
					);

					const participantRows = [ownerId, ...uniqueMemberIds].map(
						(userId) =>
							em.create(ConversationParticipant, {
								conversationId: created.id,
								userId,
							}),
					);
					await em.save(ConversationParticipant, participantRows);

					return created;
				},
			);

			this.joinLiveParticipants(conversation.id, [ownerId, ...uniqueMemberIds]);
			return conversation;
		} catch (err) {
			if (
				err instanceof BadRequestException ||
				err instanceof NotFoundException ||
				err instanceof ForbiddenException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to create group");
		}
	}

	/**
	 * Leave a group you're a participant in. There is deliberately no
	 * "remove member" / kick action — the only way to stop being in a group
	 * is to leave it yourself.
	 *
	 * Posts a "system" message so remaining members see why someone
	 * disappeared. Invoked over REST (there's no dedicated socket event for
	 * it, same as createGroup/addGroupMember), so — like NotificationsService
	 * does for its REST-triggered pushes — this pushes the message to the
	 * room itself rather than relying on a gateway wrapper to broadcast it.
	 */
	async leaveGroup(conversationId: number, userId: number): Promise<void> {
		try {
			const conversation = await this.conversationRepo.findOne({
				where: { id: conversationId },
			});
			if (!conversation) throw new NotFoundException("Conversation not found");
			if (conversation.type !== "group") {
				throw new BadRequestException("Only group conversations can be left");
			}

			const membership = await this.participantRepo.findOne({
				where: { conversationId, userId },
			});
			if (!membership) {
				throw new ForbiddenException(
					"You are not a participant in this conversation",
				);
			}

			const user = await this.userRepo.findOne({ where: { id: userId } });

			await this.participantRepo.delete({ conversationId, userId });

			const systemMessage = await this.messageRepo.save(
				this.messageRepo.create({
					conversationId,
					senderId: userId,
					type: "system",
					body: `${user?.username ?? "Someone"} left the group`,
				}),
			);

			conversation.lastMessageAt = systemMessage.createdAt;
			conversation.lastMessagePreview = systemMessage.body.slice(
				0,
				MESSAGE_PREVIEW_MAX_LENGTH,
			);
			await this.conversationRepo.save(conversation);

			const view: MessageView = {
				id: systemMessage.id,
				conversationId,
				senderId: userId,
				senderUsername: user?.username ?? "",
				type: "system",
				body: systemMessage.body,
				metadata: null,
				createdAt: systemMessage.createdAt.toISOString(),
			};
			this.server?.to(chatRoomName(conversationId)).emit("chat:message", view);
			this.leaveLiveParticipant(conversationId, userId);
		} catch (err) {
			if (
				err instanceof NotFoundException ||
				err instanceof BadRequestException ||
				err instanceof ForbiddenException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to leave group");
		}
	}

	/**
	 * Add a member to an existing group. Any current participant may add a
	 * new member, but only if they are friends with them (the same
	 * adder-friend rule createGroup enforces at creation time) — members do
	 * not need to be friends with every other existing member.
	 */
	async addGroupMember(
		conversationId: number,
		actorId: number,
		newMemberId: number,
	): Promise<void> {
		try {
			const conversation = await this.conversationRepo.findOne({
				where: { id: conversationId },
			});
			if (!conversation) throw new NotFoundException("Conversation not found");
			if (conversation.type !== "group") {
				throw new BadRequestException(
					"Only group conversations support adding members",
				);
			}

			const actorMembership = await this.participantRepo.findOne({
				where: { conversationId, userId: actorId },
			});
			if (!actorMembership) {
				throw new ForbiddenException(
					"You are not a participant in this conversation",
				);
			}

			const alreadyMember = await this.participantRepo.findOne({
				where: { conversationId, userId: newMemberId },
			});
			if (alreadyMember) {
				throw new ConflictException("User is already a member of this group");
			}

			const newMember = await this.userRepo.findOne({
				where: { id: newMemberId },
			});
			if (!newMember) throw new NotFoundException("User not found");

			const areFriends = await this.friendsService.areFriends(
				actorId,
				newMemberId,
			);
			if (!areFriends) {
				throw new ForbiddenException("You can only add friends to a group");
			}

			await this.participantRepo.save(
				this.participantRepo.create({ conversationId, userId: newMemberId }),
			);

			this.joinLiveParticipants(conversationId, [newMemberId]);
		} catch (err) {
			if (
				err instanceof BadRequestException ||
				err instanceof NotFoundException ||
				err instanceof ForbiddenException ||
				err instanceof ConflictException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to add group member");
		}
	}

	/**
	 * Persist a message and denormalise it onto the conversation
	 * (`lastMessageAt` / `lastMessagePreview`) for cheap list sorting and
	 * unread derivation (see Batch 4).
	 *
	 * DMs are "frozen" (readable, not sendable) once the two users are no
	 * longer accepted friends — whether from an explicit block or a plain
	 * unfriend, since both leave no "accepted" friendship row. Groups are
	 * unaffected: a block between two group members has no effect on the
	 * group (locked product decision), so this check only runs for dm's.
	 */
	async sendMessage(
		conversationId: number,
		senderId: number,
		body: string,
		type: MessageType = "text",
		metadata: Record<string, unknown> | null = null,
	): Promise<MessageView> {
		try {
			const trimmed = body.trim();
			if (trimmed.length === 0) {
				throw new BadRequestException("Message body cannot be empty");
			}
			if (trimmed.length > MESSAGE_BODY_MAX_LENGTH) {
				throw new BadRequestException(
					`Message body cannot exceed ${MESSAGE_BODY_MAX_LENGTH} characters`,
				);
			}

			const conversation = await this.conversationRepo.findOne({
				where: { id: conversationId },
			});
			if (!conversation) {
				throw new NotFoundException("Conversation not found");
			}

			const membership = await this.participantRepo.findOne({
				where: { conversationId, userId: senderId },
			});
			if (!membership) {
				throw new ForbiddenException(
					"You are not a participant in this conversation",
				);
			}

			// Fetched once and reused for both the dm friend re-check below and
			// the read→unread transition push after the message is saved.
			const otherParticipants = await this.participantRepo.find({
				where: { conversationId, userId: Not(senderId) },
			});

			if (conversation.type === "dm") {
				const otherParticipant = otherParticipants[0];
				if (otherParticipant) {
					const areFriends = await this.friendsService.areFriends(
						senderId,
						otherParticipant.userId,
					);
					if (!areFriends) {
						throw new ForbiddenException(
							"You can no longer message this user",
						);
					}
				}
			}

			// Captured before the overwrite below — the transition push needs to
			// compare each recipient's read cursor against the *pre-send* state.
			const previousLastMessageAt = conversation.lastMessageAt;

			const saved = await this.messageRepo.save(
				this.messageRepo.create({
					conversationId,
					senderId,
					type,
					body: trimmed,
					metadata,
				}),
			);

			conversation.lastMessageAt = saved.createdAt;
			conversation.lastMessagePreview = trimmed.slice(
				0,
				MESSAGE_PREVIEW_MAX_LENGTH,
			);
			await this.conversationRepo.save(conversation);

			// save() doesn't populate the `sender` relation — reload it so the
			// pushed/returned view has a real senderUsername. Non-fatal: fall
			// back to the un-related row (blank username) rather than failing
			// the whole send.
			const withSender = await this.messageRepo
				.findOne({ where: { id: saved.id }, relations: ["sender"] })
				.catch(() => null);

			const view = this.toMessageView(withSender ?? saved);

			this.pushUnreadTransitions(
				conversation,
				otherParticipants,
				previousLastMessageAt,
				view.senderUsername,
			);

			return view;
		} catch (err) {
			if (
				err instanceof BadRequestException ||
				err instanceof NotFoundException ||
				err instanceof ForbiddenException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to send message");
		}
	}

	/**
	 * Send a gif message. The client only ever supplies an opaque `slug`
	 * (from a prior /chat/gifs/search result); the trusted url/previewUrl/
	 * width/height/title are re-fetched from Klipy here via
	 * GifService.getBySlug, then handed to the same sendMessage() used for
	 * text — so gif sends get the exact same membership/friend-gating,
	 * denormalisation, and unread-transition behaviour for free.
	 */
	async sendGifMessage(
		conversationId: number,
		senderId: number,
		slug: string,
	): Promise<MessageView> {
		const gif = await this.gifService.getBySlug(slug);
		const metadata: GifMessageMetadata = {
			provider: "klipy",
			slug: gif.slug,
			url: gif.url,
			previewUrl: gif.previewUrl,
			width: gif.width,
			height: gif.height,
		};
		const body = gif.title.trim().length > 0 ? gif.title.trim() : GIF_FALLBACK_TITLE;
		return this.sendMessage(conversationId, senderId, body, "gif", metadata);
	}

	/** List every conversation a user belongs to, most recent activity first. */
	async listConversations(userId: number): Promise<ConversationSummaryView[]> {
		try {
			const participations = await this.participantRepo.find({
				where: { userId },
				relations: ["conversation"],
			});
			if (participations.length === 0) return [];

			const conversationIds = participations.map((p) => p.conversationId);
			const allParticipants = await this.participantRepo.find({
				where: { conversationId: In(conversationIds) },
				relations: ["user"],
			});

			const views = participations.map((p) =>
				this.toConversationSummaryView(p.conversation, userId, allParticipants),
			);

			// Non-mutating sort (this array is about to be returned to the
			// caller) — most recent activity first, never-messaged last.
			return [...views].sort((a, b) => {
				if (!a.lastMessageAt && !b.lastMessageAt) return 0;
				if (!a.lastMessageAt) return 1;
				if (!b.lastMessageAt) return -1;
				return b.lastMessageAt.localeCompare(a.lastMessageAt);
			});
		} catch {
			throw new InternalServerErrorException("Failed to list conversations");
		}
	}

	/**
	 * Every conversation currently unread for a user — "unread" is fully
	 * derived (`Conversation.lastMessageAt` vs.
	 * `ConversationParticipant.lastReadAt`), not a persisted row, so there is
	 * nothing to reconcile when a conversation is read: the entry simply
	 * stops appearing here once `markRead` runs.
	 */
	async listUnreadConversations(userId: number): Promise<UnreadConversationView[]> {
		try {
			const participations = await this.participantRepo.find({
				where: { userId },
				relations: ["conversation"],
			});
			const unread = participations.filter((p) => this.isUnread(p));
			if (unread.length === 0) return [];

			const conversationIds = unread.map((p) => p.conversationId);
			const allParticipants = await this.participantRepo.find({
				where: { conversationId: In(conversationIds) },
				relations: ["user"],
			});

			return unread.map((p) =>
				this.toUnreadConversationView(p.conversation, userId, allParticipants),
			);
		} catch {
			throw new InternalServerErrorException(
				"Failed to list unread conversations",
			);
		}
	}

	/**
	 * Push the current unread-conversations digest to a single socket.
	 * Called by the gateway on connect (mirrors
	 * NotificationsService.pushInboxToSocket), so late-joining clients see
	 * what's unread without polling REST.
	 */
	async pushUnreadInboxToSocket(socketId: string, userId: number): Promise<void> {
		if (!this.server) return;
		try {
			const unread = await this.listUnreadConversations(userId);
			this.server.to(socketId).emit(WS_EVENT_CHAT_UNREAD_INBOX, unread);
		} catch {
			// Non-fatal: client just won't get the digest on this connect.
		}
	}

	/**
	 * Paginated message history, newest first (pass the oldest `createdAt`
	 * seen so far as `options.before` to load the previous page).
	 */
	async listMessages(
		conversationId: number,
		userId: number,
		options: ListMessagesOptions = {},
	): Promise<MessageView[]> {
		try {
			const membership = await this.participantRepo.findOne({
				where: { conversationId, userId },
			});
			if (!membership) {
				throw new ForbiddenException(
					"You are not a participant in this conversation",
				);
			}

			const where: FindOptionsWhere<Message> = { conversationId };
			if (options.before) {
				where.createdAt = LessThan(options.before);
			}

			const rows = await this.messageRepo.find({
				where,
				relations: ["sender"],
				order: { createdAt: "DESC" },
				take: options.limit ?? DEFAULT_MESSAGE_PAGE_SIZE,
			});

			return rows.map((row) => this.toMessageView(row));
		} catch (err) {
			if (err instanceof ForbiddenException) throw err;
			throw new InternalServerErrorException("Failed to list messages");
		}
	}

	/**
	 * Move a participant's read cursor to now. Pushes `chat:read-sync` to all
	 * of the *same user's* other connected sockets afterwards, so a second
	 * open tab/device clears its unread indicator immediately rather than
	 * waiting for its next reconnect.
	 */
	async markRead(conversationId: number, userId: number): Promise<void> {
		try {
			const membership = await this.participantRepo.findOne({
				where: { conversationId, userId },
			});
			if (!membership) {
				throw new ForbiddenException(
					"You are not a participant in this conversation",
				);
			}

			membership.lastReadAt = new Date();
			await this.participantRepo.save(membership);

			this.pushReadSync(conversationId, userId);
		} catch (err) {
			if (err instanceof ForbiddenException) throw err;
			throw new InternalServerErrorException(
				"Failed to mark conversation as read",
			);
		}
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	/**
	 * Join any currently-connected sockets belonging to `userIds` into the
	 * conversation's room, so live `chat:message` broadcasts reach them
	 * immediately after creation — without this, a participant who was
	 * already online would only start receiving live messages for a
	 * brand-new conversation after their next reconnect.
	 *
	 * No-op (not an error) if the gateway hasn't called setServer() yet, or
	 * if a given user has no active sockets.
	 */
	private joinLiveParticipants(conversationId: number, userIds: number[]): void {
		if (!this.server) return;
		const room = chatRoomName(conversationId);
		for (const userId of userIds) {
			for (const socketId of this.presence.getSocketIds(userId)) {
				this.server.sockets.sockets.get(socketId)?.join(room);
			}
		}
	}

	/** Counterpart to joinLiveParticipants — used when a user leaves a group. */
	private leaveLiveParticipant(conversationId: number, userId: number): void {
		if (!this.server) return;
		const room = chatRoomName(conversationId);
		for (const socketId of this.presence.getSocketIds(userId)) {
			this.server.sockets.sockets.get(socketId)?.leave(room);
		}
	}

	/**
	 * Tell every one of a user's own connected sockets that a conversation is
	 * now read. Deliberately not scoped to "other" sockets — re-notifying the
	 * originating tab is harmless and simpler than tracking which socket made
	 * the request (markRead is called from both REST and the socket handler).
	 */
	private pushReadSync(conversationId: number, userId: number): void {
		if (!this.server) return;
		for (const socketId of this.presence.getSocketIds(userId)) {
			this.server.to(socketId).emit(WS_EVENT_CHAT_READ_SYNC, { conversationId });
		}
	}

	/** True when a participant has messages they haven't read yet. */
	private isUnread(participant: ConversationParticipant): boolean {
		const lastMessageAt = participant.conversation.lastMessageAt;
		if (!lastMessageAt) return false;
		if (!participant.lastReadAt) return true;
		return lastMessageAt > participant.lastReadAt;
	}

	/**
	 * Push a `chat:unread` bell ping to every recipient for whom this message
	 * is the *first* unread one since they last read the conversation — never
	 * for a recipient who already had unread messages before this one, so a
	 * burst of messages only pings the bell once until it's opened.
	 */
	private pushUnreadTransitions(
		conversation: Conversation,
		otherParticipants: ConversationParticipant[],
		previousLastMessageAt: Date | null,
		senderUsername: string,
	): void {
		if (!this.server) return;

		const title = conversation.type === "group" ? conversation.name ?? "" : senderUsername;
		const view: UnreadConversationView = {
			conversationId: conversation.id,
			type: conversation.type,
			title,
			preview: conversation.lastMessagePreview,
			lastMessageAt: conversation.lastMessageAt
				? conversation.lastMessageAt.toISOString()
				: "",
		};

		for (const participant of otherParticipants) {
			const wasCaughtUp =
				previousLastMessageAt === null ||
				(participant.lastReadAt !== null &&
					participant.lastReadAt >= previousLastMessageAt);
			if (!wasCaughtUp) continue;

			for (const socketId of this.presence.getSocketIds(participant.userId)) {
				this.server.to(socketId).emit(WS_EVENT_CHAT_UNREAD, view);
			}
		}
	}

	private toUnreadConversationView(
		conversation: Conversation,
		userId: number,
		allParticipants: ConversationParticipant[],
	): UnreadConversationView {
		let title = conversation.name ?? "";
		if (conversation.type === "dm") {
			const other = allParticipants.find(
				(row) =>
					row.conversationId === conversation.id && row.userId !== userId,
			);
			title = other?.user?.username ?? "";
		}

		return {
			conversationId: conversation.id,
			type: conversation.type,
			title,
			preview: conversation.lastMessagePreview,
			lastMessageAt: conversation.lastMessageAt
				? conversation.lastMessageAt.toISOString()
				: "",
		};
	}

	private toConversationSummaryView(
		conversation: Conversation,
		userId: number,
		allParticipants: ConversationParticipant[],
	): ConversationSummaryView {
		let name = conversation.name;
		let avatar: string | null = null;
		let otherUserId: number | null = null;

		if (conversation.type === "dm") {
			const other = allParticipants.find(
				(row) =>
					row.conversationId === conversation.id && row.userId !== userId,
			);
			name = other?.user?.username ?? null;
			avatar = other?.user?.avatar ?? null;
			otherUserId = other?.userId ?? null;
		}

		return {
			id: conversation.id,
			type: conversation.type,
			name,
			otherUserId,
			avatar,
			lastMessageAt: conversation.lastMessageAt
				? conversation.lastMessageAt.toISOString()
				: null,
			lastMessagePreview: conversation.lastMessagePreview,
		};
	}

	private toMessageView(message: Message): MessageView {
		return {
			id: message.id,
			conversationId: message.conversationId,
			senderId: message.senderId,
			senderUsername: message.sender?.username ?? "",
			type: message.type,
			body: message.body,
			metadata: message.metadata,
			createdAt: message.createdAt.toISOString(),
		};
	}
}
