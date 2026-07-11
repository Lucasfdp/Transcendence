/**
 * KameKnockView — drawing/rendering functions for Kame Knock.
 *
 * Extracted from KameKnockScene to keep the scene focused on lifecycle
 * and coordination. Each function takes its minimum required dependencies.
 */

import Phaser from "phaser";
import type { ArenaPixels } from "../../shared/arenas/arena";
import { layoutOvalArenaSkin } from "../../shared/arenas/arena";
import { THEME } from "../../shared/theme";
import { PowerType } from "../../shared/mechanics/power-system";
import { clearArenaPowerBallTextures, drawArenaPowerBalls } from "../../shared/mechanics/arena-power-runtime.render";
import type { ArenaPowerRuntime } from "../../shared/mechanics/arena-power-runtime";

// ── Constants ────────────────────────────────────────────────────────────────

const DEPTH_HUD = 20;
const DEPTH_FX = 5;
const DEPTH_BALL = 4;

// ── Background ───────────────────────────────────────────────────────────────

export function drawKameKnockBackground(
	bgGfx: Phaser.GameObjects.Graphics,
	arenaSkin: Phaser.GameObjects.Image,
	arena: ArenaPixels,
	width: number,
	height: number,
): void {
	bgGfx.clear();
	bgGfx.fillStyle(THEME.background, 0.62);
	bgGfx.fillRect(0, 0, width, height);

	layoutOvalArenaSkin(arenaSkin, arena);
}

// ── Power ball rendering ─────────────────────────────────────────────────────

export function clearKameKnockPowerBalls(
	scene: Phaser.Scene,
	powerBalls: ArenaPowerRuntime,
	powerBallTexCount: number,
): number {
	clearArenaPowerBallTextures(scene, "kame-knock-pb", powerBallTexCount);
	powerBalls.clear();
	return 0;
}

export function drawKameKnockPowerBalls(
	scene: Phaser.Scene,
	ballGfx: Phaser.GameObjects.Graphics,
	powerBalls: ArenaPowerRuntime,
	powerBallTexCount: number,
	playerShellSkins: string[],
): number {
	return drawArenaPowerBalls(scene, ballGfx, powerBalls.all(), powerBallTexCount, {
		prefix: "kame-knock-pb",
		depth: DEPTH_BALL,
		playerShellSkins,
		colourForPlayer: () => THEME.gold,
	});
}

// ── Trail drawing ────────────────────────────────────────────────────────────

export function drawKameKnockBallTrail(
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

// ── Bounce popup ─────────────────────────────────────────────────────────────

export function popKameKnockBounce(
	scene: Phaser.Scene,
	x: number,
	y: number,
): void {
	const text = scene.add
		.text(x, y, "BOUNCE", {
			fontSize: "16px",
			color: "#9aa4b8",
			fontFamily: THEME.font,
			fontStyle: "bold",
		})
		.setOrigin(0.5)
		.setDepth(DEPTH_FX);
	scene.tweens.add({
		targets: text,
		y: y - 34,
		alpha: 0,
		duration: 420,
		ease: "Cubic.easeOut",
		onComplete: () => text.destroy(),
	});
}

// ── Score popup ──────────────────────────────────────────────────────────────

export function popKameKnockScore(
	scene: Phaser.Scene,
	x: number,
	y: number,
	points: number,
	combo: number,
	perfect: boolean,
): void {
	const label = perfect ? `PERFECT +${points}` : `+${points}  x${combo}`;
	const text = scene.add
		.text(x, y, label, {
			fontSize: perfect ? "30px" : "25px",
			color: perfect ? THEME.textGold : THEME.textJade,
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
		y: y - 48,
		alpha: 0,
		duration: 700,
		ease: "Cubic.easeOut",
		onComplete: () => text.destroy(),
	});
}

// ── Power pickup notice ──────────────────────────────────────────────────────

export function showKameKnockPowerPickupNotice(
	scene: Phaser.Scene,
	type: PowerType,
	x: number,
	y: number,
	arena: ArenaPixels,
): void {
	const label = scene.add
		.text(
			x,
			y - 34 * arena.scale,
			`POWER UP\n${type.toUpperCase()}`,
			{
				fontSize: `${Math.max(18, 28 * arena.scale)}px`,
				color: "#fff7d6",
				fontFamily: THEME.font,
				fontStyle: "bold",
				align: "center",
				stroke: "#171008",
				strokeThickness: 4,
			},
		)
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

// ── Shell icon ───────────────────────────────────────────────────────────────

export function drawKameKnockShellIcon(
	g: Phaser.GameObjects.Graphics,
	x: number,
	y: number,
	radius: number,
): void {
	g.fillStyle(0x000000, 0.22);
	g.fillEllipse(
		x + radius * 0.3,
		y + radius * 0.5,
		radius * 2.4,
		radius * 0.9,
	);
	g.fillStyle(0x2a7fd4, 1);
	g.fillCircle(x, y, radius);
	g.fillStyle(0x1a5fa8, 1);
	g.fillCircle(x + radius * 0.25, y - radius * 0.12, radius * 0.38);
	g.fillCircle(x - radius * 0.22, y + radius * 0.28, radius * 0.3);
	g.fillCircle(x + radius * 0.08, y + radius * 0.52, radius * 0.22);
	g.fillStyle(0xffffff, 0.55);
	g.fillCircle(x - radius * 0.28, y - radius * 0.3, radius * 0.22);
}
