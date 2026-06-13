/**
 * game/mechanics/rect-arena.ts — rectangular arena geometry and rendering.
 *
 * Mirrors the contract of game/arenas/arena.ts but for axis-aligned sheets
 * (e.g. curling, shuffleboard) rather than elliptical sumo rings.
 *
 * All coordinates are stored in canvas pixels after letterbox-fitting.
 * The sheet is fit inside the canvas with a uniform scale (Math.min) so the
 * aspect ratio is preserved exactly at every window size.
 */

import Phaser from 'phaser';
import type { StoneState } from './stone';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Arena geometry in source-image pixels (authored at a reference resolution). */
export interface RectArenaDef {
  srcW: number;
  srcH: number;
  sheetX: number;            // left edge of sheet in source px
  sheetY: number;            // top edge of sheet in source px
  sheetW: number;
  sheetH: number;
  houseRadius: number;       // outermost house ring in source px
  houseCentreOffset: number; // distance from sheet end-line to house centre
}

/** Arena geometry resolved to canvas pixels for the current frame. */
export interface RectArenaPixels {
  sheetX: number;
  sheetY: number;
  sheetW: number;
  sheetH: number;
  // House at delivery end (top of sheet — dim reference)
  houseTopCX: number;
  houseTopCY: number;
  // House at scoring end (bottom of sheet — bright target)
  houseBottomCX: number;
  houseBottomCY: number;
  // [outer, mid, inner, button] radii in canvas px
  houseRadii: [number, number, number, number];
  deliveryLineY: number; // stones must cross this Y to count as in play
  hogLineY: number;      // stones must clear this Y or are removed
  scale: number;
}

// ── Transform ─────────────────────────────────────────────────────────────────

const HOG_LINE_INSET_SRC   = 160; // source px from far end — must clear to stay
const DELIVERY_LINE_INSET_SRC = 60; // source px from start end

/** Letterbox-fit the arena def into the canvas, preserving aspect ratio. */
export function rectArenaToScreen(
  def: RectArenaDef,
  canvasW: number,
  canvasH: number,
): RectArenaPixels {
  const scale = Math.min(canvasW / def.srcW, canvasH / def.srcH);
  const offX  = (canvasW - def.srcW * scale) / 2;
  const offY  = (canvasH - def.srcH * scale) / 2;

  const sheetX = offX + def.sheetX * scale;
  const sheetY = offY + def.sheetY * scale;
  const sheetW = def.sheetW * scale;
  const sheetH = def.sheetH * scale;
  const sheetCX = sheetX + sheetW / 2;

  const hr = def.houseRadius * scale;
  const hOff = def.houseCentreOffset * scale;

  const houseRadii: [number, number, number, number] = [
    hr,
    hr * 0.667,
    hr * 0.333,
    hr * 0.10,
  ];

  return {
    sheetX,
    sheetY,
    sheetW,
    sheetH,
    houseTopCX:    sheetCX,
    houseTopCY:    sheetY + hOff,
    houseBottomCX: sheetCX,
    houseBottomCY: sheetY + sheetH - hOff,
    houseRadii,
    deliveryLineY: sheetY + DELIVERY_LINE_INSET_SRC * scale,
    hogLineY:      sheetY + sheetH - HOG_LINE_INSET_SRC * scale,
    scale,
  };
}

// ── Boundary helpers ──────────────────────────────────────────────────────────

/** True if the stone centre is within the outermost house ring at the scoring end. */
export function isStoneInHouse(s: StoneState, a: RectArenaPixels): boolean {
  const dx = s.x - a.houseBottomCX;
  const dy = s.y - a.houseBottomCY;
  return Math.sqrt(dx * dx + dy * dy) <= a.houseRadii[0];
}

/** Distance from the stone centre to the scoring house button (centre dot). */
export function distanceToHouseButton(s: StoneState, a: RectArenaPixels): number {
  const dx = s.x - a.houseBottomCX;
  const dy = s.y - a.houseBottomCY;
  return Math.sqrt(dx * dx + dy * dy);
}

