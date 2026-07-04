import type { ReplayImportRequest } from "../../features/hub/api";
import type {
	BallSnapshotData,
	ReplayFrameSnapshotEntity,
	SnapshotPlayer,
} from "../../services/network/gameSocket";

const DEFAULT_MAX_IMPORTED_REPLAY_FRAMES = 240;
const REPLAY_CONTRACT_VERSION = 1;
const POWER_SCALE: Record<string, number> = {
	giant: 2,
	tiny: 0.5,
};
const TRANSLUCENT_POWERS = new Set(["phantom", "ghost"]);

export interface LocalReplayFrameDraft {
	seq: number;
	recordedAt: string;
	recordedAtMs?: number;
	tickTs?: number;
	deltaMs?: number;
	snapshot: Record<string, unknown>;
}

export interface LocalReplayUser {
	id?: number;
	username?: string;
	turtleName?: string | null;
	shellSkin?: string;
	hubBackground?: string;
	hubBackgroundAlter?: string | null;
}

export interface LocalReplayPlayerVisuals {
	shellSkins?: Record<string, string>;
}

export function createLocalReplayId(gameId: string): string {
	return `local:${gameId}:${Date.now()}`;
}

export function buildLocalReplayPlayers(
	user: LocalReplayUser | undefined,
	playerCount: number,
	visuals: LocalReplayPlayerVisuals = {},
): SnapshotPlayer[] {
	return Array.from({ length: Math.max(1, playerCount) }, (_value, index) => ({
		side: index,
		userId: index === 0 ? (user?.id ?? null) : null,
		username:
			index === 0
				? (user?.turtleName ?? user?.username ?? "Player 1")
				: `Player ${index + 1}`,
		turtleName: index === 0 ? (user?.turtleName ?? null) : null,
		shellSkin:
			visuals.shellSkins?.[`player${index}`] ??
			(index === 0 ? (user?.shellSkin ?? "base") : "base"),
		hubBackground: index === 0 ? (user?.hubBackground ?? "night_bg") : "night_bg",
		hubBackgroundAlter: index === 0 ? (user?.hubBackgroundAlter ?? null) : null,
		connected: true,
		ready: true,
		reconnectExpiresAt: null,
	}));
}

export function buildLocalReplayPlayerUserIds(
	userId: number | null | undefined,
	playerCount: number,
): Array<number | null> {
	return Array.from({ length: Math.max(1, playerCount) }, (_value, index) =>
		index === 0 ? (userId ?? null) : null,
	);
}

export function resolveReplayWinnerSide(scores: number[]): number | null {
	if (scores.length <= 1) return null;
	const maxScore = Math.max(...scores);
	const winnerCount = scores.filter((score) => score === maxScore).length;
	if (winnerCount !== 1) return null;
	return scores.findIndex((score) => score === maxScore);
}

export function replayBallToEntity(
	ball: BallSnapshotData,
	fallbackSpriteKey: string,
): ReplayFrameSnapshotEntity {
	const stopped = ball.stopped ?? !ball.moving;
	const power = ball.power ?? "none";
	return {
		id: ball.id ?? ball.side,
		type: "projectile",
		side: ball.side,
		ownerSide: ball.ownerSide ?? ball.side,
		x: ball.x,
		y: ball.y,
		vx: ball.vx,
		vy: ball.vy,
		rotation: ball.rotation ?? 0,
		angularVelocity: ball.angularVelocity ?? 0,
		scale: POWER_SCALE[power] ?? ball.scale ?? 1,
		visible: ball.visible ?? true,
		alpha: TRANSLUCENT_POWERS.has(power) ? 0.52 : ball.alpha ?? 1,
		spriteKey: ball.spriteKey ?? fallbackSpriteKey,
		stateFlags: withPowerStateFlags(
			ball.stateFlags ?? [stopped ? "settled" : "moving"],
			power,
		),
		createdAt: 0,
		updatedAt: 0,
		stopped,
		power,
		...(ball.trail?.length ? { trail: ball.trail.map((point) => ({ ...point })) } : {}),
	};
}

