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
import { clearArenaPowerBallTextures, drawArenaPowerBalls } from "../../shared/mechanics/arena-power-runtime.render";
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
	red: { color: THEME.red, label: "RED", multiplier: 0.5 },
	yellow: { color: THEME.gold, label: "YELLOW", multiplier: 1.5 },
	green: { color: 0x4aa564, label: "GREEN", multiplier: 2 },
};

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

	const ringStep = Math.max(38, Math.round(90 * arena.scale));
	bgGfx.lineStyle(1, 0x3b2c18, 0.42);
	for (let x = 0; x < width; x += ringStep)
		bgGfx.lineBetween(x, 0, x, height);
	for (let y = 0; y < height; y += ringStep)
		bgGfx.lineBetween(0, y, width, y);

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
	for (const zone of zones)
		drawBellClashZone(zoneGfx, zone, arena, ball);
}

function drawBellClashZone(
	zoneGfx: Phaser.GameObjects.Graphics,
	zone: ScoreZone,
	arena: ArenaPixels,
	ball: BallState,
): void {
	const points = bellClashZonePolygonPoints(zone.start, zone.end, arena, ball);
	const def = ZONE_DEFS[zone.kind];
	if (points.length < 3) return;

	zoneGfx.fillStyle(def.color, 0.28);
	zoneGfx.beginPath();
	zoneGfx.moveTo(points[0].x, points[0].y);
	for (const point of points.slice(1))
		zoneGfx.lineTo(point.x, point.y);
	zoneGfx.closePath();
	zoneGfx.fillPath();

	zoneGfx.lineStyle(Math.max(1, 2 * arena.scale), def.color, 0.55);
	zoneGfx.beginPath();
	zoneGfx.moveTo(points[0].x, points[0].y);
	for (const point of points.slice(1))
		zoneGfx.lineTo(point.x, point.y);
	zoneGfx.closePath();
	zoneGfx.strokePath();
}

function bellClashZonePolygonPoints(
	start: number,
	end: number,
	arena: ArenaPixels,
	ball: BallState,
): Array<{ x: number; y: number }> {
	const points: Array<{ x: number; y: number }> = [];
	const inner = bellClashRadius(arena) * 0.74;
	const segments = 18;

	for (let i = 0; i <= segments; i++) {
		const angle = start + (end - start) * (i / segments);
		points.push(bellClashPointOnEllipse(arena, angle, -ball.r * 0.3));
	}
	for (let i = segments; i >= 0; i--) {
		const angle = start + (end - start) * (i / segments);
		points.push({
			x: arena.cx + Math.cos(angle) * inner,
			y: arena.cy + Math.sin(angle) * inner,
		});
	}
	return points;
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
	return Math.min(arena.rx, arena.ry) * 1.05;
}

// ── Bell drawing ─────────────────────────────────────────────────────────────

