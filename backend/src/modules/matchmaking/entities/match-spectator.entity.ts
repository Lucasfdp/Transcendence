import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Match } from "./match.entity";
import { User } from "../../users/entities/user.entity";

@Entity("match_spectators")
export class MatchSpectator {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@ManyToOne(() => Match, (match) => match.spectators, {
		onDelete: "CASCADE",
	})
	match: Match;

	@Column()
	matchId: string;

	@ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
	user: User | null;

	@Column({ nullable: true })
	userId: number | null;

	@Column({ nullable: true })
	guestId: string | null;

	@Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
	joinedAt: Date;

	@Column({ type: "timestamptz", nullable: true })
	leftAt: Date | null;
}
