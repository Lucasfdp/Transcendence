import type { ArenaPixels } from "../../../shared/arenas/arena";
import type { BallState, StoneState } from "../../../shared/mechanics/ball";
import type { ObstacleDescriptor } from "../../../shared/mechanics/obstacle-descriptor";
import type { RectArenaPixels } from "../../../shared/mechanics/rect-arena";
import type {
	BallSnapshotData,
	BambooBashSnapshot,
	BellClashSnapshot,
	CurlingSnapshot,
	KameKnockSnapshot,
	SnapshotPlayer,
} from "../../../services/network/gameSocket";
import {
	resolveReplayWinnerSide,
	withPowerStateFlags,
} from "../localReplay";
import {
	buildReplayProjectileEntities,
	buildReplayStoneEntities,
} from "../runtime/ReplayEntities";

interface ReplaySnapshotBaseOptions {
	readonly matchId: string;
	readonly seq: number;
	readonly powerupsEnabled: boolean;
	readonly players: SnapshotPlayer[];
}

interface ArenaReplayProjectileOptions {
	readonly ball: BallState;
	readonly arena: ArenaPixels;
	readonly id: number | string;
	readonly side: number;
	readonly ownerSide?: number;
	readonly moving: boolean;
	readonly power: string;
	readonly spriteKey: string;
	readonly sourceRadius: number;
	readonly trail?: readonly { x: number; y: number }[];
}

export function buildArenaReplayProjectileSnapshot(
	options: ArenaReplayProjectileOptions,
): BallSnapshotData {
	const scale = options.ball.r / (options.sourceRadius * options.arena.scale);
	return {
		id: options.id,
		type: "projectile",
		side: options.side,
		ownerSide: options.ownerSide ?? options.side,
		x: (options.ball.x - options.arena.cx) / options.arena.rx,
		y: (options.ball.y - options.arena.cy) / options.arena.ry,
		vx: options.ball.vx / options.arena.scale,
		vy: options.ball.vy / options.arena.scale,
		rotation: 0,
		angularVelocity: 0,
		moving: options.moving,
		stopped: !options.moving,
		visible: true,
		alpha:
			options.power === "phantom" || options.power === "ghost" ? 0.52 : 1,
		spriteKey: options.spriteKey,
		stateFlags: withPowerStateFlags(
			[options.moving ? "moving" : "settled"],
			options.power,
		),
		power: options.power,
		scale,
		...(options.trail?.length ? { trail: [...options.trail] } : {}),
	};
}

interface BambooReplayParticipant {
	readonly ball: BallState;
	readonly score: number;
	readonly replayPower: string;
	readonly powerUsed: Iterable<string>;
}

type SerializableObstacleDescriptor<
	TType extends string,
	TRendering,
> = Pick<
	ObstacleDescriptor<TType, TRendering, any>,
	"id" | "type" | "position" | "geometry" | "scoreValue" | "rendering"
>;

type BambooReplayObstacleDescriptor = SerializableObstacleDescriptor<
	"bamboo",
	{ readonly stage: number; readonly ageMs: number }
>;

export interface BambooBashLocalReplaySnapshotOptions extends ReplaySnapshotBaseOptions {
	readonly phase: BambooBashSnapshot["phase"];
	readonly arena: ArenaPixels;
	readonly sourceRadius: number;
	readonly roundMs: number;
	readonly startedAtMs: number;
	readonly participants: readonly BambooReplayParticipant[];
	readonly bamboos: readonly BambooReplayObstacleDescriptor[];
	readonly spawnAccMs: number;
	readonly readTrail: (
		key: string | number,
	) => readonly { x: number; y: number }[];
	readonly isMoving: (ball: BallState) => boolean;
}

