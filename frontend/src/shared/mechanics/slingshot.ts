/**
 * mechanics/slingshot.ts — reusable drag-to-launch input controller.
 *
 * Pool-cue / Angry-Birds aiming: grab the ball, drag *away* from the target,
 * release to launch in the mirrored direction with speed proportional to the
 * drag distance.
 *
 * Usage:
 *   const sling = new Slingshot(this, ball, { maxDrag: 300, launchSpeed: 1100 });
 *   sling.attach();              // registers pointer handlers, creates gfx
 *   sling.maxDrag = newValue;    // update on resize
 *   sling.destroy();             // in scene shutdown
 */

import Phaser from "phaser";
import { BallState, isBallMoving } from "./ball";

const AIM_SHADOW = 0x071218;
const AIM_BRIGHT = 0x00e5ff;
const AIM_BRIGHT_SOFT = 0x7cf7ff;

export interface SlingshotConfig {
	maxDrag: number; // max pull distance in canvas px
	launchSpeed: number; // canvas px/s at full drag — scale with the arena so
	// power is fair across window sizes
	grabRadiusFactor?: number; // grab zone = ball.r × this (default 3.5)
	depth?: number; // render depth of the aim graphics (default 1)
}

export class Slingshot {
	public maxDrag: number;
	public launchSpeed: number;

	private readonly grabRadiusFactor: number;
	private readonly depth: number;

	private gfx: Phaser.GameObjects.Graphics | null = null;
	private attached = false;
	private dragging = false;
	private origin = { x: 0, y: 0 };
	private dragPt = { x: 0, y: 0 };
	private readonly onWindowPointerUp = (): void => this.onUp();

	constructor(
		private readonly scene: Phaser.Scene,
		private readonly ball: BallState,
		cfg: SlingshotConfig,
		private readonly onLaunch?: (vx: number, vy: number) => void,
	) {
		this.maxDrag = cfg.maxDrag;
		this.launchSpeed = cfg.launchSpeed;
		this.grabRadiusFactor = cfg.grabRadiusFactor ?? 3.5;
		this.depth = cfg.depth ?? 1;
	}

	attach(): void {
		if (this.attached) return;
		this.gfx = this.scene.add.graphics().setDepth(this.depth);
		this.scene.input.on("pointerdown", this.onDown, this);
		this.scene.input.on("pointermove", this.onMove, this);
		this.scene.input.on("pointerup", this.onUp, this);
		this.attached = true;
	}

	destroy(): void {
		if (!this.attached && !this.gfx) return;
		this.scene.input.off("pointerdown", this.onDown, this);
		this.scene.input.off("pointermove", this.onMove, this);
		this.scene.input.off("pointerup", this.onUp, this);
		this.removeWindowReleaseListener();
		this.gfx?.destroy();
		this.gfx = null;
		this.attached = false;
		this.dragging = false;
	}

	/** Cancel an in-flight drag (e.g. on resize) without launching. */
	cancel(): void {
		this.dragging = false;
		this.removeWindowReleaseListener();
		this.gfx?.clear();
	}

	// ── Input handlers ──────────────────────────────────────────────────────────

	private onDown(ptr: Phaser.Input.Pointer): void {
		if (isBallMoving(this.ball)) return;

		// Use WORLD coords (ptr.worldX/Y), not ptr.x/y: the ball/origin live in world
		// space, and under camera zoom the screen-space pointer diverges from world —
		// comparing the two makes the grab radius never match while zoomed in.
		const dx = ptr.worldX - this.ball.x;
		const dy = ptr.worldY - this.ball.y;
		if (Math.sqrt(dx * dx + dy * dy) > this.ball.r * this.grabRadiusFactor)
			return;

		this.dragging = true;
		this.origin.x = this.ball.x;
		this.origin.y = this.ball.y;
		this.dragPt.x = ptr.worldX;
		this.dragPt.y = ptr.worldY;
		window.addEventListener("pointerup", this.onWindowPointerUp, true);
	}

	private onMove(ptr: Phaser.Input.Pointer): void {
		if (!this.dragging) return;

		let dx = ptr.worldX - this.origin.x;
		let dy = ptr.worldY - this.origin.y;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len > this.maxDrag) {
			dx = (dx / len) * this.maxDrag;
			dy = (dy / len) * this.maxDrag;
		}

		this.dragPt.x = this.origin.x + dx;
		this.dragPt.y = this.origin.y + dy;
		this.drawAim();
	}

	private onUp(): void {
		if (!this.dragging) return;
		this.dragging = false;
		this.removeWindowReleaseListener();
		this.gfx?.clear();

		const dx = this.dragPt.x - this.origin.x;
		const dy = this.dragPt.y - this.origin.y;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len < 5) return;

		const power = len / this.maxDrag;
		const vx = -(dx / len) * power * this.launchSpeed;
		const vy = -(dy / len) * power * this.launchSpeed;

		this.ball.vx = vx;
		this.ball.vy = vy;
		this.onLaunch?.(vx, vy);
	}

	private removeWindowReleaseListener(): void {
		window.removeEventListener("pointerup", this.onWindowPointerUp, true);
	}

	// ── Aim rendering ───────────────────────────────────────────────────────────

	private drawAim(): void {
		if (!this.gfx) return;
		this.gfx.clear();

		const ox = this.origin.x;
		const oy = this.origin.y;
		const dx = this.dragPt.x - ox;
		const dy = this.dragPt.y - oy;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len < 2) return;

		const power = len / this.maxDrag; // 0..1

		// Rubber band: dark underlay + bright core keeps the cue readable on any arena.
		this.gfx.lineStyle(6, AIM_SHADOW, 0.5);
		this.gfx.lineBetween(ox, oy, this.dragPt.x, this.dragPt.y);
		this.gfx.lineStyle(3, AIM_BRIGHT, 0.95);
		this.gfx.lineBetween(ox, oy, this.dragPt.x, this.dragPt.y);

		// Launch-direction preview (dashed, fades with distance)
		const lx = ox - dx;
		const ly = oy - dy;
		const segments = 7;
		for (let i = 0; i < segments; i++) {
			const t0 = i / segments;
			const t1 = (i + 0.5) / segments;
			const alpha = (0.25 + power * 0.65) * (1 - t0);
			const x0 = ox + (lx - ox) * t0;
			const y0 = oy + (ly - oy) * t0;
			const x1 = ox + (lx - ox) * t1;
			const y1 = oy + (ly - oy) * t1;

			this.gfx.lineStyle(6, AIM_SHADOW, alpha * 0.45);
			this.gfx.lineBetween(x0, y0, x1, y1);
			this.gfx.lineStyle(2, AIM_BRIGHT_SOFT, alpha);
			this.gfx.lineBetween(x0, y0, x1, y1);
		}

		// Power ring around ball (green → red as power rises)
		const ringColour = Phaser.Display.Color.Interpolate.ColorWithColor(
			Phaser.Display.Color.ValueToColor(0x44ff88),
			Phaser.Display.Color.ValueToColor(0xff4444),
			100,
			Math.round(power * 100),
		);
		const ringHex = Phaser.Display.Color.GetColor(
			ringColour.r,
			ringColour.g,
			ringColour.b,
		);
		this.gfx.lineStyle(2, ringHex, 0.75);
		this.gfx.strokeCircle(ox, oy, this.ball.r * 1.6);
	}
}