export function replayStoneToEntity(stone: {
	id: number;
	side: number;
	ownerSide?: number;
	x: number;
	y: number;
	vx?: number;
	vy?: number;
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
	moving?: boolean;
	power?: string;
	trail?: Array<{ x: number; y: number }>;
}): ReplayFrameSnapshotEntity {
	const stopped = stone.stopped ?? !stone.moving;
	const power = stone.power ?? "none";
	return {
		id: stone.id,
		type: "stone",
		side: stone.side,
		ownerSide: stone.ownerSide ?? stone.side,
		x: stone.x,
		y: stone.y,
		vx: stone.vx ?? 0,
		vy: stone.vy ?? 0,
		rotation: stone.rotation ?? 0,
		angularVelocity: stone.angularVelocity ?? 0,
		scale: POWER_SCALE[power] ?? stone.scale ?? 1,
		visible: stone.visible ?? true,
		alpha: TRANSLUCENT_POWERS.has(power) ? 0.52 : stone.alpha ?? 1,
		spriteKey: stone.spriteKey ?? "temple-curling-stone",
		stateFlags: withPowerStateFlags(
			stone.stateFlags ?? [stopped ? "settled" : "moving"],
			power,
		),
		createdAt: stone.createdAt ?? 0,
		updatedAt: stone.updatedAt ?? 0,
		stopped,
		power,
		...(stone.trail?.length ? { trail: stone.trail.map((point) => ({ ...point })) } : {}),
	};
}

export function withPowerStateFlags(flags: string[], power: string): string[] {
	if (!power || power === "none") return flags;
	return [...flags, `power:${power}`].filter(
		(flag, index, allFlags) => allFlags.indexOf(flag) === index,
	);
}

export function normalizeReplayImportFrames(
	frames: LocalReplayFrameDraft[],
	maxFrames = DEFAULT_MAX_IMPORTED_REPLAY_FRAMES,
): ReplayImportRequest["frames"] {
	const firstFrameTime = parseFrameTime(frames[0]?.recordedAt);
	const normalizedFrames = frames.map((frame, index) => ({
		replayVersion: REPLAY_CONTRACT_VERSION,
		seq: index,
		recordedAt: frame.recordedAt,
		recordedAtMs: frame.recordedAtMs ?? parseFrameTime(frame.recordedAt) ?? 0,
		tickTs:
			frame.tickTs ??
			resolveFrameTickTs(parseFrameTime(frame.recordedAt), firstFrameTime),
		deltaMs:
			index === 0
				? frame.deltaMs
				: Math.max(
					0,
					(parseFrameTime(frame.recordedAt) ?? 0) -
						(parseFrameTime(frames[index - 1]?.recordedAt) ??
							parseFrameTime(frame.recordedAt) ??
							0),
				),
		snapshot: frame.snapshot,
	}));

	if (normalizedFrames.length <= maxFrames) return normalizedFrames;

	const keptIndices = new Set<number>([0, normalizedFrames.length - 1]);
	const interiorTarget = maxFrames - 2;
	for (let slot = 0; slot < interiorTarget; slot += 1) {
		const ratio = (slot + 1) / (interiorTarget + 1);
		const index = Math.round(ratio * (normalizedFrames.length - 1));
		keptIndices.add(index);
	}

	return [...keptIndices]
		.sort((left, right) => left - right)
		.map((sourceIndex, compactIndex, indices) => {
			const frame = normalizedFrames[sourceIndex];
			if (compactIndex === 0) return { ...frame, seq: 0 };
			const previousFrame = normalizedFrames[indices[compactIndex - 1]];
			return {
				...frame,
				seq: compactIndex,
				deltaMs: Math.max(
					0,
					(parseFrameTime(frame.recordedAt) ?? 0) -
						(parseFrameTime(previousFrame.recordedAt) ??
							parseFrameTime(frame.recordedAt) ??
							0),
				),
			};
		});
}

function parseFrameTime(value: string | undefined): number | null {
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function resolveFrameTickTs(
	frameTime: number | null,
	firstFrameTime: number | null,
): number {
	if (frameTime === null || firstFrameTime === null) return 0;
	return Math.max(0, frameTime - firstFrameTime);
}