export function drawBellClashBell(
	bellGfx: Phaser.GameObjects.Graphics,
	arena: ArenaPixels,
	bellPulseMs: number,
): void {
	const r = bellClashRadius(arena);
	const pulse =
		bellPulseMs > 0 ? 1 + (bellPulseMs / 180) * 0.08 : 1;
	const x = arena.cx;
	const y = arena.cy;
	const bodyR = r * pulse;
	const lineW = Math.max(3, bodyR * 0.055);

	bellGfx.clear();
	bellGfx.fillStyle(0x000000, 0.28);
	bellGfx.fillEllipse(x + r * 0.18, y + r * 0.48, r * 2.28, r * 0.7);

	bellGfx.fillStyle(0x5a3410, 1);
	bellGfx.fillCircle(x, y, bodyR * 1.03);
	bellGfx.lineStyle(Math.max(4, bodyR * 0.045), 0xf2d47a, 0.4);
	bellGfx.strokeCircle(x, y, bodyR * 1.02);

	bellGfx.fillStyle(0x8a5516, 1);
	bellClashTraceBellBody(bellGfx, x, y, bodyR, 0.96, 0.76, 0.9, 0.78);
	bellGfx.fillPath();

	bellGfx.fillStyle(0xd4a843, 1);
	bellClashTraceBellBody(bellGfx, x, y, bodyR, 0.78, 0.61, 0.72, 0.6);
	bellGfx.fillPath();

	bellGfx.fillStyle(0xf2d47a, 0.68);
	bellGfx.fillEllipse(
		x - bodyR * 0.28,
		y - bodyR * 0.25,
		bodyR * 0.42,
		bodyR * 0.34,
	);
	bellGfx.fillStyle(0xb87922, 0.55);
	bellGfx.fillEllipse(
		x + bodyR * 0.36,
		y + bodyR * 0.08,
		bodyR * 0.34,
		bodyR * 0.88,
	);

	bellGfx.lineStyle(lineW, 0x6e3f10, 0.96);
	bellClashTraceBellBody(bellGfx, x, y, bodyR, 0.96, 0.76, 0.9, 0.78);
	bellGfx.strokePath();

	bellGfx.lineStyle(Math.max(3, bodyR * 0.045), 0x5a3410, 0.86);
	bellGfx.lineBetween(
		x - bodyR * 0.78,
		y + bodyR * 0.44,
		x + bodyR * 0.78,
		y + bodyR * 0.44,
	);
	bellGfx.lineBetween(
		x - bodyR * 0.63,
		y + bodyR * 0.14,
		x + bodyR * 0.63,
		y + bodyR * 0.14,
	);

	bellGfx.fillStyle(0x5a3410, 1);
	bellGfx.fillRoundedRect(
		x - bodyR * 0.22,
		y - bodyR * 0.98,
		bodyR * 0.44,
		bodyR * 0.23,
		bodyR * 0.08,
	);
	bellGfx.fillStyle(0x3c230c, 1);
	bellGfx.fillCircle(x, y + bodyR * 0.18, bodyR * 0.11);
	bellGfx.lineStyle(Math.max(2, bodyR * 0.03), 0xf2d47a, 0.7);
	bellGfx.strokeCircle(x, y + bodyR * 0.18, bodyR * 0.2);
}

function bellClashTraceBellBody(
	bellGfx: Phaser.GameObjects.Graphics,
	x: number,
	y: number,
	r: number,
	bottomHalfW: number,
	topHalfW: number,
	bottomArcH: number,
	topArcH: number,
): void {
	const topY = y - r * 0.38;
	const bottomY = y + r * 0.58;
	const arcSegments = 14;

	bellGfx.beginPath();
	bellGfx.moveTo(x - r * topHalfW, topY);
	bellGfx.lineTo(x - r * bottomHalfW, bottomY);

	for (let i = 1; i <= arcSegments; i++) {
		const t = i / arcSegments;
		const px = x - r * bottomHalfW + r * bottomHalfW * 2 * t;
		const py =
			bottomY + Math.sin(t * Math.PI) * r * (bottomArcH - 0.58);
		bellGfx.lineTo(px, py);
	}

	bellGfx.lineTo(x + r * topHalfW, topY);

	for (let i = 1; i <= arcSegments; i++) {
		const t = i / arcSegments;
		const px = x + r * topHalfW - r * topHalfW * 2 * t;
		const py = topY - Math.sin(t * Math.PI) * r * (topArcH - 0.38);
		bellGfx.lineTo(px, py);
	}

	bellGfx.closePath();
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
	return drawArenaPowerBalls(scene, ballGfx, powerBalls.all(), powerBallTexCount, {
		prefix: "bell-clash-pb",
		depth: DEPTH_BALL,
		playerShellSkins,
		colourForPlayer: (player) =>
			PLAYER_COLOUR_VALUES[player % PLAYER_COLOUR_VALUES.length] ??
			THEME.gold,
		ringScale: 1.08,
	});
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
