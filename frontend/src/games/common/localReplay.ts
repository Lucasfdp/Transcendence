import type { ReplayImportRequest } from "../../features/hub/api";
import type {
	BallSnapshotData,
	ReplayFrameSnapshotEntity,
	SnapshotPlayer,
} from "../../services/network/gameSocket";
import { ReplayEncoder, reconstructReplayFrame } from "./replay/ReplayEncoder";
import {
	REPLAY_CONTRACT_VERSION,
	REPLAY_KEYFRAME_INTERVAL_MS,
	type ReplayFrameV2,
	type ReplayEventV2,
} from "./replay/contracts";

// Keep the client-side import budget aligned with the API contract. Long local
// matches are sampled across their complete timeline when they exceed it.
export const REPLAY_IMPORT_FRAME_LIMIT = 3_000;
const POWER_SCALE: Record<string, number> = {
	giant: 2,
	tiny: 0.5,
};
const TRANSLUCENT_POWERS = new Set(["phantom", "ghost"]);

export type LocalReplayFrameDraft = ReplayFrameV2;

export interface LocalReplayUser {
	id?: number;
	username?: string;
	turtleName?: string | null;
	shellSkin?: string;
	trailEffect?: string;
	hubBackground?: string;
	hubBackgroundAlter?: string | null;
	isGuest?: boolean;
}

export interface LocalReplayPlayerVisuals {
	shellSkins?: Record<string, string>;
	trailEffects?: Record<string, string>;
}

export interface LocalReplayImportOptions {
	gameId: string;
	mode: ReplayImportRequest["mode"];
	createdAt: string;
	finishedAt: string;
	winnerSide: number | null;
	playerUserIds: Array<number | null>;
	playerNames: string[];
	frames: ReplayImportRequest["frames"];
	events?: ReplayImportRequest["events"];
	replayTooLong?: boolean;
}

export function createLocalReplayId(gameId: string): string {
	return `local:${gameId}:${Date.now()}`;
}

export class SceneReplayRecorder<TSnapshot extends object> {
	private replayId: string | null = null;
	private frames: LocalReplayFrameDraft[] = [];
	private startedAtIso = "";
	private elapsedMs = 0;
	private lastCaptureMs = 0;
	private captureAccMs = 0;
	private events: ReplayEventV2[] = [];
	private readonly encoder = new ReplayEncoder();

	reset(): void {
		this.replayId = null;
		this.frames = [];
		this.startedAtIso = "";
		this.elapsedMs = 0;
		this.lastCaptureMs = 0;
		this.captureAccMs = 0;
		this.events = [];
		this.encoder.reset();
	}

	start(
		gameId: string,
		buildSnapshot: (phaseOverride?: string) => TSnapshot,
	): void {
		this.replayId = createLocalReplayId(gameId);
		this.frames = [];
		this.startedAtIso = new Date().toISOString();
		this.elapsedMs = 0;
		this.lastCaptureMs = 0;
		this.captureAccMs = 0;
		this.events = [];
		this.encoder.reset();
		this.captureSnapshot(buildSnapshot, { force: true });
	}

	addElapsed(delta: number): void {
		this.elapsedMs += delta;
	}

	resetCaptureAccumulator(): void {
		this.captureAccMs = 0;
	}

	captureOnInterval(
		delta: number,
		stepMs: number,
		buildSnapshot: (phaseOverride?: string) => TSnapshot,
	): void {
		if (!this.replayId) return;
		this.captureAccMs += delta;
		while (this.captureAccMs >= stepMs) {
			const sampleTimeMs = this.elapsedMs - this.captureAccMs + stepMs;
			this.captureAccMs -= stepMs;
			this.captureSnapshot(buildSnapshot, { tMs: sampleTimeMs });
		}
	}

	captureSnapshot(
		buildSnapshot: (phaseOverride?: string) => TSnapshot,
		options: {
			force?: boolean;
			phaseOverride?: string;
			tMs?: number;
		} = {},
	): void {
		if (!this.replayId) return;
		const nowMs = Math.round(options.tMs ?? this.elapsedMs);
		if (!options.force && nowMs <= this.lastCaptureMs) return;
		this.lastCaptureMs = nowMs;
		const frame = this.encoder.encode(
			this.frames.length,
			nowMs,
			buildSnapshot(options.phaseOverride) as Record<string, unknown>,
			options.force,
		);
		if (frame) this.frames.push(frame);
	}

