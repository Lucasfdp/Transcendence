import Phaser from "phaser";

export const BUMPER_FLASH_MS = 130;

export function drawBumper(
	gfx: Phaser.GameObjects.Graphics,
	x: number,
	y: number,
	radius: number,
	scale: number,
	flashTimer = 0,
): void {
	const flashing = flashTimer > 0;
	if (flashing) {
		const glowAlpha = (flashTimer / BUMPER_FLASH_MS) * 0.55;
		gfx.fillStyle(0xffd700, glowAlpha);
		gfx.fillCircle(x, y, radius * 1.75);
	}

	gfx.fillStyle(0x2a1a08, 1);
	gfx.fillCircle(x, y, radius);
	gfx.lineStyle(Math.max(1.5, 2.5 * scale), 0xd4a843, flashing ? 1 : 0.85);
	gfx.strokeCircle(x, y, radius);
	gfx.fillStyle(0xd4a843, flashing ? 1 : 0.6);
	gfx.fillCircle(x, y, radius * 0.22);
}
