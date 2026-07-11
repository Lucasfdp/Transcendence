import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";
import type { MonteRoundStatus } from "../monte-round.constants";

/** Persisted commitment for a two-step Three-Shell Monte round. */
@Entity("casino_monte_rounds")
@Index(["user", "status"])
export class MonteRound {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ type: "int" })
	userId: number;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "userId" })
	user: User;

	@Column({ type: "int" })
	stake: number;

	@Column({ type: "jsonb" })
	cupIds: string[];

	@Column({ type: "varchar" })
	ballCupId: string;

	@Column({ type: "varchar" })
	serverSeedHash: string;

	@Column({ type: "varchar" })
	serverSeed: string;

	@Column({ type: "varchar", default: "" })
	clientSeed: string;

	@Column({ type: "int" })
	nonce: number;

	@Column({ type: "varchar" })
	winningCupHash: string;

	@Column({ type: "varchar", default: "pending" })
	status: MonteRoundStatus;

	@Column({ type: "varchar", nullable: true, default: null })
	selectedCupId: string | null;

	@Column({ type: "int", nullable: true, default: null })
	payout: number | null;

	@Column({ type: "int", nullable: true, default: null })
	net: number | null;

	@Column({ type: "timestamptz" })
	expiresAt: Date;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