export function buildBambooBashLocalReplaySnapshot(
	options: BambooBashLocalReplaySnapshotOptions,
): BambooBashSnapshot {
	const scores = options.participants.map((participant) => participant.score);
	const balls = options.participants.map((participant, index) =>
		buildArenaReplayProjectileSnapshot({
			ball: participant.ball,
			arena: options.arena,
			id: index,
			side: index,
			ownerSide: index,
			moving: options.isMoving(participant.ball),
			power: participant.replayPower,
			spriteKey: "bamboo-bash-shell",
			sourceRadius: options.sourceRadius,
			trail: options.readTrail(`local-${index}`),
		}),
	);

	return {
		matchId: options.matchId,
		seq: options.seq,
		gameId: "bamboo-bash",
		mode: "casual",
		powerupsEnabled: options.powerupsEnabled,
		phase: options.phase,
		roundNumber: 1,
		totalRounds: 1,
		roundTimeMs: options.roundMs,
		roundStartedAt: options.startedAtMs,
		roundEndsAt: options.startedAtMs + options.roundMs,
		score: [...scores],
		liveRoundScores: [...scores],
		roundScores: scores.map((score) =>
			options.phase === "finished" ? score : null,
		),
		bamboos: buildBambooReplayObjects(options.bamboos),
		nextBambooId: options.bamboos.length,
		spawnAccMs: options.spawnAccMs,
		lastBambooUpdateAt: Date.now(),
		usedPowersBySide: options.participants.map((participant) => [
			...participant.powerUsed,
		]),
		lastPowerBySide: options.participants.map(() => "none"),
		lastPowerPickupIdBySide: options.participants.map(() => null),
		powerPickups: [],
		nextPowerPickupId: 1,
		powerPickupAccMs: 0,
		players: options.players,
		balls,
		activeBallIdBySide: options.participants.map((participant, index) =>
			options.isMoving(participant.ball) ? index : null,
		),
		nextBallId: options.participants.length,
		entities: buildReplayProjectileEntities(balls, "bamboo-bash-shell"),
		winnerSide:
			options.phase === "finished"
				? resolveReplayWinnerSide(scores)
				: null,
	};
}

export function buildBambooReplayObjects(
	descriptors: readonly BambooReplayObstacleDescriptor[],
): BambooBashSnapshot["bamboos"] {
	return descriptors.map((descriptor, index) => ({
		id:
			typeof descriptor.id === "number"
				? descriptor.id
				: Number.isFinite(Number(descriptor.id))
					? Number(descriptor.id)
					: index,
		nx: descriptor.position.x,
		ny: descriptor.position.y,
		stage: descriptor.rendering?.stage ?? 1,
		ageMs: descriptor.rendering?.ageMs ?? 0,
	}));
}

type TimedTargetReplayObstacleDescriptor = SerializableObstacleDescriptor<
	"timed-target",
	{
		readonly kind: KameKnockSnapshot["targets"][number]["kind"];
		readonly breakable: boolean;
		readonly ageMs: number;
		readonly lifetimeMs: number;
	}
>;

export interface KameKnockLocalReplaySnapshotOptions extends ReplaySnapshotBaseOptions {
	readonly phase: KameKnockSnapshot["phase"];
	readonly arena: ArenaPixels;
	readonly sourceRadius: number;
	readonly ball: BallState;
	readonly ballMoving: boolean;
	readonly activeSide: number;
	readonly replayPower: string;
	readonly trail: readonly { x: number; y: number }[];
	readonly localTurnNumber: number;
	readonly currentBallIndex: number;
	readonly totalRounds: number;
	readonly launchedThisBall: boolean;
	readonly localScores: readonly number[];
	readonly targets: readonly TimedTargetReplayObstacleDescriptor[];
	readonly nextTargetId: number;
	readonly localPlayerCount: number;
	readonly winnerSide: number | null;
}

export function buildKameKnockLocalReplaySnapshot(
	options: KameKnockLocalReplaySnapshotOptions,
): KameKnockSnapshot {
	const ball = buildArenaReplayProjectileSnapshot({
		ball: options.ball,
		arena: options.arena,
		id: "local-shell",
		side: options.activeSide,
		ownerSide: options.activeSide,
		moving: options.ballMoving,
		power: options.replayPower,
		spriteKey: "kame-knock-shell",
		sourceRadius: options.sourceRadius,
		trail: options.trail,
	});

	return {
		matchId: options.matchId,
		seq: options.seq,
		gameId: "kame-knock",
		mode: "casual",
		powerupsEnabled: options.powerupsEnabled,
		phase: options.phase,
		currentTurn: options.activeSide,
		turnNumber: options.localTurnNumber,
		roundNumber: options.currentBallIndex + 1,
		totalRounds: options.totalRounds,
		activeTurnNumber: options.launchedThisBall
			? options.localTurnNumber
			: null,
		score: [...options.localScores],
		roundScores: [...options.localScores],
		targets: buildTimedTargetReplayObjects(options.targets),
		nextTargetId: options.nextTargetId,
		players: options.players,
		balls: [ball],
		activeBallIdBySide: Array.from(
			{ length: options.localPlayerCount },
			(_value, side) =>
				side === options.activeSide && options.launchedThisBall
					? "local-shell"
					: null,
		),
		nextBallId: 1,
		entities: buildReplayProjectileEntities([ball], "kame-knock-shell"),
		winnerSide: options.phase === "finished" ? options.winnerSide : null,
	};
}

