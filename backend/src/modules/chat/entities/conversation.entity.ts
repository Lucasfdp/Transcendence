import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

export type ConversationType = "dm" | "group";

/**
 * A chat conversation — either a 1:1 direct message or a named group.
 *
 * `lastMessageAt` / `lastMessagePreview` are denormalised from the most
 * recent `Message` row so the conversation list can sort/preview without a
 * join, and so unread state can later be derived cheaply as
 * `lastMessageAt > participant.lastReadAt` (see ChatService / Batch 4 —
 * derived notifications, no separate notification row is persisted per
 * message).
 */
@Entity("conversations")
export class Conversation {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: "varchar", length: 8 })
	type: ConversationType;

	/** Group display name. Always null for "dm" conversations. */
	@Column({ nullable: true, default: null })
	name: string | null;

	/** Group creator. Always null for "dm" conversations. */
	@ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
	owner: User | null;

	@Column({ nullable: true, default: null })
	ownerId: number | null;

	/**
	 * Canonical `min(userId):max(userId)` pair key — set only for "dm"
	 * conversations, always null for "group". A unique index on this column
	 * (see migration `20260704010000-add-conversations-dmkey`) is the DB-level
	 * guarantee that two concurrent `getOrCreateDirectConversation` calls for
	 * the same pair can never both succeed in creating a conversation
	 * (Bug Audit M3).
	 */
	@Index("UQ_conversations_dmKey", { unique: true })
	@Column({ type: "varchar", length: 64, nullable: true, default: null })
	dmKey: string | null;

	@Column({ type: "timestamptz", nullable: true, default: null })
	lastMessageAt: Date | null;

	@Column({ type: "text", nullable: true, default: null })
	lastMessagePreview: string | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
