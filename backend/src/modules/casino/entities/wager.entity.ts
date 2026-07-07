import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";
import type { CasinoGame, SpinMode } from "../casino.constants";
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

	/**
	 * Which game produced the spin ("wheel", "flip", "monte", "slots"). Defaults
	 * to "wheel" so rows written before this discriminator existed stay valid.
	 */
	@Column({ type: "varchar", default: "wheel" })
	game: CasinoGame;

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

	/**
	 * Stable id of the resolved outcome. Wheel: segment id (e.g. "x2",
	 * "jackpot"). Flip: "heads"/"tails". Monte: "shell-<n>". Slots:
	 * "<s0>|<s1>|<s2>". The column name is historical (the wheel came first).
	 */
	@Column({ type: "varchar" })
	segmentId: string;

	/**
	 * Payout multiplier of the winning segment (0, 0.5, 1, … 10).
	 *
	 * `double precision`, not `real` (float4): some games' multipliers aren't
	 * exact in binary at single precision — e.g. Koi Dice's 100/99 ≈ 1.0101 —
	 * so a `real` column silently rounds the audited value. `payout`/`net` are
	 * already-computed integers, so money itself was never affected; this only
	 * degraded the audit trail (Bug Audit 3.4).
	 */
	@Column({ type: "double precision" })
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

	/**
	 * Per-user lifetime monotonic counter, part of the provable roll (mixed
	 * into the HMAC alongside the server/client seeds — see `casino.fair.ts`).
	 * Historically documented as "per-(user, serverSeed)", which was wrong: a
	 * fresh server seed is generated per spin, but the nonce keeps counting up
	 * across a user's entire wager history, not resetting per seed. Sourced
	 * from `User.wagerCount` (see that column's doc for why).
	 */
	@Column({ type: "int" })
	nonce: number;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
