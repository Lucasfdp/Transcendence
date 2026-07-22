import type { ArenaPixels } from "../arenas/arena";
import {
	BALL_SRC_R,
	BALL_FRICTION_BASE,
} from "./ball";
import {
	type PowerType,
	FRICTION_SLICK,
	HEAVY_SPEED_FACTOR,
	GIANT_RADIUS_FACTOR,
	TINY_RADIUS_FACTOR,
	ROCKET_SPEED_FACTOR,
} from "./power-system";

const PROJECTILE_BOUNCE_DAMP = 0.8;
const PROJECTILE_MIN_SPEED_SRC = 6;
const PROJECTILE_SPIN_ANGLE = Math.PI / 18;
const FIXED_STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 100;

export interface ReplayProjectileState {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
	power?: PowerType;
	frictionOverride?: number;
	stopped?: boolean;
}

export interface ReplayTrailPoint {
	x: number;
	y: number;
}

export interface SimulatedReplayObject<TState> {
	state: TState;
	trail: ReplayTrailPoint[];
}

export function createReplayProjectileState(
	arena: ArenaPixels,
	x: number,
	y: number,
	vx: number,
	vy: number,
	power: PowerType | undefined,
): ReplayProjectileState {
	const state: ReplayProjectileState = {
		x,
		y,
		vx,
		vy,
		r: BALL_SRC_R * arena.scale,
		power,
	};
	applyReplayProjectilePower(state, power);
	return state;
}

export function applyReplayProjectilePower(
	state: ReplayProjectileState,
	power: PowerType | undefined,
): void {
	state.power = power;
	state.frictionOverride = undefined;

	switch (power) {
		case "heavy":
			state.vx *= HEAVY_SPEED_FACTOR;
			state.vy *= HEAVY_SPEED_FACTOR;
			break;
		case "giant":
			state.r *= GIANT_RADIUS_FACTOR;
			break;
		case "tiny":
			state.r *= TINY_RADIUS_FACTOR;
			state.vx *= 1.35;
			state.vy *= 1.35;
			break;
		case "rocket":
			state.vx *= ROCKET_SPEED_FACTOR;
			state.vy *= ROCKET_SPEED_FACTOR;
			break;
		case "slick":
			state.frictionOverride = FRICTION_SLICK;
			break;
		case "bouncer":
		case "spinning":
			state.frictionOverride = 0.984;
			break;
		default:
			break;
	}

	if (power === "spinning") {
		const angle = Math.atan2(state.vy, state.vx) + PROJECTILE_SPIN_ANGLE;
		const speed = Math.hypot(state.vx, state.vy);
		state.vx = Math.cos(angle) * speed;
		state.vy = Math.sin(angle) * speed;
	}
}

export function stepReplayProjectile(
	state: ReplayProjectileState,
	deltaMs: number,
	arena: ArenaPixels,
): boolean {
	if (!Number.isFinite(state.vx) || !Number.isFinite(state.vy)) {
		state.vx = 0;
		state.vy = 0;
		state.stopped = true;
		return false;
	}
	if (Math.hypot(state.vx, state.vy) <= 0.1) {
		state.vx = 0;
		state.vy = 0;
		state.stopped = true;
		return false;
	}

	const dt = deltaMs / 1000;
	state.x += state.vx * dt;
	state.y += state.vy * dt;

	const erx = Math.max(1, arena.rx - state.r);
	const ery = Math.max(1, arena.ry - state.r);
	const ex = (state.x - arena.cx) / erx;
	const ey = (state.y - arena.cy) / ery;
	const distSq = ex * ex + ey * ey;

	if (distSq >= 1) {
		const inv = 1 / Math.sqrt(distSq);
		state.x = arena.cx + (state.x - arena.cx) * inv;
		state.y = arena.cy + (state.y - arena.cy) * inv;

		const nRawX = (state.x - arena.cx) / (erx * erx);
		const nRawY = (state.y - arena.cy) / (ery * ery);
		const nLen = Math.hypot(nRawX, nRawY) || 1;
		const nx = nRawX / nLen;
		const ny = nRawY / nLen;
		const dot = state.vx * nx + state.vy * ny;
		const bounceDamp =
			state.power === "bouncer" ? 1.0 : PROJECTILE_BOUNCE_DAMP;
		state.vx = (state.vx - 2 * dot * nx) * bounceDamp;
		state.vy = (state.vy - 2 * dot * ny) * bounceDamp;
	}

	const friction = state.frictionOverride ?? BALL_FRICTION_BASE;
	const factor = Math.pow(friction, deltaMs / 16.67);
	state.vx *= factor;
	state.vy *= factor;

	if (
		Math.hypot(state.vx, state.vy) <
		PROJECTILE_MIN_SPEED_SRC * arena.scale
	) {
		state.vx = 0;
		state.vy = 0;
		state.stopped = true;
		return false;
	}

	state.stopped = false;
	return true;
}

export function simulateReplayProjectile(
	initial: ReplayProjectileState,
	totalMs: number,
	arena: ArenaPixels,
	maxTrailPoints = 28,
): SimulatedReplayObject<ReplayProjectileState> {
	const state: ReplayProjectileState = { ...initial };
	const trail: ReplayTrailPoint[] = [{ x: state.x, y: state.y }];

	runFixedStepSimulation(totalMs, (stepMs) => {
		if (!stepReplayProjectile(state, stepMs, arena)) return false;
		pushReplayTrailPoint(trail, state.x, state.y, maxTrailPoints);
		return true;
	});

	return { state, trail };
}

export function lerpNumber(from: number, to: number, progress: number): number {
	return from + (to - from) * progress;
}

export function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function runFixedStepSimulation(
	totalMs: number,
	step: (stepMs: number) => boolean,
): void {
	let remaining = Math.max(0, Math.min(totalMs, 60_000));
	while (remaining > 0) {
		const stepMs = Math.min(
			FIXED_STEP_MS,
			Math.min(MAX_FRAME_MS, remaining),
		);
		remaining -= stepMs;
		if (!step(stepMs)) break;
	}
}

function pushReplayTrailPoint(
	trail: ReplayTrailPoint[],
	x: number,
	y: number,
	limit: number,
): void {
	const last = trail[trail.length - 1];
	if (!last || Math.hypot(last.x - x, last.y - y) >= 4) trail.push({ x, y });
	if (trail.length > limit) trail.splice(0, trail.length - limit);
}
