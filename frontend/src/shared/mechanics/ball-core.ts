/**
 * mechanics/ball-core.ts — shared shell-ball state and physics without Phaser.
 */

import type { ArenaPixels } from "../arenas/arena";

/** Per-frame friction multiplier at 60 fps. Exported so frictionOverride corrections can reference it. */
export const BALL_FRICTION_BASE = 0.985;
const BOUNCE_DAMP = 0.8;
const MIN_SPEED_SRC = 6;

/** Ball radius in arena source px — scaled by ArenaPixels.scale at render time. */
export const BALL_SRC_R = 52;

export interface BallState {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
}

export function isBallMoving(b: BallState): boolean {
	return Math.abs(b.vx) > 0.1 || Math.abs(b.vy) > 0.1;
}

export function stepBall(
	b: BallState,
	deltaMs: number,
	a: ArenaPixels,
): boolean {
	if (!isBallMoving(b)) return false;

	const dt = deltaMs / 1000;
	b.x += b.vx * dt;
	b.y += b.vy * dt;

	const erx = Math.max(1, a.rx - b.r);
	const ery = Math.max(1, a.ry - b.r);

	const ex = (b.x - a.cx) / erx;
	const ey = (b.y - a.cy) / ery;
	const distSq = ex * ex + ey * ey;

	if (distSq >= 1) {
		const inv = 1 / Math.sqrt(distSq);
		b.x = a.cx + (b.x - a.cx) * inv;
		b.y = a.cy + (b.y - a.cy) * inv;

		const nRawX = (b.x - a.cx) / (erx * erx);
		const nRawY = (b.y - a.cy) / (ery * ery);
		const nLen = Math.sqrt(nRawX * nRawX + nRawY * nRawY);
		const nx = nRawX / nLen;
		const ny = nRawY / nLen;

		const dot = b.vx * nx + b.vy * ny;
		b.vx = (b.vx - 2 * dot * nx) * BOUNCE_DAMP;
		b.vy = (b.vy - 2 * dot * ny) * BOUNCE_DAMP;
	}

	const f = Math.pow(BALL_FRICTION_BASE, deltaMs / 16.67);
	b.vx *= f;
	b.vy *= f;

	if (Math.sqrt(b.vx * b.vx + b.vy * b.vy) < MIN_SPEED_SRC * a.scale) {
		b.vx = 0;
		b.vy = 0;
		return false;
	}
	return true;
}

export function resolveBallCollision(a: BallState, b: BallState): void {
	if (!isBallMoving(a) && !isBallMoving(b)) return;

	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const dist = Math.max(0.001, Math.hypot(dx, dy));
	const minDist = a.r + b.r;
	if (dist >= minDist) return;

	const extA = a as BallState & { ghostUsed?: boolean };
	const extB = b as BallState & { ghostUsed?: boolean };
	if (extA.ghostUsed === false) {
		extA.ghostUsed = true;
		return;
	}
	if (extB.ghostUsed === false) {
		extB.ghostUsed = true;
		return;
	}

	const nx = dx / dist;
	const ny = dy / dist;
	const overlap = (minDist - dist) / 2;
	a.x -= nx * overlap;
	a.y -= ny * overlap;
	b.x += nx * overlap;
	b.y += ny * overlap;

	const rvx = b.vx - a.vx;
	const rvy = b.vy - a.vy;
	const speed = rvx * nx + rvy * ny;
	if (speed > 0) return;
	a.vx += speed * nx;
	a.vy += speed * ny;
	b.vx -= speed * nx;
	b.vy -= speed * ny;
}
