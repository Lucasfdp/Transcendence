import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	OneToOne,
	JoinColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

// Dojo record — tracks a player's overall combat statistics across
// all Shell Smash games. Already game-agnostic: totalWins/totalLosses
// aggregate across every minigame, not just one.
@Entity("profiles")
export class Profile {
	@PrimaryGeneratedColumn()
	id: number;

	@OneToOne(() => User, (user) => user.profile)
	@JoinColumn()
	user: User;

	@Column({ default: 0 })
	totalWins: number;

	@Column({ default: 0 })
	totalLosses: number;

	@Column({ default: 0 })
	gamesPlayed: number;

	@Column({ default: 0 })
	totalCoinsEarned: number;

	@Column({ nullable: true })
	bio: string;
}
