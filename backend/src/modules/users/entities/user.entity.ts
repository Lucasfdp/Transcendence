import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	OneToOne,
} from "typeorm";
import { Profile } from "../../profiles/entities/profile.entity";

// Represents a Shell Smash player — a sumo turtle warrior.
@Entity("users")
export class User {
	@PrimaryGeneratedColumn()
	id: number;

	/** Null for guest accounts and local accounts (non-42 auth). */
	@Column({ unique: true, nullable: true })
	fortyTwoId: string | null;

	/** Null for guest, local, and 42 OAuth accounts. */
	@Column({ unique: true, nullable: true })
	googleId: string | null;

	/**
	 * scrypt-derived hash: "<hex-salt>:<hex-hash>".
	 * Null for guest accounts and OAuth accounts (no local password).
	 * NEVER expose this field in API responses.
	 */
	@Column({ nullable: true, select: false })
	passwordHash: string | null;

	@Column({ unique: true })
	username: string;

	/** Null for guest accounts (no email required). */
	@Column({ unique: true, nullable: true })
	email: string | null;

	@Column({ nullable: true })
	avatar: string;

	@Column({ default: 1 })
	level: number;

	@Column({ default: 0 })
	xp: number;

	@Column({ default: 0 })
	coins: number;

	/**
	 * Lifetime count of casino wagers this user has placed — used as the
	 * provably-fair nonce for the next spin (see `CasinoEngine.apply`).
	 * Incremented under the same pessimistic-write lock the spin's coin delta
	 * is applied under, so it's O(1) per spin instead of a
	 * `COUNT(*) FROM wagers WHERE user = ...` table scan that grows with the
	 * user's entire wager history (Bug Audit 3.3). Correctness of past rolls
	 * doesn't depend on this column — it only needs to keep increasing, which
	 * a lifetime counter does just as well as a recount would.
	 */
	@Column({ default: 0 })
	wagerCount: number;

	// The display name of the player's turtle (defaults to username)
	@Column({ nullable: true })
	turtleName: string;

	// Cosmetic shell skin — e.g. "base", "dragon", "bamboo"
	@Column({ default: "base" })
	shellSkin: string;

	// Cosmetic Hub background preset — e.g. "night_bg", "sunset_bg"
	@Column({ default: "night_bg" })
	hubBackground: string;

	// Optional alter art applied on top of the equipped hub background.
	@Column({ nullable: true, default: null })
	hubBackgroundAlter: string | null;

	// Cosmetic launch trail effect — e.g. "trail_classic", "trail_comet".
	@Column({ default: "trail_classic" })
	trailEffect: string;

	/** True for ephemeral guest accounts created via POST /auth/guest. */
	@Column({ default: false })
	isGuest: boolean;

	/**
	 * Legacy flag from the removed dev-login flow; retained for the gold "DEV"
	 * badge in the frontend HUD and to avoid a schema migration. No current code
	 * path sets it to true. Safe to drop in a future migration.
	 */
	@Column({ default: false })
	isDevAccount: boolean;

	/**
	 * When the user was last seen online (their last socket disconnect).
	 * Null until they have connected and disconnected at least once.
	 * Used to render "last online" for offline friends.
	 */
	@Column({ type: "timestamptz", nullable: true, default: null })
	lastSeenAt: Date | null;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	@OneToOne(() => Profile, (profile) => profile.user, {
		cascade: true,
		eager: true,
	})
	profile: Profile;
}
