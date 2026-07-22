import { REPLAY_KEYFRAME_INTERVAL_MS, type ReplayFrameV2 } from "./contracts";

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function withoutRepeatedTrails(
	snapshot: Record<string, unknown>,
): Record<string, unknown> {
	const normalised = clone(snapshot);
	for (const collection of ["entities", "balls", "objects"] as const) {
		const values = normalised[collection];
		if (!Array.isArray(values)) continue;
		normalised[collection] = values.map((value) => {
			if (!value || typeof value !== "object") return value;
			const entity = { ...(value as Record<string, unknown>) };
			delete entity.trail;
			return entity;
		});
	}
	return normalised;
}

function roundOf(snapshot: Record<string, unknown>): number {
	const value =
		snapshot.roundNumber ?? snapshot.currentEnd ?? snapshot.turnNumber;
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: 0;
}

function stateOf(snapshot: Record<string, unknown>): ReplayFrameV2["state"] {
	const phase = snapshot.phase;
	return phase === "pending" ||
		phase === "active" ||
		phase === "finished" ||
		phase === "abandoned"
		? phase
		: "active";
}

export class ReplayEncoder {
	private previous: Record<string, unknown> | null = null;
	private lastKeyframeMs = -Infinity;

	reset(): void {
		this.previous = null;
		this.lastKeyframeMs = -Infinity;
	}

	encode(
		seq: number,
		tMs: number,
		snapshot: Record<string, unknown>,
		forceKeyframe = false,
	): ReplayFrameV2 | null {
		snapshot = withoutRepeatedTrails(snapshot);
		const round = roundOf(snapshot);
		const keyframe =
			forceKeyframe ||
			this.previous === null ||
			tMs - this.lastKeyframeMs >= REPLAY_KEYFRAME_INTERVAL_MS ||
			round !== roundOf(this.previous);
		const changes: Record<string, unknown> = {};
		const removals: string[] = [];

		if (keyframe) {
			Object.assign(changes, clone(snapshot));
		} else {
			for (const [key, value] of Object.entries(snapshot)) {
				if (
					JSON.stringify(this.previous?.[key]) !==
					JSON.stringify(value)
				)
					changes[key] = clone(value);
			}
			for (const key of Object.keys(this.previous ?? {})) {
				if (!(key in snapshot)) removals.push(key);
			}
		}
		this.previous = clone(snapshot);
		if (keyframe) this.lastKeyframeMs = tMs;
		if (
			!keyframe &&
			Object.keys(changes).length === 0 &&
			removals.length === 0
		)
			return null;
		return {
			seq,
			tMs: Math.max(0, Math.round(tMs)),
			round,
			state: stateOf(snapshot),
			type: keyframe ? "keyframe" : "delta",
			changes,
			removals,
		};
	}
}

interface ReplayTrailObservation {
	x: number;
	y: number;
	stopped: boolean;
}

interface ReplayReconstructionState {
	snapshot: Record<string, unknown>;
	trails: Map<string, Array<{ x: number; y: number }>>;
	observations: Map<string, ReplayTrailObservation>;
}

const reconstructionCheckpoints = new WeakMap<
	ReplayFrameV2[],
	Map<number, ReplayReconstructionState>
>();

function cloneReconstructionState(
	state: ReplayReconstructionState,
): ReplayReconstructionState {
	const trails = new Map<string, Array<{ x: number; y: number }>>();
	for (const [key, points] of state.trails) trails.set(key, clone(points));
	const observations = new Map<string, ReplayTrailObservation>();
	for (const [key, observation] of state.observations)
		observations.set(key, { ...observation });
	return {
		snapshot: clone(state.snapshot),
		trails,
		observations,
	};
}

