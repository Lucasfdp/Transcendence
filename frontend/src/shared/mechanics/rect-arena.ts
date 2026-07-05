/**
 * game/mechanics/rect-arena.ts — rectangular arena geometry and rendering.
 *
 * Supports two orientations:
 *   'vertical'   — stone delivered from the top, travels DOWN towards house at bottom.
 *   'horizontal' — stone delivered from the left, travels RIGHT towards house at right.
 *
 * All coordinates in RectArenaPixels are canvas pixels after letterbox-fitting.
 */

import Phaser from "phaser";
import type { StoneState } from "./stone";

// ── Types ──────────────────────────────────────────────────────────────────────

/** Arena geometry in source-image pixels (authored at a reference resolution). */
export interface RectArenaDef {
	srcW: number;
	srcH: number;
	sheetX: number; // left edge of sheet in source px
	sheetY: number; // top edge of sheet in source px
	sheetW: number;
	sheetH: number;
	houseRadius: number; // outermost house ring in source px
	houseCentreOffset: number; // distance from sheet end-line to house centre
	orientation?: "vertical" | "horizontal"; // default: 'vertical'
}

/** Arena geometry resolved to canvas pixels for the current frame. */
export interface RectArenaPixels {
	sheetX: number;
	sheetY: number;
	sheetW: number;
	sheetH: number;

	/** Scoring house centre (far end — the target rings). */
	houseFarCX: number;
	houseFarCY: number;
	/** Reference house centre (near/delivery end — drawn dim). */
	houseNearCX: number;
	houseNearCY: number;

	/** [outer, mid, inner, button] radii in canvas px. */
	houseRadii: [number, number, number, number];

	/** Stone spawn X (delivery-end x for horizontal; sheet centre x for vertical). */
	deliveryX: number;
	/** Stone spawn Y (sheet centre y for horizontal; delivery-end y for vertical). */
	deliveryY: number;

	/**
	 * Hog line coordinate — stones must clear this or are removed.
	 * hogX is used when orientation === 'horizontal'; hogY when 'vertical'.
	 */
	hogX: number;
	hogY: number;

	orientation: "vertical" | "horizontal";
	scale: number;
}

// ── Transform ─────────────────────────────────────────────────────────────────

/** Source-px inset from the far end: visual-only hog line (vertical mode). */
const HOG_LINE_INSET_SRC = 160;
/** Source-px inset from the near end: stone spawns here (delivery hack). */
const DELIVERY_LINE_INSET_SRC = 90;

/** Letterbox-fit the arena def into the canvas, preserving aspect ratio. */
export function rectArenaToScreen(
	def: RectArenaDef,
	canvasW: number,
	canvasH: number,
): RectArenaPixels {
	return rectArenaToScreenInRect(def, 0, 0, canvasW, canvasH);
}

/** Letterbox-fit the arena def into an arbitrary canvas-space rectangle. */
export function rectArenaToScreenInRect(
	def: RectArenaDef,
	rectX: number,
	rectY: number,
	rectW: number,
	rectH: number,
): RectArenaPixels {
	const scale = Math.min(rectW / def.srcW, rectH / def.srcH);
	const offX = rectX + (rectW - def.srcW * scale) / 2;
	const offY = rectY + (rectH - def.srcH * scale) / 2;

	const sheetX = offX + def.sheetX * scale;
	const sheetY = offY + def.sheetY * scale;
	const sheetW = def.sheetW * scale;
	const sheetH = def.sheetH * scale;

	const hr = def.houseRadius * scale;
	const hOff = def.houseCentreOffset * scale;
	const orientation = def.orientation ?? "vertical";

	const houseRadii: [number, number, number, number] = [
		hr,
		hr * 0.667,
		hr * 0.333,
		hr * 0.1,
	];

	if (orientation === "horizontal") {
		// Stone travels LEFT → RIGHT; scoring house on the right
		const midY = sheetY + sheetH / 2;
		return {
			sheetX,
			sheetY,
			sheetW,
			sheetH,
			houseFarCX: sheetX + sheetW - hOff,
			houseFarCY: midY,
			houseNearCX: sheetX + hOff,
			houseNearCY: midY,
			houseRadii,
			deliveryX: sheetX + DELIVERY_LINE_INSET_SRC * scale,
			deliveryY: midY,
			hogX: sheetX + sheetW - HOG_LINE_INSET_SRC * scale,
			hogY: midY, // unused for horizontal
			orientation,
			scale,
		};
	}

	// Default: vertical — stone travels TOP → BOTTOM; scoring house at bottom
	const midX = sheetX + sheetW / 2;
	return {
		sheetX,
		sheetY,
		sheetW,
		sheetH,
		houseFarCX: midX,
		houseFarCY: sheetY + sheetH - hOff,
		houseNearCX: midX,
		houseNearCY: sheetY + hOff,
		houseRadii,
		deliveryX: midX, // unused for vertical
		deliveryY: sheetY + DELIVERY_LINE_INSET_SRC * scale,
		hogX: midX, // unused for vertical
		hogY: sheetY + sheetH - HOG_LINE_INSET_SRC * scale,
		orientation,
		scale,
	};
}

