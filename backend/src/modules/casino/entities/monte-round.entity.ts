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
import type { MonteRoundStatus, MonteSwap } from "../monte-round.constants";

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

	/**
	 * Slot (0..N-1) the ball starts under. Public — shown in the preview. New
	 * column: nullable so rows written before the server-authored shuffle load.
	 */
	@Column({ type: "int", nullable: true, default: null })
	ballStartSlot: number;

	/** Slot the ball ends under after the shuffle. NEVER sent before resolve. */
	@Column({ type: "int", nullable: true, default: null })
	winningSlot: number;

	/** The full server-authored swap sequence, revealed only at resolve. */
	@Column({ type: "jsonb", nullable: true, default: null })
	shuffle: MonteSwap[];

	/** Number of swaps in {@link shuffle}. */
	@Column({ type: "int", nullable: true, default: null })
	stepCount: number;

	/** Commitment binding seed, nonce, start slot and winning slot. */
	@Column({ type: "varchar", nullable: true, default: null })
	commitHash: string;

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
