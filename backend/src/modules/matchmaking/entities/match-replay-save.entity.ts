import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
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

	@Column({ nullable: true })
	replayId: string | null;

	@ManyToOne(() => MatchReplay, (replay) => replay.saves, {
		onDelete: "CASCADE",
	})
	@JoinColumn({ name: "replayId" })
	replay: MatchReplay;

	@Column({ nullable: true })
	userId: number | null;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "userId" })
	user: User;

	@CreateDateColumn()
	createdAt: Date;
}
