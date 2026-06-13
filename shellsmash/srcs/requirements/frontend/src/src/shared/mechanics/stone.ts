/**
 * game/mechanics/stone.ts — stone state, physics, collision, and rendering.
 *
 * Generalises ball.ts for a rectangular ice sheet. Physics are tuned for
 * a curling-like feel: very low friction, gentle natural curl drift, elastic
 * stone-stone collisions.
 *
 * This file has zero imports from any specific minigame directory.
 */

import Phaser from 'phaser';
import type { RectArenaPixels } from './rect-arena';
import { PowerType, HEAVY_MASS_RATIO, FRICTION_SLICK } from './power-system';

// ── Physics constants (source px, scaled by arena.scale at call sites) ────────

/** Stone radius at source (1920×1080) resolution. */
export const STONE_SRC_R = 28;

/** Per-frame friction multiplier at 60 fps.
 *  0.990 → stone starting at 820 px/s travels ~1360 source px before stopping (~4 s).
 *  Previously 0.9982 which caused >30 s slides. */
export const FRICTION_ICE = 0.990;

/** Speed fraction retained on side-wall bounce. */
export const BOUNCE_DAMP = 0.55;

/** Speed fraction retained in stone-on-stone elastic collision. */
export const STONE_BOUNCE_DAMP = 0.92;

/** Source px/s below which the stone snaps to rest. */
export const MIN_SPEED_SRC = 8;

/** Default lateral curl drift — 0 means straight, only SPINNING overrides this. */
export const DEFAULT_CURL_BIAS = 0;

/**
 * Scales how strongly curlBias bends the trajectory.
 * Units: radians/second per unit of curlBias.
 * Previous value 0.018 was imperceptibly small; 0.5 gives a visible arc.
 */
export const CURL_STRENGTH = 0.5;

// ── State ──────────────────────────────────────────────────────────────────────

export interface StoneState {
  id:        number;
  teamId:    0 | 1;
  x:         number;
  y:         number;
  vx:        number;
  vy:        number;
  r:         number;     // current radius in canvas px
  power:     PowerType;
  stopped:   boolean;
  curlBias:  number;     // >0 curves right, <0 curves left
  // ── Power extension flags (set by power-system) ───────────────────────────
  hasSplit?:         boolean;
  splitterPending?:  boolean;
  ghostUsed?:        boolean;
  frozen?:           boolean;
  frictionOverride?: number;  // SLICK sets this
}

// ── Physics ───────────────────────────────────────────────────────────────────

/**
 * Advance one stone one frame.
 * Applies curl drift, integrates position, bounces off side-walls,
 * and applies frame-rate-independent friction.
 * Returns true while the stone is still moving.
 */
