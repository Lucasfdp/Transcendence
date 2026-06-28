import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";
import type { SpinMode } from "../casino.constants";
import { User } from "../../users/entities/user.entity";

/**
 * Audit log of a single Fortune Wheel spin.
 *
 * One immutable row is written per resolved spin. The table is the source of
 * truth for (a) anti-cheat / dispute resolution, (b) provably-fair verification
 * — server seed is committed by hash and revealed here after the spin, and
 * (c) the daily free-spin idempotency check (look for a `free` row dated today).
 *
 * Rows are never mutated after creation.
 */
@Entity("wagers")
@Index(["user", "createdAt"])
export class Wager {
	@PrimaryGeneratedColumn()
	id: number;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	user: User;

	/** "free" = daily faucet spin (player paid nothing); "wagered" = staked. */
	@Column({ type: "varchar" })
	mode: SpinMode;

	/**
	 * Coins put at risk. For a wagered spin this is what the player paid; for a
	 * free spin it is the house-gifted FREE_SPIN_STAKE_COINS the payout scales
	 * from (the player paid 0 — see `paid`).
	 */
	@Column({ type: "int" })
	stake: number;

	/** Coins actually debited from the player (0 for a free spin). */
	@Column({ type: "int" })
	paid: number;

	/** Winning wheel segment id (e.g. "x2", "jackpot"). */
	@Column({ type: "varchar" })
	segmentId: string;

	/** Payout multiplier of the winning segment (0, 0.5, 1, … 10). */
	@Column({ type: "real" })
	multiplier: number;

	/** Coins credited to the player = floor(stake × multiplier). */
	@Column({ type: "int" })
	payout: number;

	/** Net coin change for the player = payout − paid. */
	@Column({ type: "int" })
	net: number;

	/** SHA-256 hash of the server seed, committed before the spin resolved. */
	@Column({ type: "varchar" })
	serverSeedHash: string;

	/** The server seed itself, revealed after the spin for verification. */
	@Column({ type: "varchar" })
	serverSeed: string;

	/** Client-supplied seed mixed into the roll (empty string if none given). */
	@Column({ type: "varchar", default: "" })
	clientSeed: string;

	/** Per-(user, serverSeed) monotonic counter, part of the provable roll. */
	@Column({ type: "int" })
	nonce: number;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