	getReplayId(): string | null {
		return this.replayId;
	}

	getStartedAtIso(): string {
		return this.startedAtIso;
	}

	getFrames(): LocalReplayFrameDraft[] {
		return this.frames;
	}

	hasFrames(): boolean {
		return this.frames.length > 0;
	}

	recordEvent(type: string, payload: Record<string, unknown> = {}): void {
		if (!this.replayId) return;
		this.events.push({
			seq: this.events.length,
			tMs: Math.max(0, Math.round(this.elapsedMs)),
			round: this.frames[this.frames.length - 1]?.round ?? 0,
			type,
			payload: JSON.parse(JSON.stringify(payload)) as Record<
				string,
				unknown
			>,
		});
	}

	getEvents(): ReplayEventV2[] {
		return this.events.map((event) => ({
			...event,
			payload: { ...event.payload },
		}));
	}

	nextSeq(): number {
		return this.frames.length;
	}

	buildImportFrames(
		maxFrames = REPLAY_IMPORT_FRAME_LIMIT,
	): ReplayImportRequest["frames"] {
		return normalizeReplayImportFrames(this.frames, maxFrames);
	}
}

export function buildLocalReplayPlayers(
	user: LocalReplayUser | undefined,
	playerCount: number,
	visuals: LocalReplayPlayerVisuals = {},
): SnapshotPlayer[] {
	return Array.from(
		{ length: Math.max(1, playerCount) },
		(_value, index) => ({
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
			trailEffect:
				visuals.trailEffects?.[`player${index}`] ??
				(index === 0
					? (user?.trailEffect ?? "trail_classic")
					: "trail_classic"),
			hubBackground:
				index === 0 ? (user?.hubBackground ?? "night_bg") : "night_bg",
			hubBackgroundAlter:
				index === 0 ? (user?.hubBackgroundAlter ?? null) : null,
			connected: true,
			ready: true,
			reconnectExpiresAt: null,
		}),
	);
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

export function buildLocalReplayImportRequest(
	options: LocalReplayImportOptions,
): ReplayImportRequest {
	return {
		gameId: options.gameId,
		mode: options.mode,
		status: "finished",
		createdAt: options.createdAt,
		finishedAt: options.finishedAt,
		winnerSide: options.winnerSide,
		metadata: {
			contractVersion: REPLAY_CONTRACT_VERSION,
			origin: "local",
			gameId: options.gameId,
			mode: options.mode,
			participants: options.playerNames
				.slice(0, 5)
				.map((username, side) => ({
					side,
					userId: options.playerUserIds[side] ?? null,
					username,
				})),
			durationMs: options.frames[options.frames.length - 1]?.tMs ?? 0,
			sampleHz: 20,
			keyframeIntervalMs: REPLAY_KEYFRAME_INTERVAL_MS,
			preRollMs: 3000,
			statistics: {
				winnerSide: options.winnerSide,
				replayTooLong: options.replayTooLong === true,
			},
			powerupsEnabled: false,
		},
		durationMs: options.frames[options.frames.length - 1]?.tMs ?? 0,
		frames: options.frames,
		events: options.events ?? [],
	};
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
		alpha: TRANSLUCENT_POWERS.has(power) ? 0.52 : (ball.alpha ?? 1),
		spriteKey: ball.spriteKey ?? fallbackSpriteKey,
		stateFlags: withPowerStateFlags(
			ball.stateFlags ?? [stopped ? "settled" : "moving"],
			power,
		),
		createdAt: 0,
		updatedAt: 0,
		stopped,
		power,
		...(ball.trail?.length
			? { trail: ball.trail.map((point) => ({ ...point })) }
			: {}),
	};
}

