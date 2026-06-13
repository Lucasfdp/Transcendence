/**
 * Arena 01 — Shell Smash sumo ring vector data.
 *
 * All geometry is stored as fractions of the canvas size so it scales
 * to any resolution without resampling.  Derived by pixel-analysing
 * assets/textures/arenas/arena01.png (1920×1080):
 *   ellipse bbox  x: 256–1667  y: 49–1032
 *   → cx=961 cy=540  rx=705 ry=491
 *
 * Boundary check (is a point inside the ring?):
 *   ((px - cx) / rx)² + ((py - cy) / ry)² ≤ 1
 */

import Phaser from 'phaser';

// ── Arena definition ──────────────────────────────────────────────────────────

/** All values are fractions of the canvas (width for x/rx, height for y/ry). */
export const ARENA_01 = {
  cx: 0.5,      // centre-x — 961 / 1920
  cy: 0.5,      // centre-y — 540 / 1080
  rx: 0.3672,   // horizontal radius — 705 / 1920
  ry: 0.4546,   // vertical radius   — 491 / 1080
} as const;

// Visual style constants
const COLOR_FLOOR   = 0xe8d5a3;  // sandy clay
const COLOR_TAWARA  = 0x8b3a0f;  // rice-straw bale (dark terracotta)
const COLOR_MARKING = 0xffffff;  // centre-line markings
const ALPHA_FLOOR   = 1.0;
const TAWARA_THICK  = 10;        // border stroke width in px at 1080p — scaled below

// ── Pixel helpers ─────────────────────────────────────────────────────────────

/** Convert normalised arena fractions to absolute canvas pixels. */
export function arenaPixels(canvasW: number, canvasH: number) {
  return {
    cx: ARENA_01.cx * canvasW,
    cy: ARENA_01.cy * canvasH,
    rx: ARENA_01.rx * canvasW,
    ry: ARENA_01.ry * canvasH,
  };
}

/**
 * Returns true if the point (px, py) is inside the elliptical ring.
 * All arguments in absolute canvas pixels.
 */
export function isInsideArena(
  px: number, py: number,
  cx: number, cy: number,
  rx: number, ry: number,
): boolean {
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/**
 * Returns a 0–1 value: 0 = centre of ring, 1 = exactly on the edge, >1 = out.
 * Useful for visual danger-zone feedback as a player nears the boundary.
 */
export function arenaEdgeFraction(
  px: number, py: number,
  cx: number, cy: number,
  rx: number, ry: number,
): number {
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Drawing ───────────────────────────────────────────────────────────────────

/**
 * Draw the sumo ring onto `g`.  Call this once (or on resize after g.clear()).
 *
 * The ring consists of:
 *   1. Filled floor ellipse (sandy clay)
 *   2. Tawara border stroke (thick terracotta ring)
 *   3. Shichosen — two short vertical lines at the centre (start markers)
 *
 * @param g         Phaser Graphics object to draw into
 * @param canvasW   Current canvas width  (this.scale.width)
 * @param canvasH   Current canvas height (this.scale.height)
 */
export function drawArena01(
  g: Phaser.GameObjects.Graphics,
  canvasW: number,
  canvasH: number,
): void {
  const { cx, cy, rx, ry } = arenaPixels(canvasW, canvasH);

  // Scale the tawara stroke thickness proportionally to canvas height
  const borderW = Math.max(4, Math.round(TAWARA_THICK * (canvasH / 1080)));

  // 1. Floor
  g.fillStyle(COLOR_FLOOR, ALPHA_FLOOR);
  g.fillEllipse(cx, cy, rx * 2, ry * 2);

  // 2. Tawara border — draw a slightly smaller filled ellipse subtracted by
  //    stroke. Phaser Graphics has no strokeEllipse in older versions, so we
  //    approximate with two concentric filled ellipses (outer tawara colour,
  //    inner floor colour).
  const bw = borderW;
  g.fillStyle(COLOR_TAWARA, 1);
  g.fillEllipse(cx, cy, rx * 2, ry * 2);
  g.fillStyle(COLOR_FLOOR, 1);
  g.fillEllipse(cx, cy, (rx - bw) * 2, (ry - bw) * 2);

  // 3. Shichosen — two short start lines flanking the centre
  const lineH  = ry * 0.12;
  const lineW  = Math.max(3, borderW * 0.6);
  const offset = rx * 0.06;
  g.fillStyle(COLOR_MARKING, 1);
  g.fillRect(cx - offset - lineW / 2, cy - lineH / 2, lineW, lineH);
  g.fillRect(cx + offset - lineW / 2, cy - lineH / 2, lineW, lineH);
}
