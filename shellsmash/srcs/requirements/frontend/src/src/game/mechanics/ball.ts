/**
 * mechanics/ball.ts — shared shell-ball state, physics step, and rendering.
 *
 * The ball moves in a straight line, reflects off the arena's ellipse
 * boundary (using the ellipse gradient as the surface normal), and
 * decelerates with frame-rate-independent friction until it stops.
 */

import Phaser from 'phaser';
import { ArenaPixels } from '../arenas/arena';

// ── Physics constants ─────────────────────────────────────────────────────────

const FRICTION_BASE = 0.985;  // per-frame multiplier at 60 fps (compensated below)
const BOUNCE_DAMP   = 0.80;   // speed retained per wall bounce
const MIN_SPEED     = 6;      // px/s — ball snaps to rest below this

/** Ball radius in arena source px — scaled by ArenaPixels.scale at render time. */
export const BALL_SRC_R = 26;

// ── State ─────────────────────────────────────────────────────────────────────

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;   // current radius in canvas px
}

export function isBallMoving(b: BallState): boolean {
  return Math.abs(b.vx) > 0.1 || Math.abs(b.vy) > 0.1;
}

// ── Physics ───────────────────────────────────────────────────────────────────

/**
 * Advance the ball one frame: integrate, bounce off the arena ellipse,
 * apply friction. Returns true if the ball is still moving afterwards.
 */
export function stepBall(b: BallState, deltaMs: number, a: ArenaPixels): boolean {
  if (!isBallMoving(b)) return false;

  const dt = deltaMs / 1000;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // Outside the ellipse?  (x-cx)²/rx² + (y-cy)²/ry² ≥ 1
  const ex = (b.x - a.cx) / a.rx;
  const ey = (b.y - a.cy) / a.ry;
  const distSq = ex * ex + ey * ey;

  if (distSq >= 1) {
    // Project the ball back onto the ellipse surface
    const inv = 1 / Math.sqrt(distSq);
    b.x = a.cx + (b.x - a.cx) * inv;
    b.y = a.cy + (b.y - a.cy) * inv;

    // Outward unit normal = normalised gradient of the ellipse equation
    const nRawX = (b.x - a.cx) / (a.rx * a.rx);
    const nRawY = (b.y - a.cy) / (a.ry * a.ry);
    const nLen  = Math.sqrt(nRawX * nRawX + nRawY * nRawY);
    const nx    = nRawX / nLen;
    const ny    = nRawY / nLen;

    // Reflect velocity, then dampen
    const dot = b.vx * nx + b.vy * ny;
    b.vx = (b.vx - 2 * dot * nx) * BOUNCE_DAMP;
    b.vy = (b.vy - 2 * dot * ny) * BOUNCE_DAMP;
  }

  // Frame-rate-independent friction
  const f = Math.pow(FRICTION_BASE, deltaMs / 16.67);
  b.vx *= f;
  b.vy *= f;

  if (Math.sqrt(b.vx * b.vx + b.vy * b.vy) < MIN_SPEED) {
    b.vx = 0;
    b.vy = 0;
    return false;
  }
  return true;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/** Draw the turtle-shell ball at its current position. Clears `g` first. */
export function drawShellBall(g: Phaser.GameObjects.Graphics, b: BallState): void {
  const { x, y, r } = b;
  g.clear();

  // Drop shadow
  g.fillStyle(0x000000, 0.22);
  g.fillEllipse(x + r * 0.3, y + r * 0.5, r * 2.4, r * 0.9);

  // Shell body
  g.fillStyle(0x2a7fd4, 1);
  g.fillCircle(x, y, r);

  // Dark shell-plate segments
  g.fillStyle(0x1a5fa8, 1);
  g.fillCircle(x + r * 0.25, y - r * 0.12, r * 0.38);
  g.fillCircle(x - r * 0.22, y + r * 0.28, r * 0.30);
  g.fillCircle(x + r * 0.08, y + r * 0.52, r * 0.22);

  // Specular highlight
  g.fillStyle(0xffffff, 0.55);
  g.fillCircle(x - r * 0.28, y - r * 0.30, r * 0.22);
}
