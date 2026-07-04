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

export const OVAL_ARENA_SKIN = {
	key: "oval-arena-skin",
	source: "/assets/textures/arenas/ovalArenaSkin.png",
	width: 1536,
	height: 1100,
	// The playable area is the inner sand ellipse, not the full stone rim.
	// Keeping the same aspect as ARENA_01 avoids stretching the hand-painted asset.
	playableW: 1240,
	playableH: 864,
} as const;

export function preloadOvalArenaSkin(scene: Phaser.Scene): void {
	if (!scene.textures.exists(OVAL_ARENA_SKIN.key))
		scene.load.image(OVAL_ARENA_SKIN.key, OVAL_ARENA_SKIN.source);
}

export function layoutOvalArenaSkin(
	image: Phaser.GameObjects.Image,
	a: ArenaPixels,
): void {
	image
		.setOrigin(0.5)
		.setPosition(a.cx, a.cy)
		.setDisplaySize(
			a.rx * 2 * (OVAL_ARENA_SKIN.width / OVAL_ARENA_SKIN.playableW),
			a.ry * 2 * (OVAL_ARENA_SKIN.height / OVAL_ARENA_SKIN.playableH),
		);
}
