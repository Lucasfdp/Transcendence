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

export type ReplayContractVersion = 2;

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
	/** The seat that led end 0 (see BaseEngine.randomStartingTurn) — every
	 *  later end's lead rotates from this instead of always starting at 0. */
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
	ghostCollisionAvailable: boolean;
	frozen?: boolean;
	ghostAvailable?: boolean;
	phantomHidden?: boolean;
	stopPowerApplied?: boolean;
	boomerangTravel?: number;
	boomerangLimit?: number;
	boomerangFlipped?: boolean;
	trail?: Array<{ x: number; y: number }>;
}

export interface ShellCurlPhysicsPickup {
	id: number;
	type: string;
	x: number;
	y: number;
	radius: number;
}

export interface ShellCurlPhysicsState {
	matchId: string;
	physicsSeq: number;
	serverTime: number;
	entities: ShellCurlPhysicsEntity[];
	pickups: ShellCurlPhysicsPickup[];
	scoreEvents: [];
	pickupEvents: ArenaPhysicsPickupEvent[];
	impactEvents: ArenaPhysicsImpactEvent[];
	nextEntityId: number;
	nextPickupId: number;
	nextPickupEventId: number;
	nextImpactEventId: number;
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
	/** The seat that took turn 0 (see BaseEngine.randomStartingTurn) — every
	 *  later turn's rotation offsets from this instead of always starting at 0. */
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

export interface ArenaPhysicsPickupEvent {
	id: number;
	side: number;
	type: string;
	x: number;
	y: number;
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

export interface BellClashPhysicsState {
	matchId: string;
	physicsSeq: number;
	serverTime: number;
	entities: BellClashPhysicsEntity[];
	pickups: BellClashPhysicsPickup[];
	scoreEvents: BellClashScoreEvent[];
	pickupEvents?: ArenaPhysicsPickupEvent[];
	impactEvents?: ArenaPhysicsImpactEvent[];
	nextEntityId: number;
	nextPickupId: number;
	nextScoreEventId: number;
	nextPickupEventId?: number;
	bellCooldownMs: number[];
}

export interface BambooBashPhysicsEntity extends BellClashPhysicsEntity {}

export interface BambooBashPhysicsPickup extends BellClashPhysicsPickup {}

export interface BambooBashScoreEvent {
	id: number;
	side: number;
	points: number;
	bambooId: number;
}

export interface BambooBashPhysicsState {
	matchId: string;
	physicsSeq: number;
	serverTime: number;
	entities: BambooBashPhysicsEntity[];
	pickups: BambooBashPhysicsPickup[];
	scoreEvents: BambooBashScoreEvent[];
	pickupEvents?: ArenaPhysicsPickupEvent[];
	impactEvents?: ArenaPhysicsImpactEvent[];
	nextEntityId: number;
	nextPickupId: number;
	nextScoreEventId: number;
	nextPickupEventId?: number;
}

export interface KameKnockPhysicsEntity extends BellClashPhysicsEntity {
	turnNumber?: number;
}

export interface KameKnockPhysicsState {
	matchId: string;
	physicsSeq: number;
	serverTime: number;
	entities: KameKnockPhysicsEntity[];
	pickups: BellClashPhysicsPickup[];
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
	pickupEvents?: ArenaPhysicsPickupEvent[];
	impactEvents: ArenaPhysicsImpactEvent[];
	nextEntityId: number;
	nextPickupId: number;
	nextScoreEventId: number;
	nextPickupEventId?: number;
	nextImpactEventId: number;
	combo: number;
	settledProjectionPending: boolean;
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

/** Socket-id prefix marking a server-driven (CPU) seat. */
export const BOT_SOCKET_PREFIX = "bot:";

/**
 * A seat currently played by the server (self-clears on human reconnect).
 * Lives here — a dependency-free leaf — so both `bot-player.service` and
 * `game-session.service` can use it without importing each other (the latter
 * would form a cycle through `matchmaking.gateway`).
 */
export const isBotSeat = (player: RoomPlayer): boolean =>
	player.socketId.startsWith(BOT_SOCKET_PREFIX);

export interface MatchRoom {
	matchId: string;
	gameId: string;
	mode: MatchMode;
	/**
	 * Set when this match is a tournament-launched minigame (SPEC-015): the id
	 * of the owning tournament. Client payloads (`match:status`,
	 * `tournament:minigame-start`) carry it so the end-of-match UI can route
	 * players back to the tournament board instead of the hub.
	 */
	tournamentId?: string;
	status: "pending" | "active" | "finished" | "abandoned";
	/** Wall-clock time (ms) the room was created (R5 pending-room TTL). */
	createdAt?: number;
	/**
	 * Wall-clock time (ms) the room reached a terminal state. Set by
	 * `RoomService.finish`; used by the finished-room TTL sweep to bound memory
	 * (R2).
	 */
	finishedAt?: number;
	players: RoomPlayer[];
	spectators: Map<string, SocketUser>;
	seq: number;
	state: GameSnapshot;
	physicsState?: BellClashPhysicsState | BambooBashPhysicsState | KameKnockPhysicsState | ShellCurlPhysicsState;
	replayEnabled: boolean;
	replayDisabledReason: "powerups-enabled" | null;
	rewardsGranted?: boolean;
	rematchReadyUserIds?: Set<number>;
	rematchLeftUserIds?: Set<number>;
	rematchStartedMatchId?: string;
	/**
	 * User ids whose client has actually mounted the arena scene for this
	 * match (`game:arena-ready`) — distinct from `ready`/`connected`, which a
	 * server-initiated launch (tournament minigame, lobby match, rematch)
	 * sets unconditionally before any client has navigated in. Bot seats are
	 * never expected to appear here (`BotPlayerService` skips them via
	 * `isBotSeat`); used to hold CPU activity until every real seat has
	 * genuinely loaded in, not merely a guessed navigation delay.
	 */
	enteredUserIds: Set<number>;
	replayFrames: Array<{
		seq: number;
		tMs: number;
		round: number;
		state: "pending" | "active" | "finished" | "abandoned";
		type: "keyframe" | "delta";
		changes: Record<string, unknown>;
		removals: string[];
	}>;
	replayEvents: Array<{
		seq: number;
		tMs: number;
		round: number;
		type: string;
		payload: Record<string, unknown>;
	}>;
	replayStartedAt: number | null;
	replayLastSampleAt: number | null;
	replayLastKeyframeAt: number | null;
	replayLastSnapshot: Record<string, unknown> | null;
}
