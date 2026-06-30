import {
	Column,
	CreateDateColumn,
	Entity,
	OneToMany,
	OneToOne,
	PrimaryGeneratedColumn,
} from "typeorm";
import { MatchPlayer } from "./match-player.entity";
import { MatchReplay } from "./match-replay.entity";
import { MatchSpectator } from "./match-spectator.entity";

export type MatchMode = "casual" | "ranked";
export type MatchStatus =
	| "pending"
	| "active"
	| "finished"
	| "cancelled"
	| "abandoned";

@Entity("matches")
export class Match {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	gameId: string;

	@Column()
	mode: MatchMode;

	@Column({ default: "pending" })
	status: MatchStatus;

	@Column({ nullable: true })
	winnerUserId: number | null;

	@Column({ nullable: true })
	winnerSide: number | null;

	@CreateDateColumn()
	createdAt: Date;

	@Column({ type: "timestamptz", nullable: true })
	startedAt: Date | null;

	@Column({ type: "timestamptz", nullable: true })
	finishedAt: Date | null;

	@OneToMany(() => MatchPlayer, (player) => player.match)
	players: MatchPlayer[];

	@OneToMany(() => MatchSpectator, (spectator) => spectator.match)
	spectators: MatchSpectator[];

	@OneToOne(() => MatchReplay, (replay) => replay.match)
	replay: MatchReplay | null;
}
