/**
 * ShellCurlView — drawing/rendering functions for Shell Curl.
 *
 * Extracted from ShellCurlScene to keep the scene focused on lifecycle
 * and coordination. Each function takes its minimum required dependencies.
 */

import Phaser from "phaser";
import { drawPlayerRing, PLAYER_COLOUR_VALUES } from "../../shared/game-ui";
import { THEME } from "../../shared/theme";
import { PowerType } from "../../shared/mechanics/power-system";
import { ALL_POWERS } from "../../shared/mechanics/power-system";
import { drawIngamePlayerTexture } from "../../shared/mechanics/player-renderer";
import {
	resolveObstaclePosition,
	resolveObstacleRadius,
	buildCircularObstacleDescriptor,
} from "../../shared/mechanics/obstacle-descriptor";
import type { CurlingBallState } from "../../shared/mechanics/ball";
import type { RectArenaPixels } from "../../shared/mechanics/rect-arena";
import type { ArenaBallTrailRuntime } from "../common";
import type { PowerPickupManager } from "../../shared/mechanics/power-pickups";
import {
	BUMPER_FLASH_MS,
	drawBumper,
} from "../../shared/mechanics/bumper-renderer";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEPTH_BALLS = 2;
const DEPTH_HUD = 20;
export { BUMPER_FLASH_MS };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Bumper {
	x: number;
	y: number;
	r: number;
	readonly fx: number;
	readonly fy: number;
	flashTimer: number;
}

// ── Background ────────────────────────────────────────────────────────────────

export function drawShellCurlBackground(
	bgGfx: Phaser.GameObjects.Graphics,
	_arena: RectArenaPixels,
	width: number,
	height: number,
): void {
	bgGfx.clear();

	bgGfx.fillStyle(0x0c0a07, 0.58);
	bgGfx.fillRect(0, 0, width, height);
}

// ── Ball drawing ─────────────────────────────────────────────────────────────

export function drawShellCurlBall(
	gfx: Phaser.GameObjects.Graphics,
	ball: CurlingBallState,
	isActive: boolean,
	playerShellSkins: string[],
	scene: Phaser.Scene,
	depth = DEPTH_BALLS,
): void {
	if (
		!drawIngamePlayerTexture(
			scene,
			`shell-curl-player-${ball.id}`,
			ball,
			depth,
			playerShellSkins[ball.teamId],
			{ initialRotation: Math.PI / 2 },
		)
	) {
		drawShellCurlShellFallback(gfx, ball, isActive);
		return;
	}

	gfx.clear();
	drawPlayerRing(
		gfx,
		ball.x,
		ball.y,
		ball.r,
		PLAYER_COLOUR_VALUES[ball.teamId % PLAYER_COLOUR_VALUES.length],
		1,
		isActive,
	);
	if (ball.frozen) {
		gfx.fillStyle(0x88ccff, 0.3);
		gfx.fillCircle(ball.x, ball.y, ball.r * 1.15);
	}
	if (ball.power !== PowerType.NONE) {
		gfx.lineStyle(2, THEME.gold, 0.85);
		gfx.strokeCircle(
			ball.x + ball.r * 0.62,
			ball.y - ball.r * 0.62,
			Math.max(4, ball.r * 0.18),
		);
	}
}

export function drawShellCurlShellFallback(
	gfx: Phaser.GameObjects.Graphics,
	ball: CurlingBallState,
	isActive: boolean,
): void {
	const { x, y, r } = ball;
	gfx.clear();
	gfx.fillStyle(0x000000, 0.22);
	gfx.fillEllipse(x + r * 0.22, y + r * 0.34, r * 2.25, r * 0.72);
	gfx.fillStyle(0x6f8f3d, 1);
	gfx.fillEllipse(x, y, r * 2.05, r * 1.72);
	gfx.lineStyle(Math.max(2, r * 0.1), 0x26320f, 0.85);
	gfx.strokeEllipse(x, y, r * 2.05, r * 1.72);
	gfx.lineStyle(Math.max(1, r * 0.055), 0xd4a843, 0.78);
	gfx.beginPath();
	gfx.arc(x, y, r * 0.68, Math.PI * 0.12, Math.PI * 0.88);
	gfx.strokePath();
	gfx.lineBetween(x, y - r * 0.82, x, y + r * 0.8);

	if (ball.frozen) {
		gfx.fillStyle(0x88ccff, 0.3);
		gfx.fillCircle(x, y, r * 1.15);
	}
	drawPlayerRing(
		gfx,
		x,
		y,
		r,
		PLAYER_COLOUR_VALUES[ball.teamId % PLAYER_COLOUR_VALUES.length],
		1,
		isActive,
	);
}

// ── Bumpers ───────────────────────────────────────────────────────────────────

