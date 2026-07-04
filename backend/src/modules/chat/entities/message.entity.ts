import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";
import { Conversation } from "./conversation.entity";

/**
 * Message types:
 *   'text'        — a normal user-authored message (the only type Batch 1-3 emit).
 *   'system'      — server-authored notice (e.g. "X added Y to the group").
 *   'gif'         — a Klipy GIF, sent via ChatService.sendGifMessage. `body`
 *                   holds the gif's title (or "GIF" as a fallback) and
 *                   `metadata` holds the trusted GifMessageMetadata (see
 *                   chat.service.ts) re-fetched from Klipy at send time.
 *   'game_invite' — reserved for the future "Advanced chat" module (invite to
 *                   a match from chat). Not emitted by any code path yet.
 *
 * `metadata` is reserved the same way `Notification.payload` is: unused by
 * basic chat, gives Advanced chat features somewhere to attach structured
 * data (e.g. a match ID) without a schema migration later.
 */
export type MessageType = "text" | "system" | "gif" | "game_invite";

/** Hard cap on message length, enforced by ChatService before persisting. */
export const MESSAGE_BODY_MAX_LENGTH = 2000;

@Entity("messages")
@Index(["conversationId", "createdAt"]) // paginated history fetch, newest-first
export class Message {
	@PrimaryGeneratedColumn()
	id: number;

	@ManyToOne(() => Conversation, { onDelete: "CASCADE", nullable: false })
	conversation: Conversation;

	@Column()
	conversationId: number;

	@ManyToOne(() => User, { onDelete: "CASCADE", nullable: false })
	sender: User;

	@Column()
	senderId: number;

	@Column({ type: "varchar", length: 16, default: "text" })
	type: MessageType;

	@Column({ type: "text" })
	body: string;

	@Column({ type: "jsonb", nullable: true, default: null })
	metadata: Record<string, unknown> | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
