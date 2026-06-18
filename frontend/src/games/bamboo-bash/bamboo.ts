/**
 * bamboo-bash/bamboo.ts — bamboo target state, growth, collision and rendering.
 *
 * A bamboo cluster spawns at a random point inside the arena ellipse as a
 * single cane and grows one cane every GROW_INTERVAL_MS, capped at MAX_STAGE.
 * Smashing it with the ball awards STAGE_POINTS[stage] and removes it.
 *
 * Positions are stored as normalised ellipse coordinates (nx, ny in [-1, 1],
 * fractions of rx / ry) so a bamboo keeps its spot in the ring across resizes —
 * its canvas position is derived from the live ArenaPixels every frame.
 */

import Phaser from "phaser";
import { ArenaPixels } from "../arenas/arena";

// ── Tuning ──────────────────────────────────────────────────────────────────

export const GROW_INTERVAL_MS = 5000; // time between cane growths
export const MAX_STAGE = 3; // canes cap
export const BAMBOO_SRC_R = 24; // base cane half-width in arena source px

/** Points awarded when a bamboo of a given stage is smashed. */
export const STAGE_POINTS: Record<number, number> = { 1: 100, 2: 150, 3: 250 };

// ── State ─────────────────────────────────────────────────────────────────────

export interface Bamboo {
	nx: number; // normalised x within ellipse (fraction of rx), [-1, 1]
	ny: number; // normalised y within ellipse (fraction of ry), [-1, 1]
	stage: number; // 1..MAX_STAGE — number of canes
	ageMs: number; // time alive, drives growth
}

/** Stage for a given age: 1 cane, +1 every GROW_INTERVAL_MS, capped. */
export function stageForAge(ageMs: number): number {
	return Math.min(MAX_STAGE, 1 + Math.floor(ageMs / GROW_INTERVAL_MS));
}

/** Advance a bamboo's age and update its stage. */
export function stepBamboo(b: Bamboo, deltaMs: number): void {
	b.ageMs += deltaMs;
	b.stage = stageForAge(b.ageMs);
}

// ── Geometry ──────────────────────────────────────────────────────────────────

/** Canvas-space centre of a bamboo for the current arena. */
export function bambooPos(b: Bamboo, a: ArenaPixels): { x: number; y: number } {
	return { x: a.cx + b.nx * a.rx, y: a.cy + b.ny * a.ry };
}

/** Collision radius in canvas px — wider clusters are bigger targets. */
export function bambooRadius(b: Bamboo, a: ArenaPixels): number {
	return BAMBOO_SRC_R * a.scale * (0.7 + 0.35 * b.stage);
}

/** True if the ball (centre cx,cy radius cr) overlaps the bamboo. */
export function hitsBamboo(
	b: Bamboo,
	a: ArenaPixels,
	cx: number,
	cy: number,
	cr: number,
): boolean {
	const p = bambooPos(b, a);
	const dx = p.x - cx;
	const dy = p.y - cy;
	const reach = cr + bambooRadius(b, a);
	return dx * dx + dy * dy <= reach * reach;
}

/**
 * Pick a random normalised position inside the ring, keeping clear of the
 * centre (where the ball starts) and of any existing bamboo. Returns null if
 * no clear spot is found after a few tries.
 */
export function randomSpot(
	existing: Bamboo[],
): { nx: number; ny: number } | null {
	const MAX_RADIUS = 0.82; // stay inside the tawara border
	const CLEAR_OF_CENTRE = 0.22;
	const MIN_SEP = 0.24; // min normalised distance between clusters

	for (let attempt = 0; attempt < 24; attempt++) {
		const r = Math.sqrt(Math.random()) * MAX_RADIUS; // uniform over the disc
		const t = Math.random() * Math.PI * 2;
		const nx = r * Math.cos(t);
		const ny = r * Math.sin(t);

		if (Math.hypot(nx, ny) < CLEAR_OF_CENTRE) continue;
		if (existing.some((e) => Math.hypot(e.nx - nx, e.ny - ny) < MIN_SEP))
			continue;
		return { nx, ny };
	}
	return null;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const CANE_BODY = 0x4e9a3a;
const CANE_DARK = 0x357026;
const CANE_LIGHT = 0x7ec96a;
const NODE_LINE = 0x2c5a1e;
const LEAF = 0x6fbf52;

/**
 * Draw a bamboo cluster onto `g` (caller clears `g` once per frame and draws
 * every live bamboo). The cluster fans `stage` canes around its centre.
 */
export function drawBamboo(
	g: Phaser.GameObjects.Graphics,
	b: Bamboo,
	a: ArenaPixels,
): void {
	const { x, y } = bambooPos(b, a);
	const unit = BAMBOO_SRC_R * a.scale;
	const caneW = unit * 0.7;
	const caneH = unit * 2.6;
	const spread = unit * 0.8;

	// Ground shadow
	g.fillStyle(0x000000, 0.2);
	g.fillEllipse(
		x,
		y + caneH * 0.42,
		caneW * (1 + b.stage) * 1.1,
		unit * 0.55,
	);

	// Canes drawn back-to-front, centred fan
	const n = b.stage;
	for (let i = 0; i < n; i++) {
		const offset = n === 1 ? 0 : (i - (n - 1) / 2) * spread;
		drawCane(g, x + offset, y, caneW, caneH);
	}
}

function drawCane(
	g: Phaser.GameObjects.Graphics,
	x: number,
	y: number,
	w: number,
	h: number,
): void {
	const top = y - h * 0.65;

	// Stalk
	g.fillStyle(CANE_BODY, 1);
	g.fillRoundedRect(x - w / 2, top, w, h, w * 0.4);
	// Shading + highlight
	g.fillStyle(CANE_DARK, 0.6);
	g.fillRoundedRect(x + w * 0.08, top, w * 0.42, h, w * 0.3);
	g.fillStyle(CANE_LIGHT, 0.5);
	g.fillRoundedRect(x - w * 0.4, top, w * 0.28, h, w * 0.3);

	// Node rings
	const segs = 3;
	g.lineStyle(Math.max(1, w * 0.18), NODE_LINE, 0.9);
	for (let s = 1; s < segs; s++) {
		const ny = top + (h * s) / segs;
		g.lineBetween(x - w / 2, ny, x + w / 2, ny);
	}

	// A couple of leaves near the top
	g.fillStyle(LEAF, 0.95);
	g.fillEllipse(x + w * 0.9, top + h * 0.12, w * 1.6, w * 0.55);
	g.fillEllipse(x - w * 0.9, top + h * 0.26, w * 1.4, w * 0.5);
}
