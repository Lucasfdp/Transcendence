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

export function reconstructReplayFrame(
	frames: ReplayFrameV2[],
	index: number,
): Record<string, unknown> {
	if (frames.length === 0) return {};
	const safeIndex = Math.min(Math.max(0, index), frames.length - 1);
	let keyframeIndex = safeIndex;
	while (keyframeIndex > 0 && frames[keyframeIndex]?.type !== "keyframe")
		keyframeIndex -= 1;
	const snapshot: Record<string, unknown> = {};
	const trails = new Map<string, Array<{ x: number; y: number }>>();
	for (let cursor = keyframeIndex; cursor <= safeIndex; cursor += 1) {
		const frame = frames[cursor];
		if (!frame) continue;
		if (frame.type === "keyframe") {
			for (const key of Object.keys(snapshot)) delete snapshot[key];
		}
		for (const key of frame.removals) delete snapshot[key];
		Object.assign(snapshot, clone(frame.changes));
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
				const points = trails.get(key) ?? [];
				const previous = points[points.length - 1];
				if (
					!previous ||
					previous.x !== entity.x ||
					previous.y !== entity.y
				) {
					points.push({ x: entity.x, y: entity.y });
					if (points.length > 24) points.shift();
					trails.set(key, points);
				}
			}
		}
	}
	for (const collection of ["entities", "balls", "objects"] as const) {
		const values = snapshot[collection];
		if (!Array.isArray(values)) continue;
		snapshot[collection] = values.map((value) => {
			if (!value || typeof value !== "object") return value;
			const entity = value as Record<string, unknown>;
			const key = `${collection}:${String(entity.id)}`;
			return { ...entity, trail: clone(trails.get(key) ?? []) };
		});
	}
	return snapshot;
}
