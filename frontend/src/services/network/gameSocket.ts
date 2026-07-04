import { io, Socket } from "socket.io-client";

export type MatchMode = "casual" | "ranked";

export type GameMap =
	| { gameId: "temple-curling"; bumpers: Array<{ fx: number; fy: number }> }
	| { gameId: string };

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
	players: Array<{
		side: number;
		userId: number | null;
		username: string;
		turtleName?: string | null;
		connected: boolean;
		ready: boolean;
		reconnectExpiresAt: number | null;
	}>;
	objects: Array<{
		id: number;
		side: number;
		x: number;
		y: number;
		vx?: number;
		vy?: number;
		moving?: boolean;
		power: string;
		trail?: Array<{ x: number; y: number }>;
	}>;
	winnerSide: number | null;
}

export interface BallSnapshotData {
	id?: number | string;
	side: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	moving?: boolean;
	stopped?: boolean;
	visible?: boolean;
	power?: string;
	scale?: number;
	trail?: Array<{ x: number; y: number }>;
}

export interface ReplayFrameSnapshotEntity {
	id?: number | string;
	type: "projectile" | "stone";
	side?: number;
	ownerSide: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	rotation?: number;
	angularVelocity?: number;
	scale?: number;
	visible?: boolean;
	alpha?: number;
	spriteKey?: string;
	stateFlags?: string[];
	createdAt?: number;
	updatedAt?: number;
	stopped?: boolean;
	trail?: Array<{ x: number; y: number }>;
	power?: string;
}

export interface SnapshotPlayer {
	side: number;
	userId: number | null;
	username: string;
	turtleName?: string | null;
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
	entities?: ReplayFrameSnapshotEntity[];
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
	entities?: ReplayFrameSnapshotEntity[];
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
	entities?: ReplayFrameSnapshotEntity[];
	winnerSide: number | null;
}

export type GameSnapshot =
	| CurlingSnapshot
	| BambooBashSnapshot
	| KameKnockSnapshot
	| BellClashSnapshot;

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

export interface OnlineMatchContext {
	matchId: string;
	side: number;
	spectator?: boolean;
	snapshot?: GameSnapshot;
}

let socket: Socket | null = null;

export function getGameSocket(): Socket {
	if (socket) return socket;
	socket = io("/", {
		path: "/ws/",
		withCredentials: true,
		transports: ["websocket"],
	});
	return socket;
}

export function disconnectGameSocket(): void {
	socket?.disconnect();
	socket = null;
}
