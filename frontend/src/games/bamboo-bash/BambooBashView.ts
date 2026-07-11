/**
 * BambooBashView — drawing/rendering functions for Bamboo Bash.
 *
 * Extracted from BambooBashScene to keep the scene focused on lifecycle
 * and coordination. Each function takes its minimum required dependencies.
 */

import Phaser from "phaser";
import type { ArenaPixels } from "../../shared/arenas/arena";
import { layoutOvalArenaSkin } from "../../shared/arenas/arena";
import { THEME } from "../../shared/theme";
import { PowerType } from "../../shared/mechanics/power-system";
import { clearArenaPowerBallTextures, drawArenaPowerBalls } from "../../shared/mechanics/arena-power-runtime.render";
import type { ArenaPowerRuntime } from "../../shared/mechanics/arena-power-runtime";
import { PLAYER_COLOUR_VALUES } from "../../shared/game-ui";

// ── Constants ────────────────────────────────────────────────────────────────

const DEPTH_HUD = 20;
const LOCAL_PLAYER_COLOURS = PLAYER_COLOUR_VALUES;

// ── Background ───────────────────────────────────────────────────────────────

export function drawBambooBashBackground(
	bgGfx: Phaser.GameObjects.Graphics,
	arenaSkin: Phaser.GameObjects.Image,
	arena: ArenaPixels,
	width: number,
	height: number,
): void {
	bgGfx.clear();

	bgGfx.fillStyle(0x0a1208, 0.58);
	bgGfx.fillRect(0, 0, width, height);

	layoutOvalArenaSkin(arenaSkin, arena);
}

// ── Power ball rendering ─────────────────────────────────────────────────────

export function clearBambooBashPowerBalls(
	scene: Phaser.Scene,
	powerBalls: ArenaPowerRuntime,
	powerBallTexCount: number,
): number {
	clearArenaPowerBallTextures(scene, "bamboo-bash-pb", powerBallTexCount);
	powerBalls.clear();
	return 0;
}

export function drawBambooBashPowerBalls(
	scene: Phaser.Scene,
	ballGfx: Phaser.GameObjects.Graphics,
	powerBalls: ArenaPowerRuntime,
	powerBallTexCount: number,
	playerShellSkins: string[],
): number {
	return drawArenaPowerBalls(scene, ballGfx, powerBalls.all(), powerBallTexCount, {
		prefix: "bamboo-bash-pb",
		depth: DEPTH_HUD - 17,
		playerShellSkins,
		colourForPlayer: (player) =>
			LOCAL_PLAYER_COLOURS[player % LOCAL_PLAYER_COLOURS.length],
	});
}

// ── Trail drawing ────────────────────────────────────────────────────────────

export function drawBambooBashBallTrail(
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

// ── Score popup ──────────────────────────────────────────────────────────────

export function popBambooBashScore(
	scene: Phaser.Scene,
	x: number,
	y: number,
	points: number,
): void {
	const t = scene.add
		.text(x, y, `+${points}`, {
			fontSize: "27px",
			color: THEME.textGold,
			fontFamily: THEME.fontBlowbrush,
			fontStyle: "bold",
			stroke: "#10150f",
			strokeThickness: 4,
		})
		.setOrigin(0.5)
		.setDepth(4)
		.setShadow(0, 3, "rgba(8, 18, 11, 0.85)", 3);

	scene.tweens.add({
		targets: t,
		y: y - 46,
		alpha: 0,
		duration: 700,
		ease: "Cubic.easeOut",
		onComplete: () => t.destroy(),
	});
}

// ── Power pickup notice ──────────────────────────────────────────────────────

export function showBambooBashPowerPickupNotice(
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
