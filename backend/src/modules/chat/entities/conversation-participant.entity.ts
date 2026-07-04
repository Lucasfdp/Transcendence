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
 * Membership row: which users belong to which conversation.
 *
 * `lastReadAt` is the sole read cursor for unread state — no separate
 * notification row is persisted per chat message (see Batch 4). Null means
 * the participant has never opened the conversation.
 */
@Entity("conversation_participants")
@Index(["conversationId", "userId"], { unique: true })
export class ConversationParticipant {
	@PrimaryGeneratedColumn()
	id: number;

	@ManyToOne(() => Conversation, { onDelete: "CASCADE", nullable: false })
	conversation: Conversation;

	@Column()
	conversationId: number;

	@ManyToOne(() => User, { onDelete: "CASCADE", nullable: false })
	user: User;

	@Column()
	userId: number;

	@CreateDateColumn({ type: "timestamptz" })
	joinedAt: Date;

	@Column({ type: "timestamptz", nullable: true, default: null })
	lastReadAt: Date | null;
}
