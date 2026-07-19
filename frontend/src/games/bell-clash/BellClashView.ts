/**
 * BellClashView — drawing/rendering functions for Bell Clash.
 *
 * Extracted from BellClashScene to keep the scene focused on lifecycle
 * and coordination. Each function takes its minimum required dependencies.
 */

import Phaser from "phaser";
import type { ArenaPixels } from "../../shared/arenas/arena";
import { layoutOvalArenaSkin } from "../../shared/arenas/arena";
import type { BallState } from "../../shared/mechanics/ball";
import { THEME } from "../../shared/theme";
import {
	clearArenaPowerBallTextures,
	drawArenaPowerBalls,
} from "../../shared/mechanics/arena-power-runtime.render";
import type { ArenaPowerRuntime } from "../../shared/mechanics/arena-power-runtime";
import { PLAYER_COLOUR_VALUES } from "../../shared/game-ui";

// ── Types ────────────────────────────────────────────────────────────────────

export type ZoneKind = "red" | "yellow" | "green";

export interface ScoreZone {
	kind: ZoneKind;
	start: number;
	end: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const DEPTH_BG = 0;
export const DEPTH_ZONES = 1;
export const DEPTH_BELL = 2;
export const DEPTH_BALL = 4;
export const DEPTH_FX = 5;

export const ZONE_DEFS: Record<
	ZoneKind,
	{ color: number; label: string; multiplier: number }
> = {
	red: { color: 0xff5a3d, label: "RED", multiplier: 0.5 },
	yellow: { color: 0xffd45a, label: "YELLOW", multiplier: 1.5 },
	green: { color: 0x69d96f, label: "GREEN", multiplier: 2 },
};

const BELL_TEXTURE_KEY = "bell-clash-bell";
const BELL_TEXTURE_PATH = "/assets/bell-clash/bell.png";
export const BELL_CLASH_BELL_RADIUS_SRC = 150;
const BELL_CLASH_ZONE_OUTER_T = 0.9;

// ── Background ───────────────────────────────────────────────────────────────

export function drawBellClashBackground(
	bgGfx: Phaser.GameObjects.Graphics,
	arenaSkin: Phaser.GameObjects.Image,
	arena: ArenaPixels,
	width: number,
	height: number,
): void {
	bgGfx.clear();
	bgGfx.fillStyle(0x120c08, 0.58);
	bgGfx.fillRect(0, 0, width, height);

	layoutOvalArenaSkin(arenaSkin, arena);
}

// ── Zone drawing ─────────────────────────────────────────────────────────────

export function drawBellClashZones(
	zoneGfx: Phaser.GameObjects.Graphics,
	zones: ScoreZone[],
	arena: ArenaPixels,
	ball: BallState,
): void {
	zoneGfx.clear();
	for (const zone of zones) drawBellClashZone(zoneGfx, zone, arena, ball);
}

function drawBellClashZone(
	zoneGfx: Phaser.GameObjects.Graphics,
	zone: ScoreZone,
	arena: ArenaPixels,
	ball: BallState,
): void {
	const def = ZONE_DEFS[zone.kind];

	drawBellClashZoneGradient(zoneGfx, zone, arena, ball, def.color);

	drawBellClashZoneArcGlow(zoneGfx, zone, arena, ball, def.color);
}

function drawBellClashZoneGradient(
	zoneGfx: Phaser.GameObjects.Graphics,
	zone: ScoreZone,
	arena: ArenaPixels,
	ball: BallState,
	color: number,
): void {
	const bands = [
		{ from: 0, to: 0.2, alpha: 0.42 },
		{ from: 0.2, to: 0.4, alpha: 0.34 },
		{ from: 0.4, to: 0.62, alpha: 0.25 },
		{ from: 0.62, to: 0.82, alpha: 0.16 },
		{ from: 0.82, to: BELL_CLASH_ZONE_OUTER_T, alpha: 0.07 },
	];

	for (const band of bands) {
		const points = bellClashZoneBandPoints(
			zone.start,
			zone.end,
			arena,
			ball,
			band.from,
			band.to,
		);
		drawBellClashZonePath(zoneGfx, points, color, band.alpha);
	}
}

function drawBellClashZonePath(
	zoneGfx: Phaser.GameObjects.Graphics,
	points: Array<{ x: number; y: number }>,
	color: number,
	alpha: number,
): void {
	zoneGfx.fillStyle(color, alpha);
	zoneGfx.beginPath();
	zoneGfx.moveTo(points[0].x, points[0].y);
	for (const point of points.slice(1)) zoneGfx.lineTo(point.x, point.y);
	zoneGfx.closePath();
	zoneGfx.fillPath();
}

function drawBellClashZoneArcGlow(
	zoneGfx: Phaser.GameObjects.Graphics,
	zone: ScoreZone,
	arena: ArenaPixels,
	ball: BallState,
	color: number,
): void {
	const inner = bellClashArcPoints(zone.start, zone.end, arena);
	const scale = arena.scale;

	drawBellClashPolyline(zoneGfx, inner, Math.max(8, 11 * scale), color, 0.18);
	drawBellClashPolyline(
		zoneGfx,
		inner,
		Math.max(4, 5.5 * scale),
		color,
		0.18,
	);
	drawBellClashPolyline(
		zoneGfx,
		inner,
		Math.max(1.5, 2.2 * scale),
		color,
		0.72,
	);

	drawBellClashRadialGlow(zoneGfx, arena, ball, zone.start, color);
	drawBellClashRadialGlow(zoneGfx, arena, ball, zone.end, color);
}

function bellClashZoneBandPoints(
	start: number,
	end: number,
	arena: ArenaPixels,
	ball: BallState,
	from: number,
	to: number,
): Array<{ x: number; y: number }> {
	const points: Array<{ x: number; y: number }> = [];
	const segments = 18;

	for (let i = 0; i <= segments; i++) {
		const angle = start + (end - start) * (i / segments);
		points.push(bellClashPointInZone(arena, ball, angle, to));
	}
	for (let i = segments; i >= 0; i--) {
		const angle = start + (end - start) * (i / segments);
		points.push(bellClashPointInZone(arena, ball, angle, from));
	}
	return points;
}

function bellClashPointInZone(
	arena: ArenaPixels,
	ball: BallState,
	angle: number,
	t: number,
): { x: number; y: number } {
	const inner = bellClashRadius(arena) * 0.74;
	const innerPoint = {
		x: arena.cx + Math.cos(angle) * inner,
		y: arena.cy + Math.sin(angle) * inner,
	};
	const outerPoint = bellClashPointOnEllipse(arena, angle, -ball.r * 0.3);
	return {
		x: Phaser.Math.Linear(innerPoint.x, outerPoint.x, t),
		y: Phaser.Math.Linear(innerPoint.y, outerPoint.y, t),
	};
}

function bellClashArcPoints(
	start: number,
	end: number,
	arena: ArenaPixels,
): Array<{ x: number; y: number }> {
	const points: Array<{ x: number; y: number }> = [];
	const segments = 18;
	const inner = bellClashRadius(arena) * 0.74;
	for (let i = 0; i <= segments; i++) {
		const angle = start + (end - start) * (i / segments);
		points.push({
			x: arena.cx + Math.cos(angle) * inner,
			y: arena.cy + Math.sin(angle) * inner,
		});
	}
	return points;
}

function drawBellClashPolyline(
	zoneGfx: Phaser.GameObjects.Graphics,
	points: Array<{ x: number; y: number }>,
	width: number,
	color: number,
	alpha: number,
): void {
	if (points.length < 2) return;
	zoneGfx.lineStyle(width, color, alpha);
	zoneGfx.beginPath();
	zoneGfx.moveTo(points[0].x, points[0].y);
	for (const point of points.slice(1)) zoneGfx.lineTo(point.x, point.y);
	zoneGfx.strokePath();
}

function drawBellClashRadialGlow(
	zoneGfx: Phaser.GameObjects.Graphics,
	arena: ArenaPixels,
	ball: BallState,
	angle: number,
	color: number,
): void {
	const inner = bellClashRadius(arena) * 0.74;
	const x0 = arena.cx + Math.cos(angle) * inner;
	const y0 = arena.cy + Math.sin(angle) * inner;
	const outer = bellClashPointInZone(
		arena,
		ball,
		angle,
		BELL_CLASH_ZONE_OUTER_T,
	);

	zoneGfx.lineStyle(Math.max(5, 7 * arena.scale), color, 0.16);
	zoneGfx.lineBetween(x0, y0, outer.x, outer.y);
	zoneGfx.lineStyle(Math.max(1, 1.5 * arena.scale), color, 0.72);
	zoneGfx.lineBetween(x0, y0, outer.x, outer.y);
}

function bellClashPointOnEllipse(
	arena: ArenaPixels,
	angle: number,
	inset: number,
): { x: number; y: number } {
	const rx = Math.max(1, arena.rx + inset);
	const ry = Math.max(1, arena.ry + inset);
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const scaleFactor =
		1 / Math.sqrt((cos * cos) / (rx * rx) + (sin * sin) / (ry * ry));
	return {
		x: arena.cx + cos * scaleFactor,
		y: arena.cy + sin * scaleFactor,
	};
}

export function bellClashRadius(arena: ArenaPixels): number {
	return BELL_CLASH_BELL_RADIUS_SRC * arena.scale;
}

// ── Bell drawing ─────────────────────────────────────────────────────────────

export function preloadBellClashBell(scene: Phaser.Scene): void {
	if (!scene.textures.exists(BELL_TEXTURE_KEY))
		scene.load.image(BELL_TEXTURE_KEY, BELL_TEXTURE_PATH);
}

export function createBellClashBell(
	scene: Phaser.Scene,
	arena: ArenaPixels,
): Phaser.GameObjects.Image {
	return scene.add
		.image(arena.cx, arena.cy, BELL_TEXTURE_KEY)
		.setOrigin(0.5)
		.setDepth(DEPTH_BELL);
}

export function layoutBellClashBell(
	bell: Phaser.GameObjects.Image,
	arena: ArenaPixels,
	bellPulseMs: number,
): void {
	const r = bellClashRadius(arena);
	const pulse = bellPulseMs > 0 ? 1 + (bellPulseMs / 180) * 0.08 : 1;
	bell.setPosition(arena.cx, arena.cy).setDisplaySize(
		r * 2 * pulse,
		r * 2 * pulse,
	);
}

// ── Trail drawing ────────────────────────────────────────────────────────────

export function drawBellClashBallTrail(
	ballGfx: Phaser.GameObjects.Graphics,
	trail: Array<{ x: number; y: number }>,
	colour: number,
): void {
	const count = trail.length;
	for (let i = 1; i < count; i++) {
		const p0 = trail[i - 1];
		const p1 = trail[i];
		const alpha = (i / count) * 0.5;
		ballGfx.lineStyle(4, colour, alpha);
		ballGfx.lineBetween(p0.x, p0.y, p1.x, p1.y);
	}
}

// ── Power ball rendering ─────────────────────────────────────────────────────

export function clearBellClashPowerBalls(
	scene: Phaser.Scene,
	powerBalls: ArenaPowerRuntime,
	powerBallTexCount: number,
): number {
	clearArenaPowerBallTextures(scene, "bell-clash-pb", powerBallTexCount);
	powerBalls.clear();
	return 0;
}

export function drawBellClashPowerBalls(
	scene: Phaser.Scene,
	ballGfx: Phaser.GameObjects.Graphics,
	powerBalls: ArenaPowerRuntime,
	powerBallTexCount: number,
	playerShellSkins: string[],
): number {
	return drawArenaPowerBalls(
		scene,
		ballGfx,
		powerBalls.all(),
		powerBallTexCount,
		{
			prefix: "bell-clash-pb",
			depth: DEPTH_BALL,
			playerShellSkins,
			colourForPlayer: (player) =>
				PLAYER_COLOUR_VALUES[player % PLAYER_COLOUR_VALUES.length] ??
				THEME.gold,
		},
	);
}

// ── Score popup ──────────────────────────────────────────────────────────────

export function popBellClashScore(
	scene: Phaser.Scene,
	x: number,
	y: number,
	label: string,
	color: string,
): void {
	const text = scene.add
		.text(x, y, label, {
			fontSize: "27px",
			color,
			fontFamily: THEME.fontBlowbrush,
			fontStyle: "bold",
			stroke: "#10150f",
			strokeThickness: 4,
		})
		.setOrigin(0.5)
		.setDepth(DEPTH_FX)
		.setShadow(0, 3, "rgba(8, 18, 11, 0.85)", 3);
	scene.tweens.add({
		targets: text,
		y: y - 52,
		alpha: 0,
		duration: 720,
		ease: "Cubic.easeOut",
		onComplete: () => text.destroy(),
	});
}

// ── Zone icon (used in side panel) ───────────────────────────────────────────

export function drawBellClashZoneIcon(
	g: Phaser.GameObjects.Graphics,
	x: number,
	y: number,
	size: number,
	color: number,
): void {
	const r = size * 0.46;
	const startA = -Math.PI * 0.75;
	const endA = -Math.PI * 0.25;
	const steps = 10;

	g.fillStyle(color, 0.35);
	g.beginPath();
	g.moveTo(x, y);
	for (let i = 0; i <= steps; i++) {
		const a = startA + (endA - startA) * (i / steps);
		g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
	}
	g.closePath();
	g.fillPath();

	g.lineStyle(Math.max(1.5, size * 0.07), color, 0.9);
	g.beginPath();
	for (let i = 0; i <= steps; i++) {
		const a = startA + (endA - startA) * (i / steps);
		const px = x + Math.cos(a) * r;
		const py = y + Math.sin(a) * r;
		if (i === 0) g.moveTo(px, py);
		else g.lineTo(px, py);
	}
	g.strokePath();
}

// re-export types used by the scene
export type { ArenaPixels } from "../../shared/arenas/arena";
export type { BallState } from "../../shared/mechanics/ball";
