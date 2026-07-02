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

			const notification = await this.notificationRepo.save(
				this.notificationRepo.create({
					type,
					fromUserId,
					toUserId,
					payload,
					readAt: null,
				}),
			);

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
	 */
	async markRead(userId: number, notificationId: number): Promise<void> {
		try {
			const notification = await this.notificationRepo.findOne({
				where: { id: notificationId, toUserId: userId },
			});
			if (!notification) throw new NotFoundException("Notification not found");

			notification.readAt = new Date();
			await this.notificationRepo.save(notification);
		} catch (err) {
			if (err instanceof NotFoundException) throw err;
			throw new InternalServerErrorException(
				"Failed to mark notification as read",
			);
		}
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

	// ── Private helpers ───────────────────────────────────────────────────────

	private toView(notification: Notification): NotificationView {
		return {
			id: notification.id,
			type: notification.type,
			fromUserId: notification.fromUserId,
			fromUsername: notification.fromUser?.username ?? "",
			payload: notification.payload,
			createdAt: notification.createdAt,
		};
	}
}