export function stepStone(
  s: StoneState,
  deltaMs: number,
  a: RectArenaPixels,
): boolean {
  if (s.frozen) {
    // Frozen stones never move — keep state consistent regardless of what
    // other code (e.g. resolveStoneCollision) may have done to the flags.
    s.stopped = true;
    s.vx = 0;
    s.vy = 0;
    return false;
  }
  if (s.stopped) return false;

  const dt   = deltaMs / 1000;
  const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);

  // ── Curl drift — add a small perpendicular velocity component ────────────
  // The perpendicular unit vector is (-vy/speed, vx/speed) — rotate 90° CCW.
  // curlBias > 0 curves right (from the stone's perspective), < 0 curves left.
  if (speed > 0.001) {
    const perp_x = -s.vy / speed; // rightward perpendicular
    const perp_y =  s.vx / speed;
    s.vx += perp_x * s.curlBias * CURL_STRENGTH * speed * dt;
    s.vy += perp_y * s.curlBias * CURL_STRENGTH * speed * dt;
  }

  // ── Integrate ─────────────────────────────────────────────────────────────
  s.x += s.vx * dt;
  s.y += s.vy * dt;

  // ── Boundary-wall bounce (orientation-dependent) ──────────────────────────
  // Horizontal orientation: stone travels left→right, walls are top & bottom.
  // Vertical orientation:   stone travels top→bottom, walls are left & right.
  const bounceDamp = s.power === PowerType.BOUNCER ? 1.0 : BOUNCE_DAMP;
  if (a.orientation === 'horizontal') {
    // All four walls are live — no out-of-bounds in horizontal mode.
    const topWall    = a.sheetY + s.r;
    const bottomWall = a.sheetY + a.sheetH - s.r;
    const leftWall   = a.sheetX + s.r;
    const rightWall  = a.sheetX + a.sheetW - s.r;
    if (s.y < topWall)         { s.y  = topWall;    s.vy = -s.vy * bounceDamp; }
    else if (s.y > bottomWall) { s.y  = bottomWall; s.vy = -s.vy * bounceDamp; }
    if (s.x < leftWall)        { s.x  = leftWall;   s.vx = -s.vx * bounceDamp; }
    else if (s.x > rightWall)  { s.x  = rightWall;  s.vx = -s.vx * bounceDamp; }
  } else {
    const leftWall  = a.sheetX + s.r;
    const rightWall = a.sheetX + a.sheetW - s.r;
    if (s.x < leftWall) {
      s.x  = leftWall;
      s.vx = -s.vx * bounceDamp;
    } else if (s.x > rightWall) {
      s.x  = rightWall;
      s.vx = -s.vx * bounceDamp;
    }
  }

  // ── Frame-rate-independent friction ───────────────────────────────────────
  const friction = s.frictionOverride ?? FRICTION_ICE;
  const f = Math.pow(friction, deltaMs / 16.67);
  s.vx *= f;
  s.vy *= f;

  // ── Rest check ────────────────────────────────────────────────────────────
  const finalSpeed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  if (finalSpeed < MIN_SPEED_SRC * a.scale) {
    s.vx     = 0;
    s.vy     = 0;
    s.stopped = true;
    return false;
  }

  return true;
}

/**
 * Elastic circle-circle collision between two stones.
 * Uses equal-mass model unless either stone is HEAVY (scaled by HEAVY_MASS_RATIO).
 * Call after stepStone for every pair — O(n²) is fine for ≤ 16 stones.
 */
