/**
 * mechanics/arena.ts — shared elliptical-arena geometry and rendering.
 *
 * An arena is defined in *source pixel space* (the resolution its texture was
 * authored at). At render time it is letterbox-fitted into the canvas with a
 * single uniform scale factor — `min(w/srcW, h/srcH)` — so the ellipse keeps
 * its aspect ratio at every window size, using the same kind of uniform
 * letterboxing used elsewhere in the Phaser renderer.
 *
 * Boundary check (is a point inside the ring?):
 *   ((px - cx) / rx)² + ((py - cy) / ry)² ≤ 1
 */

import Phaser from "phaser";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Arena geometry in source-image pixels. */
export interface ArenaDef {
	srcW: number; // source image width
	srcH: number; // source image height
	cx: number; // ellipse centre-x in source px
	cy: number; // ellipse centre-y in source px
	rx: number; // horizontal radius in source px
	ry: number; // vertical radius in source px
}

/** Arena geometry resolved to absolute canvas pixels for the current frame. */
export interface ArenaPixels {
	cx: number;
	cy: number;
	rx: number;
	ry: number;
	scale: number; // uniform letterbox scale — use to size other game objects
}

// ── Coordinate transform ──────────────────────────────────────────────────────

/**
 * Letterbox-fit the arena into the canvas with a uniform scale so the
 * ellipse's aspect ratio is preserved at any canvas size.
 */
export function arenaToScreen(
	def: ArenaDef,
	canvasW: number,
	canvasH: number,
): ArenaPixels {
	return arenaToScreenInRect(def, 0, 0, canvasW, canvasH);
}

/** Letterbox-fit the arena into an arbitrary canvas-space rectangle. */
export function arenaToScreenInRect(
	def: ArenaDef,
	rectX: number,
	rectY: number,
	rectW: number,
	rectH: number,
): ArenaPixels {
	const scale = Math.min(rectW / def.srcW, rectH / def.srcH);
	const offX = rectX + (rectW - def.srcW * scale) / 2;
	const offY = rectY + (rectH - def.srcH * scale) / 2;
	return {
		cx: offX + def.cx * scale,
		cy: offY + def.cy * scale,
		rx: def.rx * scale,
		ry: def.ry * scale,
		scale,
	};
}

/** Fit the playable ellipse bounds into a rectangle, ignoring authored margins. */
export function arenaPlayableToScreenInRect(
	def: ArenaDef,
	rectX: number,
	rectY: number,
	rectW: number,
	rectH: number,
): ArenaPixels {
	const boundsW = def.rx * 2;
	const boundsH = def.ry * 2;
	const scale = Math.min(rectW / boundsW, rectH / boundsH);
	const offX = rectX + (rectW - boundsW * scale) / 2;
	const offY = rectY + (rectH - boundsH * scale) / 2;
	return {
		cx: offX + def.rx * scale,
		cy: offY + def.ry * scale,
		rx: def.rx * scale,
		ry: def.ry * scale,
		scale,
	};
}

// ── Boundary maths ────────────────────────────────────────────────────────────

/** True if the point (px, py) is inside the elliptical ring. */
export function isInsideArena(px: number, py: number, a: ArenaPixels): boolean {
	const dx = (px - a.cx) / a.rx;
	const dy = (py - a.cy) / a.ry;
	return dx * dx + dy * dy <= 1;
}

/**
 * 0 = centre of ring, 1 = exactly on the edge, >1 = outside.
 * Useful for danger-zone feedback as a player nears the boundary.
 */
export function arenaEdgeFraction(
	px: number,
	py: number,
	a: ArenaPixels,
): number {
	const dx = (px - a.cx) / a.rx;
	const dy = (py - a.cy) / a.ry;
	return Math.sqrt(dx * dx + dy * dy);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const COLOR_FLOOR = 0xe8d5a3; // sandy clay
const COLOR_TAWARA = 0x8b3a0f; // rice-straw bale (dark terracotta)
const COLOR_MARKING = 0xffffff; // centre-line markings
const TAWARA_THICK = 10; // border stroke width in source px

/**
 * Draw the sumo ring onto `g`. Call once, or after g.clear() on resize.
 *
 * The ring consists of:
 *   1. Filled floor ellipse (sandy clay)
 *   2. Tawara border (two concentric filled ellipses — outer tawara colour,
 *      inner floor colour — since strokeEllipse isn't reliable across
 *      Phaser versions)
 *   3. Shikirisen — two short vertical start lines at the centre
 */
export function drawSumoRing(
	g: Phaser.GameObjects.Graphics,
	a: ArenaPixels,
): void {
	const bw = Math.max(4, Math.round(TAWARA_THICK * a.scale));

	g.fillStyle(COLOR_TAWARA, 1);
	g.fillEllipse(a.cx, a.cy, a.rx * 2, a.ry * 2);
	g.fillStyle(COLOR_FLOOR, 1);
	g.fillEllipse(a.cx, a.cy, (a.rx - bw) * 2, (a.ry - bw) * 2);

	const lineH = a.ry * 0.12;
	const lineW = Math.max(3, bw * 0.6);
	const offset = a.rx * 0.06;
	g.fillStyle(COLOR_MARKING, 1);
	g.fillRect(a.cx - offset - lineW / 2, a.cy - lineH / 2, lineW, lineH);
	g.fillRect(a.cx + offset - lineW / 2, a.cy - lineH / 2, lineW, lineH);
}
