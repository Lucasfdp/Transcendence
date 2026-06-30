import {
	CreateDateColumn,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";
import { MatchReplay } from "./match-replay.entity";

@Entity("match_replay_saves")
@Index(["replay", "user"], { unique: true })
export class MatchReplaySave {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@ManyToOne(() => MatchReplay, (replay) => replay.saves, {
		onDelete: "CASCADE",
	})
	replay: MatchReplay;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	user: User;

	@CreateDateColumn()
	createdAt: Date;
}
