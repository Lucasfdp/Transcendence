import {
  Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('user_cosmetics')
@Index(['user', 'cosmeticId'], { unique: true })
export class UserCosmetic {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  cosmeticId: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  unlockedAt: Date;
}
