import { MatchMode } from "./entities/match.entity";
import { GameMap } from "./game-map";

export interface SocketUser {
	id: number;
	username: string;
	turtleName?: string | null;
	shellSkin?: string;
	trailEffect?: string;
	hubBackground?: string;
	hubBackgroundAlter?: string | null;
	isGuest: boolean;
}

export type ReplayContractVersion = 1;

export interface QueueJoinPayload {
	gameId: string;
	mode: MatchMode;
	playerCount?: number;
	powerupsEnabled?: boolean;
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
		| "bamboo:power-pickup"
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
	ballsPerPlayer: number;
	totalEnds: number;
	score: number[];
	endScores: Array<Array<number | null>>;
	map: GameMap;
	players: SnapshotPlayer[];
	objects: Array<{
		id: number;
		side: number;
		type: "ball";
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
	entities: ReplayFrameSnapshotEntity[];
	activeBallId: number | null;
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
	power?: string;
	trail?: Array<{ x: number; y: number }>;
}

export interface ReplayFrameSnapshotEntity {
	id: number;
	type: "projectile" | "ball";
	side?: number;
	ownerSide: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	rotation: number;
	angularVelocity: number;
	r?: number;
	power?: string;
	scale: number;
	visible: boolean;
	alpha: number;
	spriteKey: string;
	stateFlags: string[];
	createdAt: number;
	updatedAt: number;
	stopped: boolean;
	trail?: Array<{ x: number; y: number }>;
}

export interface SnapshotPlayer {
	side: number;
	userId: number | null;
	username: string;
	turtleName?: string | null;
	shellSkin?: string;
	trailEffect?: string;
	hubBackground?: string;
	hubBackgroundAlter?: string | null;
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
	usedPowersBySide: string[][];
	lastPowerBySide: string[];
	lastPowerPickupIdBySide: Array<number | null>;
	powerPickups: Array<{
		id: number;
		type: string;
		nx: number;
		ny: number;
	}>;
	nextPowerPickupId: number;
	powerPickupAccMs: number;
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
	usedPowersBySide: string[][];
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
	usedPowersBySide: string[][];
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

export interface BellClashPhysicsEntity {
	id: number;
	ownerSide: number;
	shotNumber: number;
	primary: boolean;
	x: number;
	y: number;
	vx: number;
	vy: number;
	radius: number;
	rotation: number;
	angularVelocity: number;
	power: string;
	stopped: boolean;
	alpha: number;
	ghostCollisionAvailable: boolean;
}

export interface BellClashPhysicsPickup {
	id: number;
	type: string;
	x: number;
	y: number;
	radius: number;
}

export interface BellClashScoreEvent {
	id: number;
	side: number;
	points: number;
	zoneKind: "red" | "yellow" | "green" | "neutral";
}

export interface BellClashPhysicsState {
	matchId: string;
	physicsSeq: number;
	serverTime: number;
	entities: BellClashPhysicsEntity[];
	pickups: BellClashPhysicsPickup[];
	scoreEvents: BellClashScoreEvent[];
	nextEntityId: number;
	nextPickupId: number;
	nextScoreEventId: number;
	bellCooldownMs: number[];
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
	physicsState?: BellClashPhysicsState;
	rewardsGranted?: boolean;
	rematchReadyUserIds?: Set<number>;
	rematchLeftUserIds?: Set<number>;
	rematchStartedMatchId?: string;
	replayFrames: Array<{
		replayVersion?: ReplayContractVersion;
		seq: number;
		recordedAt: string;
		recordedAtMs: number;
		tickTs: number;
		deltaMs: number;
		snapshot: Record<string, unknown>;
	}>;
	replayEvents: Array<{
		replayVersion?: ReplayContractVersion;
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
}
