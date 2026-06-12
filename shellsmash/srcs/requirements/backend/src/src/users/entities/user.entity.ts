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

  @Column({ unique: true })
  fortyTwoId: string;

  @Column({ unique: true })
  username: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  avatar: string;

  @Column({ default: 1 })
  level: number;

  @Column({ default: 0 })
  xp: number;

  // The display name of the player's turtle (defaults to username)
  @Column({ nullable: true })
  turtleName: string;

  // Cosmetic shell skin — e.g. "kanagawa", "dragon", "bamboo"
  @Column({ default: 'kanagawa' })
  shellSkin: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => Profile, (profile) => profile.user, { cascade: true, eager: true })
  profile: Profile;
}