/** True if the stone has left the sheet entirely (side or far end). */
export function isStoneOutOfBounds(s: StoneState, a: RectArenaPixels): boolean {
  return (
    s.x - s.r < a.sheetX ||
    s.x + s.r > a.sheetX + a.sheetW ||
    s.y - s.r > a.sheetY + a.sheetH
  );
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const COLOR_BG           = 0x0a1f3f; // deep navy surrounding sheet
const COLOR_ICE          = 0xcce8ff; // pale ice blue
const COLOR_WALL         = 0x4499cc; // sheet side walls
const COLOR_CENTRE_LINE  = 0x4499cc; // mid-sheet horizontal line
const COLOR_HOG_LINE     = 0xcc4444; // hog / out-of-bounds lines
const COLOR_HACK_MARK    = 0xffffff; // delivery hack cross
const COLOR_BAMBOO_GRID  = 0x0e2240; // subtle overlay outside sheet

// House ring colours (outer → button)
const HOUSE_COLORS: [number, number, number, number] = [
  0xcc2222, // outer — red
  0xffffff, // second — white
  0x2255cc, // third — blue
  0xffffff, // button — white
];

const BAMBOO_GRID_STEP_SRC = 64; // source px between grid lines

/**
 * Draw the ice sheet onto g. Call once, or after g.clear() on resize.
 * Clears g before drawing.
 */
export function drawIceSheet(g: Phaser.GameObjects.Graphics, a: RectArenaPixels): void {
  const { sheetX: sx, sheetY: sy, sheetW: sw, sheetH: sh, scale } = a;

  g.clear();

  // ── 1. Background ────────────────────────────────────────────────────────
  const bw = g.scene.scale.width;
  const bh = g.scene.scale.height;
  g.fillStyle(COLOR_BG, 1);
  g.fillRect(0, 0, bw, bh);

  // ── 2. Bamboo grid overlay (outside sheet) ────────────────────────────────
  const step = BAMBOO_GRID_STEP_SRC * scale;
  g.lineStyle(1, COLOR_BAMBOO_GRID, 0.3);
  for (let x = 0; x < bw; x += step) g.lineBetween(x, 0, x, bh);
  for (let y = 0; y < bh; y += step) g.lineBetween(0, y, bw, y);

  // ── 3. Ice sheet fill ────────────────────────────────────────────────────
  g.fillStyle(COLOR_ICE, 1);
  g.fillRect(sx, sy, sw, sh);

  // ── 4. House at delivery end (dim) ───────────────────────────────────────
  drawHouseRings(g, a.houseTopCX, a.houseTopCY, a.houseRadii, 0.35);

  // ── 5. House at scoring end (bright) ────────────────────────────────────
  drawHouseRings(g, a.houseBottomCX, a.houseBottomCY, a.houseRadii, 1);

  // ── 6. Centre line (mid-height horizontal) ───────────────────────────────
  const midY = sy + sh / 2;
  g.lineStyle(1, COLOR_CENTRE_LINE, 0.4);
  g.lineBetween(sx, midY, sx + sw, midY);

  // ── 7. Hog lines ─────────────────────────────────────────────────────────
  g.lineStyle(2, COLOR_HOG_LINE, 0.85);
  g.lineBetween(sx, a.hogLineY, sx + sw, a.hogLineY);
  // Top hog line mirrors at equivalent inset from top
  const topHogY = sy + sh - (a.hogLineY - sy);
  g.lineBetween(sx, topHogY, sx + sw, topHogY);

  // ── 8. Side walls ────────────────────────────────────────────────────────
  g.lineStyle(2, COLOR_WALL, 1);
  g.lineBetween(sx, sy, sx, sy + sh);
  g.lineBetween(sx + sw, sy, sx + sw, sy + sh);

  // ── 9. Delivery hack marks (cross at each delivery position) ─────────────
  const hackSize = Math.max(6, 10 * scale);
  const hackY = a.deliveryLineY;
  const hackXL = sx + sw * 0.25;
  const hackXR = sx + sw * 0.75;
  g.lineStyle(2, COLOR_HACK_MARK, 0.9);
  for (const hx of [hackXL, hackXR]) {
    g.lineBetween(hx - hackSize, hackY, hx + hackSize, hackY);
    g.lineBetween(hx, hackY - hackSize, hx, hackY + hackSize);
  }
}

function drawHouseRings(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  radii: [number, number, number, number],
  alpha: number,
): void {
  // Draw outer → inner so inner rings paint over outer ones
  for (let i = 0; i < 4; i++) {
    g.fillStyle(HOUSE_COLORS[i], alpha);
    g.fillCircle(cx, cy, radii[i]);
  }
}
