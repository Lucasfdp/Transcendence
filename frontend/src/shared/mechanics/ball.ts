/**
 * mechanics/ball.ts — shared shell-ball state, physics step, and rendering.
 *
 * The ball moves in a straight line, reflects off the arena's ellipse
 * boundary (using the ellipse gradient as the surface normal), and
 * decelerates with frame-rate-independent friction until it stops.
 */

import Phaser from "phaser";
import { ArenaPixels } from "../arenas/arena";

// ── Physics constants ─────────────────────────────────────────────────────────

/** Per-frame friction multiplier at 60 fps. Exported so frictionOverride corrections can reference it. */
export const BALL_FRICTION_BASE = 0.985;
const BOUNCE_DAMP = 0.8; // speed retained per wall bounce
const MIN_SPEED_SRC = 6; // source px/s — ball snaps to rest below this
// (scaled by arena.scale so it's fair at any size)

/** Ball radius in arena source px — scaled by ArenaPixels.scale at render time. */
export const BALL_SRC_R = 26;

// ── State ─────────────────────────────────────────────────────────────────────

export interface BallState {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number; // current radius in canvas px
}

export function isBallMoving(b: BallState): boolean {
	return Math.abs(b.vx) > 0.1 || Math.abs(b.vy) > 0.1;
}

// ── Physics ───────────────────────────────────────────────────────────────────

/**
 * Advance the ball one frame: integrate, bounce off the arena ellipse,
 * apply friction. Returns true if the ball is still moving afterwards.
 */
export function stepBall(
	b: BallState,
	deltaMs: number,
	a: ArenaPixels,
): boolean {
	if (!isBallMoving(b)) return false;

	const dt = deltaMs / 1000;
	b.x += b.vx * dt;
	b.y += b.vy * dt;

	// The ball is a circle of radius b.r, so its centre is confined to an inner
	// ellipse shrunk by the radius — the ball's *edge* (not its centre) touches
	// the wall. Clamp the radius so the inner ellipse never collapses on a tiny
	// arena.
	const erx = Math.max(1, a.rx - b.r);
	const ery = Math.max(1, a.ry - b.r);

	// Outside the inner ellipse?  (x-cx)²/erx² + (y-cy)²/ery² ≥ 1
	const ex = (b.x - a.cx) / erx;
	const ey = (b.y - a.cy) / ery;
	const distSq = ex * ex + ey * ey;

	if (distSq >= 1) {
		// Project the ball centre back onto the inner ellipse surface
		const inv = 1 / Math.sqrt(distSq);
		b.x = a.cx + (b.x - a.cx) * inv;
		b.y = a.cy + (b.y - a.cy) * inv;

		// Outward unit normal = normalised gradient of the inner ellipse equation
		const nRawX = (b.x - a.cx) / (erx * erx);
		const nRawY = (b.y - a.cy) / (ery * ery);
		const nLen = Math.sqrt(nRawX * nRawX + nRawY * nRawY);
		const nx = nRawX / nLen;
		const ny = nRawY / nLen;

		// Reflect velocity, then dampen
		const dot = b.vx * nx + b.vy * ny;
		b.vx = (b.vx - 2 * dot * nx) * BOUNCE_DAMP;
		b.vy = (b.vy - 2 * dot * ny) * BOUNCE_DAMP;
	}

	// Frame-rate-independent friction
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

// ── Rendering ─────────────────────────────────────────────────────────────────

/** Draw the turtle-shell ball at its current position. Clears `g` first by default. */
export function drawShellBall(
	g: Phaser.GameObjects.Graphics,
	b: BallState,
	clear = true,
): void {
	const { x, y, r } = b;
	if (clear) g.clear();

	// Drop shadow
	g.fillStyle(0x000000, 0.22);
	g.fillEllipse(x + r * 0.3, y + r * 0.5, r * 2.4, r * 0.9);

	// Shell body
	g.fillStyle(0x2a7fd4, 1);
	g.fillCircle(x, y, r);

	// Dark shell-plate segments
	g.fillStyle(0x1a5fa8, 1);
	g.fillCircle(x + r * 0.25, y - r * 0.12, r * 0.38);
	g.fillCircle(x - r * 0.22, y + r * 0.28, r * 0.3);
	g.fillCircle(x + r * 0.08, y + r * 0.52, r * 0.22);

	// Specular highlight
	g.fillStyle(0xffffff, 0.55);
	g.fillCircle(x - r * 0.28, y - r * 0.3, r * 0.22);
}