export function replayCurlingBallToEntity(ball: {
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
	const stopped = ball.stopped ?? !ball.moving;
	const power = ball.power ?? "none";
	return {
		id: ball.id,
		type: "ball",
		side: ball.side,
		ownerSide: ball.ownerSide ?? ball.side,
		x: ball.x,
		y: ball.y,
		vx: ball.vx ?? 0,
		vy: ball.vy ?? 0,
		rotation: ball.rotation ?? 0,
		angularVelocity: ball.angularVelocity ?? 0,
		scale: POWER_SCALE[power] ?? ball.scale ?? 1,
		visible: ball.visible ?? true,
		alpha: TRANSLUCENT_POWERS.has(power) ? 0.52 : (ball.alpha ?? 1),
		spriteKey: ball.spriteKey ?? "temple-curling-ball",
		stateFlags: withPowerStateFlags(
			ball.stateFlags ?? [stopped ? "settled" : "moving"],
			power,
		),
		createdAt: ball.createdAt ?? 0,
		updatedAt: ball.updatedAt ?? 0,
		stopped,
		power,
		...(ball.trail?.length
			? { trail: ball.trail.map((point) => ({ ...point })) }
			: {}),
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
	maxFrames = REPLAY_IMPORT_FRAME_LIMIT,
): ReplayImportRequest["frames"] {
	const normalizedFrames: ReplayImportRequest["frames"] = frames.map(
		(frame, index) => ({ ...frame, seq: index }),
	);

	if (normalizedFrames.length <= maxFrames) return normalizedFrames;

	const frameBudget = Math.max(2, Math.floor(maxFrames));
	const lastSourceIndex = normalizedFrames.length - 1;
	// Re-encoding makes every selected snapshot independently reconstructable,
	// so retaining every source keyframe is unnecessary. Selecting uniformly is
	// essential: prioritising keyframes and then slicing the sorted list kept the
	// start of long matches plus only their final frame, which made the latter
	// half of Temple Curling replays appear frozen.
	const sourceIndices = Array.from({ length: frameBudget }, (_value, slot) =>
		Math.round((slot * lastSourceIndex) / (frameBudget - 1)),
	);
	const encoder = new ReplayEncoder();
	const compactedFrames: ReplayImportRequest["frames"] = [];
	for (const sourceIndex of sourceIndices) {
		const source = normalizedFrames[sourceIndex];
		const encoded = encoder.encode(
			compactedFrames.length,
			source.tMs,
			reconstructReplayFrame(normalizedFrames, sourceIndex),
			source.type === "keyframe" || sourceIndex === lastSourceIndex,
		);
		if (encoded) compactedFrames.push(encoded);
	}
	return compactedFrames;
}

export function trimReplayRoundPreRoll(
	frames: ReplayImportRequest["frames"],
	events: NonNullable<ReplayImportRequest["events"]>,
	maximumPreRollMs = 3000,
): {
	frames: ReplayImportRequest["frames"];
	events: NonNullable<ReplayImportRequest["events"]>;
} {
	const starts = new Map<number, number>();
	for (const frame of frames)
		starts.set(
			frame.round,
			Math.min(starts.get(frame.round) ?? frame.tMs, frame.tMs),
		);
	const cuts: Array<{ start: number; excess: number }> = [];
	for (const event of events) {
		if (event.type !== "action:start") continue;
		const start = starts.get(event.round) ?? 0;
		if (cuts.some((cut) => cut.start === start)) continue;
		const excess = Math.max(0, event.tMs - start - maximumPreRollMs);
		if (excess > 0) cuts.push({ start, excess });
	}
	cuts.sort((left, right) => left.start - right.start);
	const transform = (tMs: number): number => {
		let shifted = tMs;
		for (const cut of cuts) {
			if (tMs < cut.start) break;
			shifted -= Math.min(cut.excess, Math.max(0, tMs - cut.start));
		}
		return Math.max(0, Math.round(shifted));
	};
	return {
		frames: frames.map((frame, seq) => ({
			...frame,
			seq,
			tMs: transform(frame.tMs),
		})),
		events: events.map((event, seq) => ({
			...event,
			seq,
			tMs: transform(event.tMs),
		})),
	};
}
