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

/**
 * Display fallback when a sender's username can't be resolved (e.g. the
 * relation reload failed after save). Better than a blank name in the UI /
 * unread-bell title (Bug Audit L8).
 */
const SENDER_FALLBACK_NAME = "Someone";

/** Default page size for paginated message history fetches. */
const DEFAULT_MESSAGE_PAGE_SIZE = 50;

/** Length of the preview text denormalised onto the conversation for list views. */
const MESSAGE_PREVIEW_MAX_LENGTH = 120;

/** Max group name length — mirrors CreateGroupDto/RenameGroupDto (Decision 1). */
const GROUP_NAME_MAX_LENGTH = 60;

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

/**
 * Pushed to a user who no longer belongs to a conversation — because they were
 * kicked by the owner or the owner deleted the group. The client drops the
 * conversation from its list, closes the thread if it was open, and clears any
 * unread flag (Decision 1).
 */
export const WS_EVENT_CHAT_REMOVED = "chat:removed" as const;

/**
 * Pushed to a group room when its metadata changes so open clients patch the
 * conversation without a full refetch (Decision 1). Payload carries whichever
 * field changed: `name` (owner rename), `avatar` (owner photo change) and/or
 * `ownerId` (ownership transfer when the owner leaves) — so the successor's
 * owner-only controls light up live.
 */
export const WS_EVENT_CHAT_CONVERSATION_UPDATED = "chat:conversation-updated" as const;

export interface ConversationSummaryView {
	id: number;
	type: ConversationType;
	/** Group name, or the other participant's username for a dm. */
	name: string | null;
	/** The other participant's id, for a dm. Null for groups. */
	otherUserId: number | null;
	/** The other participant's avatar for a dm; the group photo for a group. */
	avatar: string | null;
	/** The other participant's equipped shell, for a dm's avatar fallback. Null for groups. */
	shellSkin: string | null;
	/** Group owner's user id (null for dms / owner-deleted groups) — lets the UI gate owner-only controls (Decision 1). */
	ownerId: number | null;
	lastMessageAt: string | null;
	lastMessagePreview: string | null;
}

