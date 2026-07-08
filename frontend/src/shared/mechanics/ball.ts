import Phaser from "phaser";
export * from "./ball-core";
import type { BallState } from "./ball-core";

// ── Rendering ─────────────────────────────────────────────────────────────────

/** Draw the turtle-shell ball at its current position. Clears `g` first by default. */
export function drawShellBall(
	g: Phaser.GameObjects.Graphics,
	b: BallState,
	clear = true,
): void {
	const { x, y, r } = b;
	if (clear) g.clear();

	// Drop shadow
	g.fillStyle(0x000000, 0.22);
	g.fillEllipse(x + r * 0.3, y + r * 0.5, r * 2.4, r * 0.9);

	// Shell body
	g.fillStyle(0x2a7fd4, 1);
	g.fillCircle(x, y, r);

	// Dark shell-plate segments
	g.fillStyle(0x1a5fa8, 1);
	g.fillCircle(x + r * 0.25, y - r * 0.12, r * 0.38);
	g.fillCircle(x - r * 0.22, y + r * 0.28, r * 0.3);
	g.fillCircle(x + r * 0.08, y + r * 0.52, r * 0.22);

	// Specular highlight
	g.fillStyle(0xffffff, 0.55);
	g.fillCircle(x - r * 0.28, y - r * 0.3, r * 0.22);
}