export function buildTimedTargetReplayObjects(
	descriptors: readonly TimedTargetReplayObstacleDescriptor[],
): KameKnockSnapshot["targets"] {
	return descriptors.map((descriptor) => ({
		id:
			typeof descriptor.id === "number"
				? descriptor.id
				: Number(descriptor.id),
		kind: descriptor.rendering?.kind ?? "daruma",
		breakable: descriptor.rendering?.breakable ?? true,
		nx: descriptor.position.x,
		ny: descriptor.position.y,
		ageMs: descriptor.rendering?.ageMs ?? 0,
		lifetimeMs: descriptor.rendering?.lifetimeMs ?? 0,
		radiusSrc:
			descriptor.geometry.shape === "circle"
				? descriptor.geometry.radius
				: 0,
		points: descriptor.scoreValue ?? 0,
	}));
}

interface BellClashReplayBall {
	readonly side: number;
	readonly ball: BallState;
	readonly moving: boolean;
	readonly power: string;
	readonly trail: readonly { x: number; y: number }[];
}

export interface ScoreRegionDescriptor<
	TType extends string = string,
	TKind extends string = string,
> {
	readonly id: string | number;
	readonly type: TType;
	readonly kind: TKind;
	readonly range: {
		readonly unit: "radians";
		readonly start: number;
		readonly end: number;
	};
}

type BellClashScoreZoneDescriptor = ScoreRegionDescriptor<
	"score-zone",
	BellClashSnapshot["zones"][number]["kind"]
>;

export function buildBellClashScoreZoneDescriptor(
	zone: BellClashSnapshot["zones"][number],
	index: number,
): BellClashScoreZoneDescriptor {
	return {
		id: `zone:${index}:${zone.kind}`,
		type: "score-zone",
		kind: zone.kind,
		range: {
			unit: "radians",
			start: zone.start,
			end: zone.end,
		},
	};
}

export function buildBellClashReplayZones(
	descriptors: readonly BellClashScoreZoneDescriptor[],
): BellClashSnapshot["zones"] {
	return descriptors.map((descriptor) => ({
		kind: descriptor.kind,
		start: descriptor.range.start,
		end: descriptor.range.end,
	}));
}

export interface BellClashLocalReplaySnapshotOptions extends ReplaySnapshotBaseOptions {
	readonly phase: BellClashSnapshot["phase"];
	readonly arena: ArenaPixels;
	readonly sourceRadius: number;
	readonly shotsTotal: number;
	readonly currentShot: number;
	readonly localTurnNumber: number;
	readonly launchedThisShot: boolean;
	readonly currentPlayerIndex: number;
	readonly localPlayerCount: number;
	readonly localScores: readonly number[];
	readonly zones: readonly BellClashScoreZoneDescriptor[];
	readonly balls: readonly BellClashReplayBall[];
	readonly winnerSide: number | null;
}

export function buildBellClashLocalReplaySnapshot(
	options: BellClashLocalReplaySnapshotOptions,
): BellClashSnapshot {
	const roundScores = options.localScores.map((score) =>
		options.phase === "finished" ? score : null,
	);
	const shotCounts = Array.from(
		{ length: options.localPlayerCount },
		(_value, side) =>
			Math.min(
				options.shotsTotal,
				Math.floor(
					(options.localTurnNumber +
						(options.launchedThisShot ? 1 : 0) +
						options.localPlayerCount -
						1 -
						side) /
						options.localPlayerCount,
				),
			),
	);
	const balls = options.balls.map((entry) =>
		buildArenaReplayProjectileSnapshot({
			ball: entry.ball,
			arena: options.arena,
			id: entry.side,
			side: entry.side,
			ownerSide: entry.side,
			moving: entry.moving,
			power: entry.power,
			spriteKey: "bell-clash-shell",
			sourceRadius: options.sourceRadius,
			trail: entry.trail,
		}),
	);

	return {
		matchId: options.matchId,
		seq: options.seq,
		gameId: "bell-clash",
		mode: "casual",
		powerupsEnabled: options.powerupsEnabled,
		phase: options.phase,
		roundNumber: Math.min(options.shotsTotal, options.currentShot + 1),
		totalRounds: options.shotsTotal,
		shotsPerRound: 1,
		score: [...options.localScores],
		liveRoundScores: [...options.localScores],
		roundScores,
		shotCounts,
		zones: buildBellClashReplayZones(options.zones),
		players: options.players,
		balls,
		activeBallIdBySide: Array.from(
			{ length: options.localPlayerCount },
			(_value, side) =>
				side === options.currentPlayerIndex && options.launchedThisShot
					? side
					: null,
		),
		nextBallId: options.localPlayerCount,
		entities: buildReplayProjectileEntities(balls, "bell-clash-shell"),
		winnerSide: options.phase === "finished" ? options.winnerSide : null,
	};
}

