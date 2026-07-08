import { ArenaPixels } from "../arenas/arena";
import {
	buildCircularObstacleDescriptor,
	hitsCircularObstacle,
	resolveObstaclePosition,
	resolveObstacleRadius,
	type ObstacleDescriptor,
} from "./obstacle-descriptor";

export type TimedTargetKind = "daruma" | "crate" | "drum";

export interface TimedTarget {
	readonly id: number;
	readonly kind: TimedTargetKind;
	readonly breakable: boolean;
	nx: number;
	ny: number;
	ageMs: number;
	lifetimeMs: number;
	radiusSrc: number;
	points: number;
}

export interface TimedTargetObstacleRendering {
	readonly kind: TimedTargetKind;
	readonly breakable: boolean;
	readonly ageMs: number;
	readonly lifetimeMs: number;
}

export type TimedTargetObstacleDescriptor = ObstacleDescriptor<
	"timed-target",
	TimedTargetObstacleRendering,
	TimedTarget
>;

export interface TimedTargetSpot {
	readonly nx: number;
	readonly ny: number;
}

const MAX_RADIUS = 0.78;
const CLEAR_OF_CENTRE = 0.24;
const MIN_TARGET_SEPARATION = 0.15;
const SPAWN_ATTEMPTS = 32;

export function stepTimedTargets(
	targets: TimedTarget[],
	deltaMs: number,
): TimedTarget[] {
	for (const target of targets) {
		target.ageMs += deltaMs;
	}

	return targets.filter((target) => target.ageMs < target.lifetimeMs);
}

export function randomTimedTargetSpot(
	existing: readonly TimedTarget[],
): TimedTargetSpot | null {
	for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
		const radius = Math.sqrt(Math.random()) * MAX_RADIUS;
		const theta = Math.random() * Math.PI * 2;
		const nx = Math.cos(theta) * radius;
		const ny = Math.sin(theta) * radius;

		if (Math.hypot(nx, ny) < CLEAR_OF_CENTRE) continue;
		if (
			existing.some(
				(target) =>
					Math.hypot(target.nx - nx, target.ny - ny) <
					MIN_TARGET_SEPARATION,
			)
		)
			continue;

		return { nx, ny };
	}

	return null;
}

export function timedTargetPosition(
	target: TimedTarget,
	arena: ArenaPixels,
): { x: number; y: number } {
	return resolveObstaclePosition(timedTargetObstacleDescriptor(target), arena);
}

export function timedTargetRadius(
	target: TimedTarget,
	arena: ArenaPixels,
): number {
	return resolveObstacleRadius(timedTargetObstacleDescriptor(target), arena) ?? 0;
}

export function hitsTimedTarget(
	target: TimedTarget,
	arena: ArenaPixels,
	cx: number,
	cy: number,
	cr: number,
): boolean {
	return hitsCircularObstacle(
		timedTargetObstacleDescriptor(target),
		arena,
		cx,
		cy,
		cr,
	);
}

export function timedTargetObstacleDescriptor(
	target: TimedTarget,
): TimedTargetObstacleDescriptor {
	return buildCircularObstacleDescriptor({
		id: target.id,
		type: "timed-target",
		position: { mode: "normalised", x: target.nx, y: target.ny },
		radius: target.radiusSrc,
		radiusUnit: "source",
		scoreValue: target.points,
		collision: {
			blocks: !target.breakable,
			bounces: !target.breakable,
			breaks: target.breakable,
			awardsPoints: target.breakable,
		},
		rendering: {
			kind: target.kind,
			breakable: target.breakable,
			ageMs: target.ageMs,
			lifetimeMs: target.lifetimeMs,
		},
	});
}

export function targetHitAccuracy(
	target: TimedTarget,
	arena: ArenaPixels,
	cx: number,
	cy: number,
): number {
	const pos = timedTargetPosition(target, arena);
	const radius = Math.max(1, timedTargetRadius(target, arena));
	return Math.hypot(pos.x - cx, pos.y - cy) / radius;
}
