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

export const REPLAY_CONTRACT_VERSION = 2;

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
	type: "projectile" | "ball" | string;
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
	activeBallId?: number | string | null;
	activeBallIdBySide?: Array<number | string | null>;
	entities?: MatchReplaySnapshotEntity[];
	balls?: MatchReplaySnapshotEntity[];
	objects?: MatchReplaySnapshotEntity[];
	powerups?: Array<Record<string, unknown>>;
	powerPickups?: Array<Record<string, unknown>>;
	winnerSide?: number | null;
	[key: string]: unknown;
}

export interface ReplayMetadataV2 {
	contractVersion: ReplayContractVersion;
	origin: "local" | "online";
	gameId: string;
	mode: string;
	participants: MatchReplayVisualPlayer[];
	durationMs: number;
	sampleHz: 20;
	keyframeIntervalMs: 1000;
	preRollMs: number;
	statistics: Record<string, unknown>;
	powerupsEnabled: false;
}

export interface ReplayEntityV2 {
	id: string;
	generation: number;
	ownerSide: number | null;
	x: number;
	y: number;
	vx: number;
	vy: number;
	rotation: number;
	visualState: Record<string, unknown>;
	motionSegmentId: number;
	interpolation: "linear" | "step";
}

export interface MatchReplayFrame {
	seq: number;
	tMs: number;
	round: number;
	state: "pending" | "active" | "finished" | "abandoned";
	type: "keyframe" | "delta";
	changes: Record<string, unknown>;
	removals: string[];
}

export interface MatchReplayEvent {
	seq: number;
	tMs: number;
	round: number;
	type: string;
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

	@Column({ type: "smallint", default: REPLAY_CONTRACT_VERSION })
	contractVersion: ReplayContractVersion;

	@Column({ type: "jsonb" })
	metadata: ReplayMetadataV2;

	@Column({ type: "integer", default: 0 })
	durationMs: number;

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
