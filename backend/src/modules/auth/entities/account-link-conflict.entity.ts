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
import type { AuthMethod } from "./auth-identity.entity";

export type AccountLinkConflictStatus = "pending" | "resolved";

@Entity("account_link_conflicts")
@Index(["initiatorUserId", "status"])
@Index(["linkedUserId", "status"])
export class AccountLinkConflict {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@ManyToOne(() => User, { onDelete: "RESTRICT", nullable: false })
	initiatorUser: User;

	@Column()
	initiatorUserId: number;

	@ManyToOne(() => User, { onDelete: "RESTRICT", nullable: false })
	linkedUser: User;

	@Column()
	linkedUserId: number;

	@Column({ type: "varchar", length: 16 })
	sourceMethod: AuthMethod;

	@Column({ type: "varchar", length: 16, default: "pending" })
	status: AccountLinkConflictStatus;

	@Column({ type: "varchar", length: 16, nullable: true, default: null })
	resolution: "initiator" | "linked" | null;

	@Column({ type: "int", nullable: true, default: null })
	finalUserId: number | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
