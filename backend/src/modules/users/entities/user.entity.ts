import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToOne,
} from 'typeorm';
import { Profile } from '../../profiles/entities/profile.entity';

// Represents a Shell Smash player — a sumo turtle warrior.
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  /** Null for guest accounts and local accounts (non-42 auth). */
  @Column({ unique: true, nullable: true })
  fortyTwoId: string | null;

  /** Null for guest, local, and 42 OAuth accounts. */
  @Column({ unique: true, nullable: true })
  githubId: string | null;

  /**
   * scrypt-derived hash: "<hex-salt>:<hex-hash>".
   * Null for guest accounts and 42 OAuth accounts (no local password).
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

  // The display name of the player's turtle (defaults to username)
  @Column({ nullable: true })
  turtleName: string;

  // Cosmetic shell skin — e.g. "kanagawa", "dragon", "bamboo"
  @Column({ default: 'kanagawa' })
  shellSkin: string;

  // Cosmetic Hub background preset — e.g. "default_dojo", "sunset_dojo"
  @Column({ default: 'default_dojo' })
  hubBackground: string;

  /** True for ephemeral guest accounts created via POST /auth/guest. */
  @Column({ default: false })
  isGuest: boolean;

  /**
   * True for accounts created via the dev-login endpoint.
   * Rendered with a gold "DEV" badge in the frontend HUD.
   */
  @Column({ default: false })
  isDevAccount: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => Profile, (profile) => profile.user, { cascade: true, eager: true })
  profile: Profile;
}