/** A single group member, for the member-list endpoint (Decision 2). */
export interface GroupMemberView {
	userId: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	avatar: string | null;
	level: number;
	isOnline: boolean;
	/** When they joined — the UI orders members by seniority. */
	joinedAt: string;
	/** True for the current group owner. */
	isOwner: boolean;
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
	/**
	 * Fetch messages strictly older than this message id (pagination cursor).
	 * An id cursor — not a timestamp — because `Message.id` is a monotonic
	 * serial PK, so it can't miss two messages that share a millisecond the
	 * way a truncated `createdAt` cursor could (Bug B6).
	 */
	beforeId?: number;
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
	 * Broadcast an already-persisted message to its conversation room. Used by
	 * the REST send paths (ChatController) so a message sent over HTTP reaches
	 * live sockets too — the socket send path broadcasts from the gateway
	 * handler instead (MatchmakingGateway.onChatSend), so exactly one broadcast
	 * happens per message regardless of which path sent it. No-op until the
	 * gateway has wired the server via setServer().
	 */
	broadcastMessage(view: MessageView): void {
		this.server
			?.to(chatRoomName(view.conversationId))
			.emit("chat:message", view);
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
	 * Persist a `system` message, denormalise it onto the conversation
	 * (`lastMessageAt` / `lastMessagePreview`), and broadcast it to the room.
	 * Shared by every membership-change action (leave / add / kick / rename /
	 * ownership transfer) so they all notify the room through one path, the
	 * same way NotificationsService pushes its REST-triggered events straight
	 * to the room rather than relying on a gateway wrapper.
	 */
	private async postSystemMessage(
		conversation: Conversation,
		actorId: number,
		actorUsername: string,
		body: string,
	): Promise<MessageView> {
		const systemMessage = await this.messageRepo.save(
			this.messageRepo.create({
				conversationId: conversation.id,
				senderId: actorId,
				type: "system",
				body,
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
			conversationId: conversation.id,
			senderId: actorId,
			senderUsername: actorUsername,
			type: "system",
			body: systemMessage.body,
			metadata: null,
			createdAt: systemMessage.createdAt.toISOString(),
		};
		this.server?.to(chatRoomName(conversation.id)).emit("chat:message", view);
		return view;
	}

	/**
	 * Leave a group you're a participant in.
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

			// If the last member just left, the conversation is now unreachable
			// (nobody can list or rejoin it — addGroupMember requires an existing
			// participant), so delete it and its messages rather than leaking an
			// orphaned row forever (Bug Audit M10). No system message / broadcast:
			// there is no one left to receive it.
			const remaining = await this.participantRepo.count({
				where: { conversationId },
			});
			if (remaining === 0) {
				await this.messageRepo.delete({ conversationId });
				await this.conversationRepo.delete({ id: conversationId });
				this.leaveLiveParticipant(conversationId, userId);
				return;
			}

			await this.postSystemMessage(
				conversation,
				userId,
				user?.username ?? "",
				`${user?.username ?? "Someone"} left the group`,
			);

			// If the owner is the one leaving and members remain, hand ownership to
			// the longest-standing remaining participant so the group never gets
			// stuck with an absent owner (Decision 1). joinedAt ASC, id ASC picks
			// the most senior member deterministically. postSystemMessage persists
			// the new ownerId along with the message denormalise.
			if (conversation.ownerId === userId) {
				const successor = await this.participantRepo.findOne({
					where: { conversationId },
					order: { joinedAt: "ASC", id: "ASC" },
				});
				if (successor) {
					conversation.ownerId = successor.userId;
					const newOwner = await this.userRepo.findOne({
						where: { id: successor.userId },
					});
					await this.postSystemMessage(
						conversation,
						successor.userId,
						newOwner?.username ?? "",
						`${newOwner?.username ?? "Someone"} is now the group owner`,
					);
					// Tell open clients the owner changed so the new owner's
					// owner-only controls (rename/delete/kick) light up live without
					// a Social refetch (Decision 1).
					this.server
						?.to(chatRoomName(conversationId))
						.emit(WS_EVENT_CHAT_CONVERSATION_UPDATED, {
							conversationId,
							ownerId: successor.userId,
						});
				}
			}

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
	 * Load a group and assert the caller owns it — the shared gate for every
	 * owner-only action (kick / rename / delete). Throws NotFound for a missing
	 * or non-group conversation and Forbidden for a non-owner (including the
	 * null-owner case where the owner deleted their account, Decision 1).
	 */
	private async loadOwnedGroup(
		conversationId: number,
		actorId: number,
	): Promise<Conversation> {
		const conversation = await this.conversationRepo.findOne({
			where: { id: conversationId },
		});
		if (!conversation || conversation.type !== "group") {
			throw new NotFoundException("Group not found");
		}
		if (conversation.ownerId !== actorId) {
			throw new ForbiddenException("Only the group owner can do that");
		}
		return conversation;
	}

	/**
	 * Owner-only: remove a member from a group (Decision 1 — supersedes the
	 * 2026-07-07 "no kick by design" decision). Posts a system message,
	 * detaches the kicked user's sockets, and pushes them a `chat:removed` so
	 * their client drops the conversation.
	 */
	async kickMember(
		conversationId: number,
		actorId: number,
		targetId: number,
	): Promise<void> {
		try {
			const conversation = await this.loadOwnedGroup(conversationId, actorId);

			if (targetId === actorId) {
				throw new BadRequestException(
					"You cannot remove yourself; leave the group instead",
				);
			}

			const membership = await this.participantRepo.findOne({
				where: { conversationId, userId: targetId },
			});
			if (!membership) {
				throw new NotFoundException("User is not a member of this group");
			}

			await this.participantRepo.delete({ conversationId, userId: targetId });

			// Detach the kicked user's sockets BEFORE broadcasting the system
			// message so they don't receive their own removal note.
			this.leaveLiveParticipant(conversationId, targetId);

			const [actor, target] = await Promise.all([
				this.userRepo.findOne({ where: { id: actorId } }),
				this.userRepo.findOne({ where: { id: targetId } }),
			]);
			await this.postSystemMessage(
				conversation,
				actorId,
				actor?.username ?? "",
				`${actor?.username ?? "The owner"} removed ${target?.username ?? "a member"}`,
			);

			this.pushConversationRemoved(conversationId, targetId);
		} catch (err) {
			if (
				err instanceof NotFoundException ||
				err instanceof BadRequestException ||
				err instanceof ForbiddenException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to remove group member");
		}
	}

	/**
	 * Owner-only: rename a group. Posts a system message and pushes a
	 * `chat:conversation-updated` to the room so open clients patch the name in
	 * the list and thread title (Decision 1).
	 */
	async renameGroup(
		conversationId: number,
		actorId: number,
		name: string,
	): Promise<void> {
		try {
			const trimmed = name.trim();
			if (trimmed.length === 0 || trimmed.length > GROUP_NAME_MAX_LENGTH) {
				throw new BadRequestException(
					`Group name must be 1–${GROUP_NAME_MAX_LENGTH} characters`,
				);
			}

			const conversation = await this.loadOwnedGroup(conversationId, actorId);
			conversation.name = trimmed;

			const actor = await this.userRepo.findOne({ where: { id: actorId } });
			// postSystemMessage persists the conversation (including the new name).
			await this.postSystemMessage(
				conversation,
				actorId,
				actor?.username ?? "",
				`${actor?.username ?? "The owner"} renamed the group to ${trimmed}`,
			);

			this.server
				?.to(chatRoomName(conversationId))
				.emit(WS_EVENT_CHAT_CONVERSATION_UPDATED, {
					conversationId,
					name: trimmed,
				});
		} catch (err) {
			if (
				err instanceof NotFoundException ||
				err instanceof BadRequestException ||
				err instanceof ForbiddenException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to rename group");
		}
	}

	/**
	 * Owner-only: set the group photo to an already-uploaded file. Mirrors
	 * renameGroup — posts a system message and pushes a
	 * `chat:conversation-updated` carrying the new avatar so open clients patch
	 * the list without a refetch. The controller owns the multipart handling;
	 * this receives only the multer-written filename.
	 */
	async updateGroupAvatar(
		conversationId: number,
		actorId: number,
		filename: string,
	): Promise<{ avatarUrl: string }> {
		try {
			const conversation = await this.loadOwnedGroup(conversationId, actorId);
			const avatarUrl = `/api/uploads/avatars/${filename}`;
			conversation.avatar = avatarUrl;

			const actor = await this.userRepo.findOne({ where: { id: actorId } });
			// postSystemMessage persists the conversation (including the new avatar).
			await this.postSystemMessage(
				conversation,
				actorId,
				actor?.username ?? "",
				`${actor?.username ?? "The owner"} changed the group photo`,
			);

			this.server
				?.to(chatRoomName(conversationId))
				.emit(WS_EVENT_CHAT_CONVERSATION_UPDATED, {
					conversationId,
					avatar: avatarUrl,
				});

			return { avatarUrl };
		} catch (err) {
			if (
				err instanceof NotFoundException ||
				err instanceof BadRequestException ||
				err instanceof ForbiddenException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to update group photo");
		}
	}

	/**
	 * Owner-only: delete a group entirely — removes its messages and the
	 * conversation, detaches every member's sockets, and pushes each member a
	 * `chat:removed` (Decision 1). Mirrors the empty-group cleanup in
	 * leaveGroup (Bug Audit M10).
	 */
	async deleteGroup(conversationId: number, actorId: number): Promise<void> {
		try {
			await this.loadOwnedGroup(conversationId, actorId);

			const participants = await this.participantRepo.find({
				where: { conversationId },
			});
			const memberIds = participants.map((p) => p.userId);

			await this.messageRepo.delete({ conversationId });
			// Participant rows cascade on conversation delete (FK onDelete:
			// CASCADE), so deleting the conversation clears membership too.
			await this.conversationRepo.delete({ id: conversationId });

			for (const memberId of memberIds) {
				this.leaveLiveParticipant(conversationId, memberId);
				this.pushConversationRemoved(conversationId, memberId);
			}
		} catch (err) {
			if (
				err instanceof NotFoundException ||
				err instanceof ForbiddenException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to delete group");
		}
	}

	/**
	 * List a group's members (Decision 2). Participant-only. Each row carries
	 * presence + profile fields plus `joinedAt` and an `isOwner` flag so the UI
	 * can order by seniority and gate owner-only controls.
	 */
	async listGroupMembers(
		conversationId: number,
		userId: number,
	): Promise<GroupMemberView[]> {
		try {
			const conversation = await this.conversationRepo.findOne({
				where: { id: conversationId },
			});
			if (!conversation || conversation.type !== "group") {
				throw new NotFoundException("Group not found");
			}

			const callerMembership = await this.participantRepo.findOne({
				where: { conversationId, userId },
			});
			if (!callerMembership) {
				throw new ForbiddenException(
					"You are not a participant in this conversation",
				);
			}

			const participants = await this.participantRepo.find({
				where: { conversationId },
				relations: ["user"],
				order: { joinedAt: "ASC", id: "ASC" },
			});

			return participants.map((p) => ({
				userId: p.userId,
				username: p.user?.username ?? SENDER_FALLBACK_NAME,
				turtleName: p.user?.turtleName ?? null,
				shellSkin: p.user?.shellSkin ?? "base",
				avatar: p.user?.avatar ?? null,
				level: p.user?.level ?? 1,
				isOnline: this.presence.isOnline(p.userId),
				joinedAt: p.joinedAt.toISOString(),
				isOwner: conversation.ownerId === p.userId,
			}));
		} catch (err) {
			if (
				err instanceof NotFoundException ||
				err instanceof ForbiddenException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to list group members");
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

			// Join the new member's sockets to the room *before* posting the
			// system message so their client receives the `chat:message` (and,
			// via the frontend's unknown-conversation refetch, the conversation
			// appears in their list without a manual reopen — Bug B4).
			this.joinLiveParticipants(conversationId, [newMemberId]);

			const actor = await this.userRepo.findOne({ where: { id: actorId } });
			await this.postSystemMessage(
				conversation,
				actorId,
				actor?.username ?? "",
				`${actor?.username ?? "Someone"} added ${newMember.username}`,
			);
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
			// Persist the denormalised fields with a conditional UPDATE rather than
			// a full entity save (Bug B9): two concurrent sends both load the
			// conversation and, with save(), the last writer wins — which can leave
			// `lastMessageAt`/`lastMessagePreview` pointing at the OLDER of the two
			// messages. Guarding on `lastMessageAt <= :ts` makes an out-of-order
			// write a no-op. The in-memory `conversation` above is still used to
			// build the pushed unread view for THIS message, which is correct
			// regardless of who wins the persisted race.
			await this.conversationRepo
				.createQueryBuilder()
				.update(Conversation)
				.set({
					lastMessageAt: saved.createdAt,
					lastMessagePreview: conversation.lastMessagePreview,
				})
				.where("id = :id", { id: conversationId })
				.andWhere(
					'("lastMessageAt" IS NULL OR "lastMessageAt" <= :ts)',
					{ ts: saved.createdAt },
				)
				.execute();

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
	 * Paginated message history, newest first (pass the oldest message `id`
	 * seen so far as `options.beforeId` to load the previous page). Ordering
	 * and the cursor are both by `id` — a monotonic serial PK — so pages can't
	 * overlap or silently drop a message when two share a `createdAt`
	 * millisecond across a page boundary (Bug B6).
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
			if (options.beforeId !== undefined) {
				where.id = LessThan(options.beforeId);
			}

			const rows = await this.messageRepo.find({
				where,
				relations: ["sender"],
				order: { id: "DESC" },
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
	 * Tell every one of a user's sockets that they're no longer in a
	 * conversation (kicked, or the group was deleted) so their client drops it
	 * from the list and closes the thread if open (Decision 1). Emits per
	 * socket like pushReadSync rather than to the room — the user has already
	 * been removed from the room by the time this runs.
	 */
	private pushConversationRemoved(conversationId: number, userId: number): void {
		if (!this.server) return;
		for (const socketId of this.presence.getSocketIds(userId)) {
			this.server.to(socketId).emit(WS_EVENT_CHAT_REMOVED, { conversationId });
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
			title = other?.user?.username ?? SENDER_FALLBACK_NAME;
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
		let avatar: string | null = conversation.avatar ?? null;
		let shellSkin: string | null = null;
		let otherUserId: number | null = null;

		if (conversation.type === "dm") {
			const other = allParticipants.find(
				(row) =>
					row.conversationId === conversation.id && row.userId !== userId,
			);
			name = other?.user?.username ?? null;
			avatar = other?.user?.avatar ?? null;
			shellSkin = other?.user?.shellSkin ?? null;
			otherUserId = other?.userId ?? null;
		}

		return {
			id: conversation.id,
			type: conversation.type,
			name,
			otherUserId,
			avatar,
			shellSkin,
			ownerId: conversation.type === "group" ? conversation.ownerId : null,
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
			senderUsername: message.sender?.username ?? SENDER_FALLBACK_NAME,
			type: message.type,
			body: message.body,
			metadata: message.metadata,
			createdAt: message.createdAt.toISOString(),
		};
	}
}
