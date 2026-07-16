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

export type AuthMethod = "shellsmash" | "google" | "forty_two";

@Entity("auth_identities")
@Index("uq_auth_identity_user_method", ["userId", "method"], {
	unique: true,
})
@Index("uq_auth_identity_provider_subject", ["method", "providerSubject"], {
	unique: true,
})
@Index("uq_auth_identity_shell_username", ["shellUsername"], { unique: true })
@Index("uq_auth_identity_shell_email", ["shellEmail"], { unique: true })
export class AuthIdentity {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@ManyToOne(() => User, { onDelete: "CASCADE", nullable: false })
	user: User;

	@Column()
	userId: number;

	@Column({ type: "varchar", length: 16 })
	method: AuthMethod;

	/** Stable provider-side ID. Null only for ShellSmash credentials. */
	@Column({ type: "varchar", nullable: true, default: null })
	providerSubject: string | null;

	@Column({ type: "varchar", length: 20, nullable: true, default: null })
	shellUsername: string | null;

	@Column({ type: "varchar", length: 254, nullable: true, default: null })
	shellEmail: string | null;

	/** scrypt hash. It is opt-in on reads and must never leave the backend. */
	@Column({ type: "text", nullable: true, select: false, default: null })
	passwordHash: string | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
