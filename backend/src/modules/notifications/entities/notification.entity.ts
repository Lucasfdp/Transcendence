import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

/**
 * Notification types:
 *   'friend_request'     — someone sent the recipient a friend request (persistent)
 *   'friend_accepted'    — someone accepted the recipient's friend request (persistent)
 *   'friend_removed'     — someone removed the recipient as a friend (delete verb)
 *   'tournament_invite'  — a friend invited the recipient to a Tournament lobby
 *                          (persistent; SPEC-038, seams-audit ruling #3)
 *
 * 'friend_removed' is intentionally NOT persisted here — see
 * NotificationsService.pushLiveEvent and FriendsService.removeFriend. A
 * permanent "so-and-so removed you as a friend" bell entry is an awkward,
 * arguably hostile UX choice for a social feature, so this event is
 * delivered live-only (like game_invite) purely to resync the removed
 * side's friends list in real time; it carries no lingering notification.
 *
 * Game-invite notifications are likewise ephemeral and handled live-only via
 * WebSocket — they are never persisted here. See docs/notifications.md for
 * the full event catalog.
 */
export type NotificationType =
	| "friend_request"
	| "friend_accepted"
	| "tournament_invite";

@Entity("notifications")
@Index(["toUserId", "readAt"]) // fast unread lookup per user
export class Notification {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: "varchar", length: 32 })
	type: NotificationType;

	@ManyToOne(() => User, { onDelete: "CASCADE", nullable: false })
	fromUser: User;

	@Column()
	fromUserId: number;

	@ManyToOne(() => User, { onDelete: "CASCADE", nullable: false })
	toUser: User;

	@Column()
	toUserId: number;

	/**
	 * Optional JSON metadata (e.g. username of the sender so the frontend
	 * doesn't need a second round-trip).
	 */
	@Column({ type: "jsonb", nullable: true, default: null })
	payload: Record<string, unknown> | null;

	/** Null = unread. Set to the timestamp when the user dismisses it. */
	@Column({ type: "timestamptz", nullable: true, default: null })
	readAt: Date | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