interface CurlingReplayStoneOptions {
	readonly stone: StoneState;
	readonly arena: RectArenaPixels;
	readonly trail: readonly { x: number; y: number }[];
}

type BumperReplayObstacleDescriptor = SerializableObstacleDescriptor<
	"bumper",
	{
		readonly fx: number;
		readonly fy: number;
	}
>;

export function buildCurlingReplayStoneSnapshot(
	options: CurlingReplayStoneOptions,
): CurlingSnapshot["objects"][number] {
	const power = options.stone.power;
	return {
		id: options.stone.id,
		side: options.stone.teamId,
		type: "stone",
		ownerSide: options.stone.teamId,
		x: (options.stone.x - options.arena.sheetX) / options.arena.sheetW,
		y: (options.stone.y - options.arena.sheetY) / options.arena.sheetH,
		vx: options.stone.vx / options.arena.scale,
		vy: options.stone.vy / options.arena.scale,
		rotation: 0,
		angularVelocity: 0,
		moving: !options.stone.stopped,
		scale: options.stone.r / (28 * options.arena.scale),
		visible: true,
		alpha:
			(power === "phantom" || power === "ghost") &&
			(options.stone as { phantomHidden?: boolean }).phantomHidden !==
				false
				? 0.52
				: 1,
		spriteKey: "temple-curling-stone",
		stateFlags: withPowerStateFlags(
			options.stone.stopped ? ["settled"] : ["moving"],
			power,
		),
		createdAt: options.stone.id,
		updatedAt: options.stone.id,
		stopped: options.stone.stopped,
		power,
		...(options.trail.length ? { trail: [...options.trail] } : {}),
	};
}

export interface ShellCurlLocalReplaySnapshotOptions extends ReplaySnapshotBaseOptions {
	readonly phase: CurlingSnapshot["phase"];
	readonly arena: RectArenaPixels;
	readonly stones: readonly StoneState[];
	readonly activeStoneId: number | null;
	readonly playerCount: number;
	readonly currentTurn: number;
	readonly deliveredTurns: number;
	readonly maxTurns: number;
	readonly currentEnd: number;
	readonly throwsInEnd: number;
	readonly stonesPerPlayer: number;
	readonly totalEnds: number;
	readonly score: readonly number[];
	readonly endScores: readonly (readonly (number | null)[])[];
	readonly bumpers: readonly BumperReplayObstacleDescriptor[];
	readonly readStoneTrail: (
		stoneId: number,
	) => readonly { x: number; y: number }[];
	readonly winnerSide: number | null;
}

export function buildShellCurlLocalReplaySnapshot(
	options: ShellCurlLocalReplaySnapshotOptions,
): CurlingSnapshot {
	const objects = options.stones.map((stone) =>
		buildCurlingReplayStoneSnapshot({
			stone,
			arena: options.arena,
			trail: options.readStoneTrail(stone.id),
		}),
	);

	return {
		matchId: options.matchId,
		seq: options.seq,
		gameId: "temple-curling",
		mode: "casual",
		powerupsEnabled: options.powerupsEnabled,
		phase: options.phase,
		currentTurn: Math.max(
			0,
			Math.min(options.currentTurn, options.playerCount - 1),
		),
		turnNumber: options.deliveredTurns,
		maxTurns: options.maxTurns,
		currentEnd: Math.min(options.currentEnd, options.totalEnds - 1),
		throwsInEnd: options.throwsInEnd,
		stonesPerPlayer: options.stonesPerPlayer,
		totalEnds: options.totalEnds,
		score: [...options.score],
		endScores: options.endScores.map((scores) => [...scores]),
		map: {
			gameId: "temple-curling",
			bumpers: buildBumperReplayObjects(options.bumpers),
		},
		players: options.players,
		objects,
		entities: buildReplayStoneEntities(objects),
		activeStoneId: options.activeStoneId,
		winnerSide: options.phase === "finished" ? options.winnerSide : null,
	};
}

export function buildBumperReplayObjects(
	descriptors: readonly BumperReplayObstacleDescriptor[],
): Array<{ fx: number; fy: number }> {
	return descriptors.map((descriptor) => ({
		fx: descriptor.rendering?.fx ?? descriptor.position.x,
		fy: descriptor.rendering?.fy ?? descriptor.position.y,
	}));
}
