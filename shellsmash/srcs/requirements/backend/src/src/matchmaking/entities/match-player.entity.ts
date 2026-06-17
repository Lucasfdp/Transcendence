import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Match } from './match.entity';
import { User } from '../../users/entities/user.entity';

export type MatchOutcome = 'win' | 'loss' | 'draw' | 'abandoned';

@Entity('match_players')
export class MatchPlayer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Match, (match) => match.players, { onDelete: 'CASCADE' })
  match: Match;

  @Column()
  matchId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  user: User | null;

  @Column({ nullable: true })
  userId: number | null;

  @Column()
  side: number;

  @Column({ nullable: true })
  outcome: MatchOutcome | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  shellSelection: string[];

  @Column({ type: 'timestamptz', nullable: true })
  disconnectedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reconnectedAt: Date | null;
}
