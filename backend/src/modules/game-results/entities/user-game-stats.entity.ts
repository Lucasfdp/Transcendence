import {
	Column,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

@Entity("user_game_stats")
@Index(["user", "gameId"], { unique: true })
export class UserGameStats {
	@PrimaryGeneratedColumn()
	id: number;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	user: User;

	@Column()
	gameId: string;

	@Column({ default: 0 })
	gamesPlayed: number;

	@Column({ default: 0 })
	totalWins: number;

	@Column({ default: 0 })
	totalLosses: number;
}
