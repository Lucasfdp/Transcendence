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

export const REPLAY_CONTRACT_VERSION = 1;

export type ReplayContractVersion = typeof REPLAY_CONTRACT_VERSION;

export interface MatchReplayVisualPlayer {
	side: number;
	userId: number | null;
	username: string;
	turtleName?: string | null;
	shellSkin?: string;
	trailEffect?: string;
	hubBackground?: string;
	hubBackgroundAlter?: string | null;
}

export interface MatchReplaySnapshotEntity {
	id: number | string;
	type: "projectile" | "stone" | string;
	side?: number;
	ownerSide?: number;
	x: number;
	y: number;
	vx?: number;
	vy?: number;
	rotation?: number;
	angularVelocity?: number;
	r?: number;
	power?: string;
	scale?: number;
	stateFlags?: string[];
	visible?: boolean;
	alpha?: number;
	spriteKey?: string;
	trail?: Array<{ x: number; y: number }>;
}

export interface MatchReplaySnapshot {
	gameId?: string;
	seq?: number;
	phase?: string;
	players?: MatchReplayVisualPlayer[];
	score?: number[];
	scores?: number[];
	currentTurn?: number;
	activeStoneId?: number | string | null;
	activeBallIdBySide?: Array<number | string | null>;
	entities?: MatchReplaySnapshotEntity[];
	balls?: MatchReplaySnapshotEntity[];
	objects?: MatchReplaySnapshotEntity[];
	powerups?: Array<Record<string, unknown>>;
	powerPickups?: Array<Record<string, unknown>>;
	winnerSide?: number | null;
	[key: string]: unknown;
}

export interface MatchReplayFrame {
	replayVersion?: ReplayContractVersion;
	seq: number;
	recordedAt: string;
	recordedAtMs?: number;
	tickTs?: number;
	deltaMs?: number;
	snapshot: MatchReplaySnapshot;
}

export interface MatchReplayEvent {
	replayVersion?: ReplayContractVersion;
	type: string;
	seq: number;
	recordedAt: string;
	recordedAtMs?: number;
	tickTs?: number;
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
