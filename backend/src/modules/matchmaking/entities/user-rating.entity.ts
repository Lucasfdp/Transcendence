import {
	Column,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

/**
 * Rankings Bug Audit H1: without this constraint, `applyEloRatings`'s
 * unlocked find-or-create (see `game-session.service.ts`) can race and
 * insert two rating rows for the same player+game, which the leaderboard
 * then renders as a duplicate entry (and a duplicate React key). Backed by
 * `uq_user_ratings_user_game` in migration 20260715000000.
 */
@Unique(["userId", "gameId"])
@Entity("user_ratings")
export class UserRating {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	user: User;

	@Column()
	userId: number;

	@Column()
	gameId: string;

	@Column({ default: 1000 })
	rating: number;

	@Column({ default: 0 })
	wins: number;

	@Column({ default: 0 })
	losses: number;

	@Column({ default: 0 })
	draws: number;

	@UpdateDateColumn()
	updatedAt: Date;
}
