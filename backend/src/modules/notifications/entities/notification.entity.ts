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
 *   'friend_request'  — someone sent the recipient a friend request (persistent)
 *   'friend_accepted' — someone accepted the recipient's friend request (persistent)
 *
 * Game-invite notifications are ephemeral and handled live-only via WebSocket
 * — they are never persisted here.
 */
export type NotificationType = "friend_request" | "friend_accepted";

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
