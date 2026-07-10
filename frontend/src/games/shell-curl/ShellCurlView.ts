/**
 * ShellCurlView — drawing/rendering functions for Shell Curl.
 *
 * Extracted from ShellCurlScene to keep the scene focused on lifecycle
 * and coordination. Each function takes its minimum required dependencies.
 */

import Phaser from "phaser";
import { THEME } from "../../shared/theme";
import { PowerType } from "../../shared/mechanics/power-system";
import { ALL_POWERS } from "../../shared/mechanics/power-system";
import { drawIngameShellTexture } from "../../shared/mechanics/player-renderer";
import {
	resolveObstaclePosition,
	resolveObstacleRadius,
	buildCircularObstacleDescriptor,
} from "../../shared/mechanics/obstacle-descriptor";
import type { StoneState } from "../../shared/mechanics/ball";
import type { RectArenaPixels } from "../../shared/mechanics/rect-arena";
import type { ArenaBallTrailRuntime } from "../common";
import type { PowerPickupManager } from "../../shared/mechanics/power-pickups";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEPTH_STONES = 2;
const DEPTH_HUD = 20;
const BUMPER_FLASH_MS = 130;

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
	arena: RectArenaPixels,
	width: number,
	height: number,
): void {
	const a = arena;
	bgGfx.clear();

	bgGfx.fillStyle(0x0c0a07, 0.58);
	bgGfx.fillRect(0, 0, width, height);

	if (a.orientation === "horizontal") {
		const lanternY = a.sheetY - Math.max(8, a.sheetY * 0.35);
		const fanCX = a.houseFarCX;
		if (a.sheetY > 20) {
			drawShellCurlPaperLantern(
				bgGfx,
				fanCX - 50 * a.scale,
				lanternY,
				0,
				a.scale,
			);
			drawShellCurlPaperLantern(
				bgGfx,
				fanCX + 50 * a.scale,
				lanternY,
				1,
				a.scale,
			);
		}
	} else {
		const lanternY = a.sheetY * 0.48;
		if (a.sheetY > 28 * a.scale) {
			drawShellCurlPaperLantern(
				bgGfx,
				a.sheetX + a.sheetW * 0.27,
				lanternY,
				0,
				a.scale,
			);
			drawShellCurlPaperLantern(
				bgGfx,
				a.sheetX + a.sheetW * 0.73,
				lanternY,
				1,
				a.scale,
			);
		}
	}

	const bw = Math.max(3, 5 * a.scale);
	bgGfx.fillStyle(0x1c1208, 1);
	bgGfx.fillRect(a.sheetX - bw, a.sheetY - bw, a.sheetW + bw * 2, bw);
	bgGfx.fillRect(
		a.sheetX - bw,
		a.sheetY + a.sheetH,
		a.sheetW + bw * 2,
		bw,
	);
	bgGfx.fillRect(a.sheetX - bw, a.sheetY, bw, a.sheetH);
	bgGfx.fillRect(a.sheetX + a.sheetW, a.sheetY, bw, a.sheetH);

	const vigH = Math.max(16, 24 * a.scale);
	for (let i = 0; i < 5; i++) {
		const band = vigH * (1 - i / 5);
		bgGfx.fillStyle(0x000000, 0.07 * (5 - i));
		bgGfx.fillRect(0, 0, width, band);
		bgGfx.fillRect(0, height - band, width, band);
	}
}

function drawShellCurlPaperLantern(
	bgGfx: Phaser.GameObjects.Graphics,
	x: number,
	y: number,
	variant: number,
	scale: number,
): void {
	const lw = Math.max(15, 22 * scale);
	const lh = Math.max(21, 30 * scale);

	bgGfx.lineStyle(Math.max(1, 1 * scale), 0x5a4530, 0.55);
	bgGfx.lineBetween(x, 0, x, y - lh * 0.52);

	const glowColor = variant === 0 ? 0xff5500 : 0xffaa00;
	bgGfx.fillStyle(glowColor, 0.07);
	bgGfx.fillCircle(x, y, lh * 1.3);

	const bodyColor = variant === 0 ? 0xb01818 : 0xcc8800;
	bgGfx.fillStyle(bodyColor, 0.82);
	bgGfx.fillEllipse(x, y, lw, lh);

	bgGfx.lineStyle(Math.max(1, 1 * scale), 0x000000, 0.16);
	for (let i = -2; i <= 2; i++) {
		const ry = y + i * lh * 0.14;
		const hw =
			Math.sqrt(Math.max(0, 1 - Math.pow(i / 2.8, 2))) * lw * 0.5;
		bgGfx.lineBetween(x - hw, ry, x + hw, ry);
	}

	bgGfx.fillStyle(0xffdd88, 0.24);
	bgGfx.fillEllipse(x, y, lw * 0.52, lh * 0.52);

	const capH = Math.max(3, 4.5 * scale);
	const capW = lw * 0.54;
	bgGfx.fillStyle(0x1c1208, 0.92);
	bgGfx.fillRect(x - capW / 2, y - lh * 0.5 - capH, capW, capH);
	bgGfx.fillRect(x - capW / 2, y + lh * 0.5, capW, capH);
}