export function resolveStoneCollision(a: StoneState, b: StoneState): void {
  if (a.stopped && b.stopped) return;

  // Ghost: skip resolution on first hit
  if (a.power === PowerType.GHOST && !a.ghostUsed) return;
  if (b.power === PowerType.GHOST && !b.ghostUsed) return;

  const dx   = b.x - a.x;
  const dy   = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const minD = a.r + b.r;

  if (dist >= minD || dist < 0.001) return;

  // Push apart so they don't overlap.
  // Frozen stones are immovable — push the full overlap onto the moving stone.
  const overlap = minD - dist;
  const nx = dx / dist;
  const ny = dy / dist;

  const aShare = a.frozen ? 0.0 : (b.frozen ? 1.0 : 0.5);
  const bShare = b.frozen ? 0.0 : (a.frozen ? 1.0 : 0.5);
  a.x -= nx * overlap * aShare;
  a.y -= ny * overlap * aShare;
  b.x += nx * overlap * bShare;
  b.y += ny * overlap * bShare;

  // Velocity exchange along collision normal
  const dvx    = b.vx - a.vx;
  const dvy    = b.vy - a.vy;
  const dvDot  = dvx * nx + dvy * ny;
  if (dvDot > 0) return; // already separating

  // Frozen stones act as walls (infinite mass) — full reflection on the mover.
  if (a.frozen || b.frozen) {
    const mover = a.frozen ? b : a;
    const dot   = mover.vx * nx + mover.vy * ny;
    mover.vx = (mover.vx - 2 * dot * nx) * STONE_BOUNCE_DAMP;
    mover.vy = (mover.vy - 2 * dot * ny) * STONE_BOUNCE_DAMP;
    mover.stopped = false;
    return;
  }

  const massA  = a.power === PowerType.HEAVY ? HEAVY_MASS_RATIO : 1;
  const massB  = b.power === PowerType.HEAVY ? HEAVY_MASS_RATIO : 1;
  const impulse = (2 * dvDot) / (massA + massB) * STONE_BOUNCE_DAMP;

  a.vx  += impulse * massB * nx;
  a.vy  += impulse * massB * ny;
  b.vx  -= impulse * massA * nx;
  b.vy  -= impulse * massA * ny;

  a.stopped = false;
  b.stopped = false;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/** Team colours */
const TEAM_COLOUR:    [number, number] = [0x2255cc, 0xcc2222];
const TEAM_DARK:      [number, number] = [0x142e6e, 0x6e1111];

/**
 * Draw the stone at its current position.
 * isActive = true draws a gold outer ring (tween alpha externally).
 * Clears `g` before drawing to allow this function to be the sole renderer.
 *
 * Note: if you share a single Graphics object for all stones you must NOT
 * clear it between individual stones. Instead, each stone should own its own
 * Graphics object and this function clears/redraws on that object only.
 */
export function drawStone(
  g: Phaser.GameObjects.Graphics,
  s: StoneState,
  isActive: boolean,
): void {
  const { x, y, r } = s;
  g.clear();

  // Active ring (scene tweens the Graphics' alpha to pulse)
  if (isActive) {
    g.lineStyle(3, 0xd4a843, 0.6);
    g.strokeCircle(x, y, r * 1.45);
  }

  // Frozen overlay base (drawn before shadow so it shows through)
  if (s.frozen) {
    g.fillStyle(0x88ccff, 0.30);
    g.fillCircle(x, y, r * 1.15);
  }

  // Drop shadow
  g.fillStyle(0x000000, 0.22);
  g.fillEllipse(x + r * 0.3, y + r * 0.4, r * 2.2, r * 0.85);

  // Main body
  const baseCol = TEAM_COLOUR[s.teamId];
  g.fillStyle(baseCol, 1);
  g.fillCircle(x, y, r);

  // Shell-plate pattern — 5 arc segments
  const darkCol = TEAM_DARK[s.teamId];
  g.lineStyle(Math.max(1.5, r * 0.12), darkCol, 0.75);
  const arcs = [
    { ang0: 0.3,  ang1: 1.4,  rx: r * 0.55, ry: r * 0.55 },
    { ang0: 1.7,  ang1: 2.9,  rx: r * 0.52, ry: r * 0.52 },
    { ang0: 3.3,  ang1: 4.5,  rx: r * 0.50, ry: r * 0.50 },
    { ang0: 4.8,  ang1: 5.9,  rx: r * 0.53, ry: r * 0.53 },
    { ang0: -0.4, ang1: 0.2,  rx: r * 0.45, ry: r * 0.45 },
  ];
  for (const arc of arcs) {
    g.beginPath();
    g.arc(x, y, arc.rx, arc.ang0, arc.ang1, false);
    g.strokePath();
  }

  // Specular highlight
  g.fillStyle(0xffffff, 0.50);
  g.fillCircle(x - r * 0.28, y - r * 0.28, r * 0.20);

  // Power badge (small circle, top-right)
  if (s.power !== PowerType.NONE) {
    const badgeR   = Math.max(4, r * 0.22);
    const badgeX   = x + r * 0.62;
    const badgeY   = y - r * 0.62;
    // Badge accent colour is read from the power registry in the scene; here we
    // fall back to a generic white since stone.ts must not import the registry.
    // The scene should pass a coloured Graphics override or draw the badge separately.
    g.fillStyle(0xffffff, 0.90);
    g.fillCircle(badgeX, badgeY, badgeR);
  }

  // Frozen crystal overlay (drawn last so it's on top)
  if (s.frozen) {
    g.lineStyle(1.5, 0x88ccff, 0.85);
    // Simple six-pointed snowflake
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      g.lineBetween(x, y, x + Math.cos(angle) * r * 0.8, y + Math.sin(angle) * r * 0.8);
    }
  }
}
