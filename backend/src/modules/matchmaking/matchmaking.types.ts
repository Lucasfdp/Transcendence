import { MatchMode } from "./entities/match.entity";
import { GameMap } from "./game-map";

export interface SocketUser {
	id: number;
	username: string;
	isGuest: boolean;
}

export interface QueueJoinPayload {
	gameId: string;
	mode: MatchMode;
	playerCount?: number;
	shellSelection?: string[];
}

export interface GameInputPayload {
	matchId: string;
	action:
		| "aim"
		| "power"
		| "release"
		| "settled"
		| "round:score"
		| "bamboo:hit"
		| "bamboo:sync"
		| "target:hit"
		| "bell:hit";
	payload?: Record<string, unknown>;
}

export interface CurlingThrowEvent {
	matchId: string;
	id: number;
	side: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	power: string;
}

export interface BambooBashThrowEvent {
	matchId: string;
	roundNumber: number;
	side: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	power: string;
}

export interface KameKnockThrowEvent {
	matchId: string;
	roundNumber: number;
	turnNumber: number;
	side: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	power: string;
}

export interface BellClashThrowEvent {
	matchId: string;
	roundNumber: number;
	shotNumber: number;
	side: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	power: string;
}

export interface SpectatorJoinPayload {
	matchId: string;
}

export interface CurlingSnapshot {
	matchId: string;
	seq: number;
	gameId: string;
	mode: MatchMode;
	powerupsEnabled: boolean;
	phase: "pending" | "active" | "finished" | "abandoned";
	currentTurn: number;
	turnNumber: number;
	maxTurns: number;
	currentEnd: number;
	throwsInEnd: number;
	stonesPerPlayer: number;
	totalEnds: number;
	score: number[];
	endScores: Array<Array<number | null>>;
	map: GameMap;
	players: SnapshotPlayer[];
	objects: Array<{
		id: number;
		side: number;
		type: "stone";
		ownerSide: number;
		x: number;
		y: number;
		vx?: number;
		vy?: number;
		rotation: number;
		angularVelocity: number;
		moving?: boolean;
		scale: number;
		visible: boolean;
		alpha: number;
		spriteKey: string;
		stateFlags: string[];
		createdAt: number;
		updatedAt: number;
		stopped: boolean;
		power: string;
		trail?: Array<{ x: number; y: number }>;
	}>;
	activeStoneId: number | null;
	winnerSide: number | null;
}

export interface BallSnapshotData {
	id: number;
	type: "projectile";
	side: number;
	ownerSide: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	rotation: number;
	angularVelocity: number;
	scale: number;
	visible: boolean;
	alpha: number;
	spriteKey: string;
	stateFlags: string[];
	createdAt: number;
	updatedAt: number;
	stopped: boolean;
}

export interface ReplayFrameSnapshotEntity {
	id: number;
	type: "projectile" | "stone";
	ownerSide: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	rotation: number;
	angularVelocity: number;
	scale: number;
	visible: boolean;
	alpha: number;
	spriteKey: string;
	stateFlags: string[];
	createdAt: number;
	updatedAt: number;
	stopped: boolean;
}

export interface SnapshotPlayer {
	side: number;
	userId: number | null;
	username: string;
	connected: boolean;
	ready: boolean;
	reconnectExpiresAt: number | null;
}

export interface BambooBashSnapshot {
	matchId: string;
	seq: number;
	gameId: "bamboo-bash";
	mode: MatchMode;
	powerupsEnabled: boolean;
	phase: "pending" | "active" | "finished" | "abandoned";
	roundNumber: number;
	totalRounds: number;
	roundTimeMs: number;
	roundStartedAt: number | null;
	roundEndsAt: number | null;
	score: number[];
	liveRoundScores: number[];
	roundScores: Array<number | null>;
	bamboos: Array<{
		id: number;
		nx: number;
		ny: number;
		stage: number;
		ageMs: number;
	}>;
	nextBambooId: number;
	spawnAccMs: number;
	lastBambooUpdateAt: number | null;
	players: SnapshotPlayer[];
	balls: BallSnapshotData[];
	activeBallIdBySide: Array<number | null>;
	nextBallId: number;
	entities: ReplayFrameSnapshotEntity[];
	winnerSide: number | null;
}

export interface KameKnockSnapshot {
	matchId: string;
	seq: number;
	gameId: "kame-knock";
	mode: MatchMode;
	powerupsEnabled: boolean;
	phase: "pending" | "active" | "finished" | "abandoned";
	currentTurn: number;
	turnNumber: number;
	roundNumber: number;
	totalRounds: number;
	activeTurnNumber: number | null;
	score: number[];
	roundScores: number[];
	targets: Array<{
		id: number;
		kind: "daruma" | "crate" | "drum";
		breakable: boolean;
		nx: number;
		ny: number;
		ageMs: number;
		lifetimeMs: number;
		radiusSrc: number;
		points: number;
	}>;
	nextTargetId: number;
	players: SnapshotPlayer[];
	balls: BallSnapshotData[];
	activeBallIdBySide: Array<number | null>;
	nextBallId: number;
	entities: ReplayFrameSnapshotEntity[];
	winnerSide: number | null;
}

export interface BellClashSnapshot {
	matchId: string;
	seq: number;
	gameId: "bell-clash";
	mode: MatchMode;
	powerupsEnabled: boolean;
	phase: "pending" | "active" | "finished" | "abandoned";
	roundNumber: number;
	totalRounds: number;
	shotsPerRound: number;
	score: number[];
	liveRoundScores: number[];
	roundScores: Array<number | null>;
	shotCounts: number[];
	zones: Array<{
		kind: "red" | "yellow" | "green";
		start: number;
		end: number;
	}>;
	players: SnapshotPlayer[];
	balls: BallSnapshotData[];
	activeBallIdBySide: Array<number | null>;
	nextBallId: number;
	entities: ReplayFrameSnapshotEntity[];
	winnerSide: number | null;
}

export type GameSnapshot =
	| CurlingSnapshot
	| BambooBashSnapshot
	| KameKnockSnapshot
	| BellClashSnapshot;

export interface RoomPlayer {
	socketId: string;
	user: SocketUser;
	side: number;
	shellSelection: string[];
	ready: boolean;
	connected: boolean;
	reconnectExpiresAt?: number;
	disconnectTimer?: NodeJS.Timeout;
}

export interface MatchRoom {
	matchId: string;
	gameId: string;
	mode: MatchMode;
	status: "pending" | "active" | "finished" | "abandoned";
	players: RoomPlayer[];
	spectators: Map<string, SocketUser>;
	seq: number;
	state: GameSnapshot;
	rewardsGranted?: boolean;
	replayFrames: Array<{
		seq: number;
		recordedAt: string;
		recordedAtMs: number;
		tickTs: number;
		deltaMs: number;
		snapshot: Record<string, unknown>;
	}>;
	replayEvents: Array<{
		type: string;
		seq: number;
		recordedAt: string;
		recordedAtMs: number;
		tickTs: number;
		payload: Record<string, unknown>;
	}>;
	replayLastCapturedSeq: number | null;
	replayStartedAt: number | null;
	replayLastRecordedAt: number | null;
	replayLastSimulationAt: number | null;
}
