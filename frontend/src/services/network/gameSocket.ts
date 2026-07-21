import { io, Socket } from "socket.io-client";

export type MatchMode = "casual" | "ranked";

export type ReplayContractVersion = 2;

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
	/** The seat that led end 0 (random per match) — every later end's lead
	 *  rotates from this instead of always starting at 0. */
	startingTurn: number;
	turnNumber: number;
	maxTurns: number;
	currentEnd: number;
	throwsInEnd: number;
	ballsPerPlayer: number;
	totalEnds: number;
	score: number[];
	endScores: Array<Array<number | null>>;
	usedPowersBySide?: string[][];
	map: GameMap;
	players: Array<{
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
	}>;
	objects: Array<{
		id: number;
		side: number;
		type?: "ball";
		ownerSide?: number;
		x: number;
		y: number;
		vx?: number;
		vy?: number;
		rotation?: number;
		angularVelocity?: number;
		moving?: boolean;
		scale?: number;
		visible?: boolean;
		alpha?: number;
		spriteKey?: string;
		stateFlags?: string[];
		createdAt?: number;
		updatedAt?: number;
		stopped?: boolean;
		power: string;
		trail?: Array<{ x: number; y: number }>;
	}>;
	entities?: ReplayFrameSnapshotEntity[];
	activeBallId?: number | null;
	winnerSide: number | null;
}

export interface BallSnapshotData {
	id?: number | string;
	type?: "projectile";
	side: number;
	ownerSide?: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	rotation?: number;
	angularVelocity?: number;
	r?: number;
	moving?: boolean;
	stopped?: boolean;
	visible?: boolean;
	alpha?: number;
	spriteKey?: string;
	stateFlags?: string[];
	power?: string;
	scale?: number;
	trail?: Array<{ x: number; y: number }>;
}

export interface ReplayFrameSnapshotEntity {
	id?: number | string;
	type: "projectile" | "ball";
	side?: number;
	ownerSide: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	r?: number;
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
	activeBallIdBySide: Array<number | string | null>;
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
	/** The seat that took turn 0 (random per match) — every later turn's
	 *  rotation offsets from this instead of always starting at 0. */
	startingTurn: number;
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
	activeBallIdBySide: Array<number | string | null>;
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
	activeBallIdBySide: Array<number | string | null>;
	nextBallId: number;
	entities: ReplayFrameSnapshotEntity[];
	winnerSide: number | null;
}

export interface ArenaPhysicsEntity {
	id: number;
	ownerSide: number;
	primary: boolean;
	x: number;
	y: number;
	vx: number;
	vy: number;
	radius: number;
	power: string;
	stopped: boolean;
	alpha: number;
}

export interface ArenaPhysicsImpactEvent {
	id: number;
	kind: "bumper" | "solid-target";
	entityId: number;
	side: number;
	objectId: number;
	x: number;
	y: number;
}

export interface BambooBashPhysicsState {
	matchId: string;
	physicsSeq: number;
	serverTime: number;
	entities: ArenaPhysicsEntity[];
	pickups: Array<{ id: number; type: string; x: number; y: number; radius: number }>;
	scoreEvents: Array<{ id: number; side: number; points: number; bambooId: number }>;
	pickupEvents?: Array<{ id: number; side: number; type: string; x: number; y: number }>;
	bamboos: BambooBashSnapshot["bamboos"];
	liveRoundScores: number[];
}

export interface KameKnockPhysicsState {
	matchId: string;
	physicsSeq: number;
	serverTime: number;
	entities: Array<ArenaPhysicsEntity & { turnNumber: number }>;
	pickups: Array<{ id: number; type: string; x: number; y: number; radius: number }>;
	scoreEvents: Array<{
		id: number;
		side: number;
		targetId: number;
		targetKind: "daruma" | "crate" | "drum";
		points: number;
		combo: number;
		perfect: boolean;
		x: number;
		y: number;
	}>;
	pickupEvents?: Array<{ id: number; side: number; type: string; x: number; y: number }>;
	impactEvents?: ArenaPhysicsImpactEvent[];
	targets?: KameKnockSnapshot["targets"];
	score?: number[];
	roundScores?: number[];
	currentTurn?: number;
	turnNumber?: number;
	roundNumber?: number;
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
}

export interface BellClashPhysicsState {
	matchId: string;
	physicsSeq: number;
	serverTime: number;
	entities: BellClashPhysicsEntity[];
	pickups: Array<{
		id: number;
		type: string;
		x: number;
		y: number;
		radius: number;
	}>;
	scoreEvents: Array<{
		id: number;
		side: number;
		points: number;
		zoneKind: "red" | "yellow" | "green" | "neutral";
	}>;
	pickupEvents?: Array<{ id: number; side: number; type: string; x: number; y: number }>;
	liveRoundScores: number[];
}

export interface ShellCurlPhysicsEntity {
	id: number;
	shotNumber: number;
	primary: boolean;
	ownerSide: number;
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
}

export interface ShellCurlPhysicsState {
	matchId: string;
	physicsSeq: number;
	serverTime: number;
	entities: ShellCurlPhysicsEntity[];
	pickups: Array<{
		id: number;
		type: string;
		x: number;
		y: number;
		radius: number;
	}>;
	scoreEvents: [];
	pickupEvents: Array<{
		id: number;
		side: number;
		type: string;
		x: number;
		y: number;
	}>;
	impactEvents?: ArenaPhysicsImpactEvent[];
}

export interface OnlineMatchContext {
	matchId: string;
	side: number;
	/** Owning tournament id when this match is a tournament minigame — the
	 * end-of-match UI routes back to `/tournament/:id` instead of the hub. */
	tournamentId?: string;
	spectator?: boolean;
	rejoining?: boolean;
	snapshot?: GameSnapshot;
	physicsState?: BellClashPhysicsState | BambooBashPhysicsState | KameKnockPhysicsState | ShellCurlPhysicsState;
	replayEnabled: boolean;
	replayDisabledReason: "powerups-enabled" | null;
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