/** Fit the playable sheet bounds into a rectangle, ignoring authored margins. */
export function rectArenaPlayableToScreenInRect(
	def: RectArenaDef,
	rectX: number,
	rectY: number,
	rectW: number,
	rectH: number,
): RectArenaPixels {
	return rectArenaToScreenInRect(
		{
			...def,
			srcW: def.sheetW,
			srcH: def.sheetH,
			sheetX: 0,
			sheetY: 0,
		},
		rectX,
		rectY,
		rectW,
		rectH,
	);
}

// ── Boundary helpers ──────────────────────────────────────────────────────────

/** True if the stone centre is within the outermost house ring at the scoring end. */
export function isStoneInHouse(s: StoneState, a: RectArenaPixels): boolean {
	const dx = s.x - a.houseFarCX;
	const dy = s.y - a.houseFarCY;
	return Math.sqrt(dx * dx + dy * dy) <= a.houseRadii[0];
}

/** Distance from the stone centre to the scoring house button (centre dot). */
export function distanceToHouseButton(
	s: StoneState,
	a: RectArenaPixels,
): number {
	const dx = s.x - a.houseFarCX;
	const dy = s.y - a.houseFarCY;
	return Math.sqrt(dx * dx + dy * dy);
}

/** True if the stone has left the playable sheet.
 *  Horizontal mode: all four walls bounce (handled in stepStone), so stones
 *  are never out-of-bounds — they can never leave the enclosed sheet. */