// ── Stone drawing ─────────────────────────────────────────────────────────────

export function drawShellCurlStone(
	gfx: Phaser.GameObjects.Graphics,
	stone: StoneState,
	isActive: boolean,
	playerShellSkins: string[],
	scene: Phaser.Scene,
): void {
	if (
		!drawIngameShellTexture(
			scene,
			`shell-curl-player-${stone.id}`,
			stone,
			DEPTH_STONES,
			playerShellSkins[stone.teamId],
		)
	) {
		drawShellCurlShellFallback(gfx, stone, isActive);
		return;
	}

	gfx.clear();
	if (isActive) {
		gfx.lineStyle(3, 0xd4a843, 0.6);
		gfx.strokeCircle(stone.x, stone.y, stone.r * 1.45);
	}
	if (stone.frozen) {
		gfx.fillStyle(0x88ccff, 0.3);
		gfx.fillCircle(stone.x, stone.y, stone.r * 1.15);
	}
	if (stone.power !== PowerType.NONE) {
		gfx.lineStyle(2, THEME.gold, 0.85);
		gfx.strokeCircle(
			stone.x + stone.r * 0.62,
			stone.y - stone.r * 0.62,
			Math.max(4, stone.r * 0.18),
		);
	}
}

export function drawShellCurlShellFallback(
	gfx: Phaser.GameObjects.Graphics,
	stone: StoneState,
	isActive: boolean,
): void {
	const { x, y, r } = stone;
	gfx.clear();
	if (isActive) {
		gfx.lineStyle(3, 0xd4a843, 0.6);
		gfx.strokeCircle(x, y, r * 1.45);
	}

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

	if (stone.frozen) {
		gfx.fillStyle(0x88ccff, 0.3);
		gfx.fillCircle(x, y, r * 1.15);
	}
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
		const flashing = b.flashTimer > 0;

		if (flashing) {
			const glowAlpha = (b.flashTimer / BUMPER_FLASH_MS) * 0.55;
			bumperGfx.fillStyle(0xffd700, glowAlpha);
			bumperGfx.fillCircle(position.x, position.y, radius * 1.75);
		}

		bumperGfx.fillStyle(0x2a1a08, 1);
		bumperGfx.fillCircle(position.x, position.y, radius);

		const ringAlpha = flashing ? 1.0 : 0.85;
		bumperGfx.lineStyle(
			Math.max(1.5, 2.5 * arena.scale),
			0xd4a843,
			ringAlpha,
		);
		bumperGfx.strokeCircle(position.x, position.y, radius);

		bumperGfx.fillStyle(0xd4a843, flashing ? 1.0 : 0.6);
		bumperGfx.fillCircle(position.x, position.y, radius * 0.22);
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

// ── Stone trails ──────────────────────────────────────────────────────────────

export function recordShellCurlStoneTrails(
	stoneTrails: ArenaBallTrailRuntime,
	stones: StoneState[],
	arena: RectArenaPixels,
): void {
	stoneTrails.recordSet({
		balls: stones.map((stone) => ({
			id: stone.id,
			player: stone.teamId,
			ball: stone,
		})),
		isMoving: (stone) => !(stone as StoneState).stopped,
		trailOptions: { scale: arena.scale },
	});
}

export function drawShellCurlStoneTrails(
	stoneTrails: ArenaBallTrailRuntime,
	trailGfx: Phaser.GameObjects.Graphics,
	stonePlayersById: Map<number | string, number>,
	arena: RectArenaPixels,
): void {
	stoneTrails.draw(trailGfx, stonePlayersById, {
		scale: arena.scale,
	});
}

// ── Scoring animation ─────────────────────────────────────────────────────────

export function animateShellCurlScoringStones(
	scene: Phaser.Scene,
	stones: StoneState[],
	stoneGfx: Map<number, Phaser.GameObjects.Graphics>,
	teamId: number,
	arena: RectArenaPixels,
	isStoneInHouse: (stone: StoneState, arena: RectArenaPixels) => boolean,
): void {
	for (const s of stones) {
		if (s.teamId !== teamId || !isStoneInHouse(s, arena)) continue;
		const gfx = stoneGfx.get(s.id);
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
