import {
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import type { Server } from "socket.io";
import { PresenceService } from "../presence/presence.service";
import { Notification, NotificationType } from "./entities/notification.entity";

export interface NotificationView {
	id: number;
	type: NotificationType;
	fromUserId: number;
	fromUsername: string;
	payload: Record<string, unknown> | null;
	createdAt: Date;
}

const WS_EVENT_NEW = "notification:new" as const;
const WS_EVENT_INBOX = "notification:inbox" as const;

/**
 * Cap on how many unread rows listUnread()/the inbox ever return (Bug Audit
 * L3). There is currently no retention sweep for read rows and unread
 * friend_accepted notifications simply accumulate until dismissed, so
 * without a cap a long-unopened bell could re-fetch and re-push an
 * unbounded list on every connect/mount. 50 is generous for a real inbox
 * while bounding the worst case.
 */
const MAX_UNREAD_NOTIFICATIONS = 50;

@Injectable()
export class NotificationsService {
	/** Set by the WS gateway in afterInit() — avoids circular DI. */
	private server: Server | null = null;

	constructor(
		@InjectRepository(Notification)
		private readonly notificationRepo: Repository<Notification>,
		private readonly presence: PresenceService,
	) {}

	/** Called once by MatchmakingGateway.afterInit() to wire up real-time push. */
	setServer(server: Server): void {
		this.server = server;
	}

	/**
	 * Persist a new notification and immediately push it to any live sockets
	 * the recipient currently has open.
	 */
	async create(
		type: NotificationType,
		fromUserId: number,
		toUserId: number,
		payload: Record<string, unknown> = {},
	): Promise<void> {
		try {
			// Dedup: skip creating a second unread notification for the same
			// (type, fromUserId, toUserId) triple. Prevents duplicates such as two
			// "friend_request" rows from acting independently — one accepted, the
			// other declined — which nets to added-then-removed friendship state.
			const duplicate = await this.notificationRepo.findOne({
				where: { type, fromUserId, toUserId, readAt: IsNull() },
			});
			if (duplicate) return;

			let notification: Notification;
			try {
				notification = await this.notificationRepo.save(
					this.notificationRepo.create({
						type,
						fromUserId,
						toUserId,
						payload,
						readAt: null,
					}),
				);
			} catch (saveErr: unknown) {
				// A concurrent create() for the same triple won the race and
				// inserted the unread row between our check and this save; the
				// partial unique index (uq_notification_unread_triple, Bug Audit
				// L7) rejects the loser with 23505. That is exactly the dedup we
				// wanted, so treat it as a successful no-op.
				const pg = saveErr as { code?: string };
				if (pg?.code === "23505") return;
				throw saveErr;
			}

			// Push real-time to every open tab of the recipient
			if (this.server) {
				// save() only returns the columns/relations that were part of the
				// input — fromUser is never populated on a fresh insert — so reload
				// with the relation to get a real fromUsername in the pushed view.
				// Non-fatal: fall back to the un-related notification (blank
				// fromUsername) rather than dropping the push entirely.
				const withRelation = await this.notificationRepo
					.findOne({
						where: { id: notification.id },
						relations: ["fromUser"],
					})
					.catch(() => null);
				const view = this.toView(withRelation ?? notification);
				for (const socketId of this.presence.getSocketIds(toUserId)) {
					this.server.to(socketId).emit(WS_EVENT_NEW, view);
				}
			}
		} catch (err) {
			if (err instanceof InternalServerErrorException) throw err;
			throw new InternalServerErrorException(
				"Failed to create notification",
			);
		}
	}

	/**
	 * Return all unread notifications for a user, newest first.
	 * Used on WS connect to hydrate the client inbox.
	 */
	async listUnread(userId: number): Promise<NotificationView[]> {
		try {
			const rows = await this.notificationRepo.find({
				where: { toUserId: userId, readAt: IsNull() },
				relations: ["fromUser"],
				order: { createdAt: "DESC" },
				take: MAX_UNREAD_NOTIFICATIONS,
			});
			return rows.map((n) => this.toView(n));
		} catch {
			throw new InternalServerErrorException(
				"Failed to fetch notifications",
			);
		}
	}

	/**
	 * Mark a single notification as read.
	 * Verifies the notification belongs to the requesting user.
	 *
	 * Uses a single atomic UPDATE (Bug Audit L5) instead of a findOne+save
	 * round trip — cheaper, and immune to the benign lost-update race where
	 * two concurrent calls both load the same row before either saves.
	 */
	async markRead(userId: number, notificationId: number): Promise<void> {
		let affected: number | null | undefined;
		try {
			const result = await this.notificationRepo
				.createQueryBuilder()
				.update(Notification)
				.set({ readAt: new Date() })
				.where(
					'id = :notificationId AND "toUserId" = :userId AND "readAt" IS NULL',
					{ notificationId, userId },
				)
				.execute();
			affected = result.affected;
		} catch {
			throw new InternalServerErrorException(
				"Failed to mark notification as read",
			);
		}
		if (!affected) throw new NotFoundException("Notification not found");

		// Sync every other open tab/device for this user (Bug Audit M1) —
		// without this, dismissing a notification in one tab left every other
		// tab's bell stale until its socket happened to reconnect.
		await this.pushInboxToUser(userId);
	}

	/** Mark all unread notifications for a user as read. */
	async markAllRead(userId: number): Promise<void> {
		try {
			await this.notificationRepo
				.createQueryBuilder()
				.update(Notification)
				.set({ readAt: new Date() })
				.where("toUserId = :userId AND readAt IS NULL", { userId })
				.execute();
		} catch {
			throw new InternalServerErrorException(
				"Failed to mark all notifications as read",
			);
		}

		// Bug Audit M1 — same cross-tab sync as markRead above.
		await this.pushInboxToUser(userId);
	}

	/**
	 * Push the full unread inbox to a single socket.
	 * Called by the gateway on connect so late-joining clients receive
	 * any notifications they missed while offline.
	 */
	async pushInboxToSocket(socketId: string, userId: number): Promise<void> {
		if (!this.server) return;
		try {
			const unread = await this.listUnread(userId);
			this.server.to(socketId).emit(WS_EVENT_INBOX, unread);
		} catch {
			// Non-fatal: client will not get inbox but connection should proceed
		}
	}

	/**
	 * Delete every notification matching (type, fromUserId, toUserId) and, if
	 * any were removed, push the recipient a fresh inbox so their bell updates
	 * immediately. Used by FriendsService when a friend request is
	 * declined/cancelled/blocked, so a stale friend_request notification can't
	 * dead-end on an Accept that finds no pending row (Bug Audit M9).
	 *
	 * Non-fatal by contract: callers invoke this as a best-effort side effect
	 * and swallow rejections, so failure here never fails the parent action.
	 */
	async removeWhere(
		type: NotificationType,
		fromUserId: number,
		toUserId: number,
	): Promise<void> {
		const result = await this.notificationRepo.delete({
			type,
			fromUserId,
			toUserId,
		});
		if (result.affected && result.affected > 0) {
			await this.pushInboxToUser(toUserId);
		}
	}

	/** Push the current unread inbox to every one of a user's open sockets. */
	private async pushInboxToUser(userId: number): Promise<void> {
		if (!this.server) return;
		const unread = await this.listUnread(userId).catch(() => null);
		if (!unread) return;
		for (const socketId of this.presence.getSocketIds(userId)) {
			this.server.to(socketId).emit(WS_EVENT_INBOX, unread);
		}
	}

	/**
	 * Push an ephemeral, non-persisted event to every open socket of a user.
	 * For events that are useful in the moment but shouldn't leave a
	 * permanent bell entry — e.g. `friend:removed`, where the removed side
	 * just needs an instant friends-list resync, not a standing "so-and-so
	 * removed you" notification (see NotificationType's friend_removed doc).
	 * Silently a no-op if the WS server isn't wired up or the user is offline.
	 */
	pushLiveEvent(
		eventName: string,
		toUserId: number,
		payload: Record<string, unknown> = {},
	): void {
		if (!this.server) return;
		for (const socketId of this.presence.getSocketIds(toUserId)) {
			this.server.to(socketId).emit(eventName, payload);
		}
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	private toView(notification: Notification): NotificationView {
		// save()/reload can carry the sender's username in payload (the
		// snapshot taken at creation time) even when the fromUser relation
		// isn't loaded — fall back to it instead of a blank name (Bug Audit L1).
		const payloadUsername =
			typeof notification.payload?.username === "string"
				? notification.payload.username
				: undefined;
		return {
			id: notification.id,
			type: notification.type,
			fromUserId: notification.fromUserId,
			fromUsername: notification.fromUser?.username ?? payloadUsername ?? "",
			payload: notification.payload,
			createdAt: notification.createdAt,
		};
	}
}