export function isStoneOutOfBounds(s: StoneState, a: RectArenaPixels): boolean {
	if (a.orientation === "horizontal") {
		return false; // fully enclosed — walls bounce, no removal
	}
	// vertical
	return (
		s.x - s.r < a.sheetX ||
		s.x + s.r > a.sheetX + a.sheetW ||
		s.y - s.r > a.sheetY + a.sheetH
	);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const COLOR_ICE = 0xddeef8; // warm pale ice blue
const COLOR_WALL = 0x5aaecc; // sheet boundary walls
const COLOR_CENTRE_LINE = 0x5aaecc; // mid-sheet line (perpendicular to travel)
const COLOR_HOG_LINE = 0xcc4444; // far hog line — must clear or stone removed
const COLOR_HOG_LINE_DIM = 0xcc4444; // delivery guide line (drawn faint)
const COLOR_HACK_MARK = 0xffffff; // delivery hack cross

// House ring colours (outer → button)
const HOUSE_COLORS: [number, number, number, number] = [
	0xcc2222, // outer — red
	0xffffff, // second — white
	0x2255cc, // third — blue
	0xffffff, // button — white
];

/**
 * Draw the ice sheet onto g.
 * Background is the caller's responsibility (drawn on a separate depth-0 layer).
 * Clears g before drawing.
 */
export function drawIceSheet(
	g: Phaser.GameObjects.Graphics,
	a: RectArenaPixels,
): void {
	const { sheetX: sx, sheetY: sy, sheetW: sw, sheetH: sh, scale } = a;

	g.clear();

	// ── 1. Ice sheet fill ─────────────────────────────────────────────────────
	g.fillStyle(COLOR_ICE, 1);
	g.fillRect(sx, sy, sw, sh);

	// ── 2. Pebble texture — faint striations perpendicular to travel direction ─
	const pebbleStep = Math.max(3, 5 * scale);
	g.lineStyle(1, 0xc4dce8, 0.22);
	if (a.orientation === "horizontal") {
		// Vertical lines (perpendicular to rightward travel)
		for (let x = sx; x < sx + sw; x += pebbleStep) {
			g.lineBetween(x, sy, x, sy + sh);
		}
	} else {
		// Horizontal lines
		for (let y = sy; y < sy + sh; y += pebbleStep) {
			g.lineBetween(sx, y, sx + sw, y);
		}
	}

	if (a.orientation === "horizontal") {
		drawHorizontalSheet(g, a);
	} else {
		drawVerticalSheet(g, a);
	}
}

// ── Horizontal sheet (stone travels left → right) ────────────────────────────

function drawHorizontalSheet(
	g: Phaser.GameObjects.Graphics,
	a: RectArenaPixels,
): void {
	const { sheetX: sx, sheetY: sy, sheetW: sw, sheetH: sh, scale } = a;

	// ── 3. Scoring house — right end, full opacity ───────────────────────────
	drawHouseRings(g, a.houseFarCX, a.houseFarCY, a.houseRadii, 1);

	// ── 4. Centre line (vertical — perpendicular to travel) ──────────────────
	const midX = sx + sw / 2;
	g.lineStyle(1, COLOR_CENTRE_LINE, 0.3);
	g.lineBetween(midX, sy, midX, sy + sh);

	// ── 5. All four boundary walls (fully enclosed) ───────────────────────────
	g.lineStyle(Math.max(1.5, 2 * scale), COLOR_WALL, 1);
	g.lineBetween(sx, sy, sx + sw, sy); // top
	g.lineBetween(sx, sy + sh, sx + sw, sy + sh); // bottom
	g.lineBetween(sx, sy, sx, sy + sh); // left
	g.lineBetween(sx + sw, sy, sx + sw, sy + sh); // right

	// ── 6. Delivery hack mark ─────────────────────────────────────────────────
	const hackSize = Math.max(6, 10 * scale);
	g.lineStyle(Math.max(1.5, 2 * scale), COLOR_HACK_MARK, 0.9);
	g.lineBetween(
		a.deliveryX - hackSize,
		a.deliveryY,
		a.deliveryX + hackSize,
		a.deliveryY,
	);
	g.lineBetween(
		a.deliveryX,
		a.deliveryY - hackSize,
		a.deliveryX,
		a.deliveryY + hackSize,
	);
}

// ── Vertical sheet (stone travels top → bottom) ───────────────────────────────

function drawVerticalSheet(
	g: Phaser.GameObjects.Graphics,
	a: RectArenaPixels,
): void {
	const { sheetX: sx, sheetY: sy, sheetW: sw, sheetH: sh, scale } = a;

	// ── 3. Reference house — delivery end, very dim ───────────────────────────
	drawHouseRings(g, a.houseNearCX, a.houseNearCY, a.houseRadii, 0.25);

	// ── 4. Scoring house — far (bottom) end, full opacity ────────────────────
	drawHouseRings(g, a.houseFarCX, a.houseFarCY, a.houseRadii, 1);

	// ── 5. Centre line ────────────────────────────────────────────────────────
	const midY = sy + sh / 2;
	g.lineStyle(1, COLOR_CENTRE_LINE, 0.35);
	g.lineBetween(sx, midY, sx + sw, midY);

	// ── 6. Far hog line ───────────────────────────────────────────────────────
	g.lineStyle(Math.max(1.5, 2 * scale), COLOR_HOG_LINE, 0.85);
	g.lineBetween(sx, a.hogY, sx + sw, a.hogY);

	// ── 7. Delivery guide line ────────────────────────────────────────────────
	g.lineStyle(1, COLOR_HOG_LINE_DIM, 0.28);
	g.lineBetween(sx, a.deliveryY, sx + sw, a.deliveryY);

	// ── 8. Side walls ─────────────────────────────────────────────────────────
	g.lineStyle(Math.max(1.5, 2 * scale), COLOR_WALL, 1);
	g.lineBetween(sx, sy, sx, sy + sh);
	g.lineBetween(sx + sw, sy, sx + sw, sy + sh);

	// ── 9. Hack mark ──────────────────────────────────────────────────────────
	const hackSize = Math.max(6, 10 * scale);
	const hackXC = sx + sw * 0.5;
	g.lineStyle(Math.max(1.5, 2 * scale), COLOR_HACK_MARK, 0.9);
	g.lineBetween(
		hackXC - hackSize,
		a.deliveryY,
		hackXC + hackSize,
		a.deliveryY,
	);
	g.lineBetween(
		hackXC,
		a.deliveryY - hackSize,
		hackXC,
		a.deliveryY + hackSize,
	);
}

// ── Shared helper ─────────────────────────────────────────────────────────────

function drawHouseRings(
	g: Phaser.GameObjects.Graphics,
	cx: number,
	cy: number,
	radii: [number, number, number, number],
	alpha: number,
): void {
	for (let i = 0; i < 4; i++) {
		g.fillStyle(HOUSE_COLORS[i], alpha);
		g.fillCircle(cx, cy, radii[i]);
	}
}