export function drawShellCurlBumpers(
	bumperGfx: Phaser.GameObjects.Graphics,
	bumpers: Bumper[],
	arena: RectArenaPixels,
): void {
	bumperGfx.clear();
	for (const b of bumpers) {
		const descriptor = buildCircularObstacleDescriptor({
			id: `${b.fx}:${b.fy}`,
			type: "bumper",
			position: { mode: "absolute", x: b.x, y: b.y },
			radius: b.r,
			radiusUnit: "pixels",
			collision: { blocks: true, bounces: true },
			rendering: {
				fx: b.fx,
				fy: b.fy,
				flashTimer: b.flashTimer,
			},
		});
		const position = resolveObstaclePosition(descriptor);
		const radius = resolveObstacleRadius(descriptor) ?? b.r;
		drawBumper(
			bumperGfx,
			position.x,
			position.y,
			radius,
			arena.scale,
			b.flashTimer,
		);
	}
}

// ── Power pickups ─────────────────────────────────────────────────────────────

export function drawShellCurlPowerPickups(
	powerupsEnabled: boolean,
	powerPickups: PowerPickupManager | null,
): void {
	if (!powerupsEnabled) {
		powerPickups?.clear();
		return;
	}
	powerPickups?.draw();
}

export function showShellCurlPowerPickupNotice(
	scene: Phaser.Scene,
	type: PowerType,
	x: number,
	y: number,
	arena: RectArenaPixels,
): void {
	const def = ALL_POWERS[type];
	const label = scene.add
		.text(x, y - 34 * arena.scale, `POWER UP\n${def.label}`, {
			fontSize: `${Math.max(18, 28 * arena.scale)}px`,
			color: "#fff7d6",
			fontFamily: THEME.font,
			fontStyle: "bold",
			align: "center",
			stroke: "#171008",
			strokeThickness: 4,
		})
		.setOrigin(0.5)
		.setDepth(DEPTH_HUD + 4)
		.setShadow(0, 3, "rgba(8, 18, 11, 0.85)", 3);

	scene.tweens.add({
		targets: label,
		y: label.y - 46 * arena.scale,
		alpha: 0,
		duration: 950,
		ease: "Cubic.easeOut",
		onComplete: () => label.destroy(),
	});
}

export function showShellCurlSplitterNotice(
	scene: Phaser.Scene,
	x: number,
	y: number,
	arena: RectArenaPixels,
): void {
	const text = scene.add
		.text(x, y - 42 * arena.scale, "SPLIT!", {
			fontSize: `${Math.max(18, 30 * arena.scale)}px`,
			color: "#fff7d6",
			fontFamily: THEME.font,
			fontStyle: "bold",
			stroke: "#171008",
			strokeThickness: 4,
		})
		.setOrigin(0.5)
		.setDepth(DEPTH_HUD + 5)
		.setShadow(0, 3, "rgba(8, 18, 11, 0.85)", 3);

	scene.tweens.add({
		targets: text,
		y: text.y - 42 * arena.scale,
		alpha: 0,
		duration: 850,
		ease: "Cubic.easeOut",
		onComplete: () => text.destroy(),
	});
}

// ── Ball trails ──────────────────────────────────────────────────────────────

export function recordShellCurlBallTrails(
	ballTrails: ArenaBallTrailRuntime,
	balls: CurlingBallState[],
	arena: RectArenaPixels,
): void {
	ballTrails.recordSet({
		balls: balls.map((ball) => ({
			id: ball.id,
			player: ball.teamId,
			ball: ball,
		})),
		isMoving: (ball) => !(ball as CurlingBallState).stopped,
		trailOptions: { scale: arena.scale },
	});
}

export function drawShellCurlBallTrails(
	ballTrails: ArenaBallTrailRuntime,
	trailGfx: Phaser.GameObjects.Graphics,
	ballPlayersById: Map<number | string, number>,
	arena: RectArenaPixels,
): void {
	ballTrails.draw(trailGfx, ballPlayersById, {
		scale: arena.scale,
	});
}

// ── Scoring animation ─────────────────────────────────────────────────────────

export function animateShellCurlScoringBalls(
	scene: Phaser.Scene,
	balls: CurlingBallState[],
	ballGfx: Map<number, Phaser.GameObjects.Graphics>,
	teamId: number,
	arena: RectArenaPixels,
	isBallInHouse: (ball: CurlingBallState, arena: RectArenaPixels) => boolean,
): void {
	for (const s of balls) {
		if (s.teamId !== teamId || !isBallInHouse(s, arena)) continue;
		const gfx = ballGfx.get(s.id);
		if (!gfx) continue;
		scene.tweens.add({
			targets: gfx,
			alpha: 0.3,
			duration: 200,
			ease: "Sine.easeInOut",
			yoyo: true,
			repeat: 4,
			onComplete: () => {
				gfx.setAlpha(1);
			},
		});
	}
}