function applyReplayFrame(
	state: ReplayReconstructionState,
	frame: ReplayFrameV2,
): void {
	const { snapshot, trails, observations } = state;
	if (frame.type === "keyframe") {
		for (const key of Object.keys(snapshot)) delete snapshot[key];
	}
	for (const key of frame.removals) delete snapshot[key];
	Object.assign(snapshot, clone(frame.changes));
	const presentTrailKeys = new Set<string>();
	for (const collection of ["entities", "balls", "objects"] as const) {
		const values = snapshot[collection];
		if (!Array.isArray(values)) continue;
		for (const value of values) {
			if (!value || typeof value !== "object") continue;
			const entity = value as Record<string, unknown>;
			if (
				(typeof entity.id !== "string" &&
					typeof entity.id !== "number") ||
				typeof entity.x !== "number" ||
				typeof entity.y !== "number"
			)
				continue;
			const key = `${collection}:${String(entity.id)}`;
			presentTrailKeys.add(key);
			const observation = observations.get(key);
			let points = trails.get(key) ?? [];
			if (
				observation?.stopped &&
				entity.stopped === true &&
				(observation.x !== entity.x || observation.y !== entity.y)
			) {
				points = [{ x: entity.x, y: entity.y }];
				trails.set(key, points);
			}
			const previous = points[points.length - 1];
			if (
				!previous ||
				(entity.stopped !== true &&
					(previous.x !== entity.x || previous.y !== entity.y))
			) {
				points.push({ x: entity.x, y: entity.y });
				if (points.length > 80) points.splice(0, points.length - 80);
				trails.set(key, points);
			}
			observations.set(key, {
				x: entity.x,
				y: entity.y,
				stopped: entity.stopped === true,
			});
		}
	}
	for (const key of trails.keys()) {
		if (!presentTrailKeys.has(key)) {
			trails.delete(key);
			observations.delete(key);
		}
	}
}

function findKeyframeIndex(frames: ReplayFrameV2[], index: number): number {
	let cursor = index;
	while (cursor > 0 && frames[cursor]?.type !== "keyframe") cursor -= 1;
	return cursor;
}

function reconstructionCheckpoint(
	frames: ReplayFrameV2[],
	keyframeIndex: number,
): ReplayReconstructionState {
	let checkpoints = reconstructionCheckpoints.get(frames);
	if (!checkpoints) {
		checkpoints = new Map();
		reconstructionCheckpoints.set(frames, checkpoints);
	}
	const cached = checkpoints.get(keyframeIndex);
	if (cached) return cloneReconstructionState(cached);

	let state: ReplayReconstructionState;
	let startIndex = 0;
	if (keyframeIndex > 0) {
		const previousKeyframe = findKeyframeIndex(frames, keyframeIndex - 1);
		state = reconstructionCheckpoint(frames, previousKeyframe);
		startIndex = previousKeyframe + 1;
	} else {
		state = { snapshot: {}, trails: new Map(), observations: new Map() };
	}
	for (let cursor = startIndex; cursor <= keyframeIndex; cursor += 1) {
		const frame = frames[cursor];
		if (frame) applyReplayFrame(state, frame);
	}
	checkpoints.set(keyframeIndex, cloneReconstructionState(state));
	return state;
}

export function reconstructReplayFrame(
	frames: ReplayFrameV2[],
	index: number,
): Record<string, unknown> {
	if (frames.length === 0) return {};
	const safeIndex = Math.min(Math.max(0, index), frames.length - 1);
	const keyframeIndex = findKeyframeIndex(frames, safeIndex);
	const state = reconstructionCheckpoint(frames, keyframeIndex);
	for (let cursor = keyframeIndex + 1; cursor <= safeIndex; cursor += 1) {
		const frame = frames[cursor];
		if (frame) applyReplayFrame(state, frame);
	}
	for (const collection of ["entities", "balls", "objects"] as const) {
		const values = state.snapshot[collection];
		if (!Array.isArray(values)) continue;
		state.snapshot[collection] = values.map((value) => {
			if (!value || typeof value !== "object") return value;
			const entity = value as Record<string, unknown>;
			const key = `${collection}:${String(entity.id)}`;
			return { ...entity, trail: clone(state.trails.get(key) ?? []) };
		});
	}
	return state.snapshot;
}
