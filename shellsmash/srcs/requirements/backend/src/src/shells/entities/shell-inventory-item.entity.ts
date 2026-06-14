import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Index, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Represents one row of a player's shell inventory.
 * Each (user, shellType) pair is unique — quantity is updated in place.
 */
@Entity('shell_inventory')
@Index(['user', 'shellType'], { unique: true })
export class ShellInventoryItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /**
   * Mirrors PowerType enum string values (e.g. 'heavy', 'bomb').
   * Validated against VALID_SHELL_TYPES before any write.
   * 'none' is never stored — it is always available for free.
   */
  @Column({ name: 'shell_type', length: 32 })
  shellType: string;

  /** How many of this shell the player owns. Starts at 999 for all new users. */
  @Column({ default: 999 })
  quantity: number;
}
