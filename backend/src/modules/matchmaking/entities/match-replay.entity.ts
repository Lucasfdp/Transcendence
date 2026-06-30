import {
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	OneToMany,
	OneToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";
import { Match } from "./match.entity";
import { MatchReplaySave } from "./match-replay-save.entity";

export interface MatchReplayFrame {
	seq: number;
	recordedAt: string;
	snapshot: Record<string, unknown>;
}

export interface MatchReplayEvent {
	type: string;
	seq: number;
	recordedAt: string;
	payload: Record<string, unknown>;
}

@Entity("match_replays")
export class MatchReplay {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@OneToOne(() => Match, (match) => match.replay, { onDelete: "CASCADE" })
	@JoinColumn({ name: "matchId" })
	match: Match;

	@Column({ unique: true })
	matchId: string;

	@Column()
	gameId: string;

	@Column()
	mode: string;

	@Column({ type: "jsonb", default: () => "'[]'" })
	frames: MatchReplayFrame[];

	@Column({ type: "jsonb", default: () => "'[]'" })
	events: MatchReplayEvent[];

	@Column({ default: 0 })
	frameCount: number;

	@Column({ type: "timestamptz", nullable: true })
	expiresAt: Date | null;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	@OneToMany(() => MatchReplaySave, (save) => save.replay)
	saves: MatchReplaySave[];
}
