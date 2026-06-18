import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

/**
 * Represents a directed relationship between two users.
 *
 * Direction semantics:
 *   requester → addressee  (who initiated the request)
 *
 * Status values:
 *   'pending'  — requester sent a request, addressee has not yet accepted
 *   'accepted' — both parties are friends
 *   'blocked'  — requester has blocked addressee (one-way, silent)
 *
 * The CHECK constraint prevents self-friending at the DB level.
 * The composite unique index prevents duplicate rows in either direction.
 */
@Entity('friendships')
@Index(['requesterId', 'addresseeId'], { unique: true })
@Check('"requesterId" <> "addresseeId"')
export class Friendship {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  requester: User;

  @Column()
  requesterId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  addressee: User;

  @Column()
  addresseeId: number;

  /** varchar instead of enum so migrations are simpler and portable. */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: FriendshipStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
