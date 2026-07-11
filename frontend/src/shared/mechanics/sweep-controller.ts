/**
 * game/mechanics/sweep-controller.ts — broom-sweeping interaction.
 *
 * During a ball's flight, the active player can sweep by moving the pointer
 * quickly across the sheet. Fast swipes temporarily reduce the ball's friction,
 * letting it travel a bit farther.
 *
 * Zero imports from any specific minigame directory.
 */

import Phaser from "phaser";
import type { CurlingBallState } from "./ball";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Pointer speed (canvas px/s) required to trigger sweeping. */
const SWEEP_THRESHOLD = 280;

/** Friction multiplier while sweeping (replaces the normal ICE value that frame). */
export const SWEEP_FRICTION_MULT = 0.9994;

/** How long the swipe trail segments persist in milliseconds. */
const TRAIL_LIFETIME_MS = 120;

/** Number of trail segments to draw. */
const TRAIL_SEGMENTS = 4;

// ── SweepController ───────────────────────────────────────────────────────────

interface TrailPoint {
	x: number;
	y: number;
	age: number; // ms since this point was recorded
}

export class SweepController {
	private readonly gfx: Phaser.GameObjects.Graphics;

	private isSweeping = false;
	private lastPtr = { x: 0, y: 0, t: 0 };
	private trail: TrailPoint[] = [];
	private attached = false;

	// NOTE: ball param is accepted but not used internally — the controller only
	// tracks pointer speed. Kept in the signature so the scene can pass a ball
	// reference without a cast; future features (e.g. proximity checks) may need it.
	constructor(
		private readonly scene: Phaser.Scene,
		_ball: CurlingBallState, // accepted; not used internally
		depth = 4,
	) {
		this.gfx = scene.add.graphics().setDepth(depth);
	}

	attach(): void {
		if (this.attached) return;
		this.attached = true;
		this.isSweeping = false;
		this.trail = [];
		this.scene.input.on("pointermove", this.onMove, this);
	}

	detach(): void {
		if (!this.attached) return;
		this.attached = false;
		this.isSweeping = false;
		this.scene.input.off("pointermove", this.onMove, this);
		this.gfx.clear();
	}

	destroy(): void {
		this.detach();
		this.gfx.destroy();
	}

	/**
	 * Call once per frame (only during sweeping phase).
	 * Advances trail ageing, redraws trail, resets sweeping flag.
	 * Returns the friction multiplier to apply this frame.
	 */
	update(deltaMs: number): number {
		// Age trail points
		for (const pt of this.trail) pt.age += deltaMs;
		this.trail = this.trail.filter((pt) => pt.age < TRAIL_LIFETIME_MS);

		this.drawTrail();

		const multiplier = this.isSweeping ? SWEEP_FRICTION_MULT : 1.0;
		this.isSweeping = false; // reset; re-set by onMove this frame if applicable
		return multiplier;
	}

	/** Returns current sweep friction multiplier without advancing state (for external reads). */
	getSweepMultiplier(): number {
		return this.isSweeping ? SWEEP_FRICTION_MULT : 1.0;
	}

	// ── Private ──────────────────────────────────────────────────────────────────

	private onMove(ptr: Phaser.Input.Pointer): void {
		const now = ptr.time;
		const dt = (now - this.lastPtr.t) / 1000; // seconds

		if (dt > 0 && this.lastPtr.t > 0) {
			// World coords (ptr.worldX/Y), not ptr.x/y: the trail renders in world
			// space and the speed threshold must be zoom-independent (see slingshot).
			const dx = ptr.worldX - this.lastPtr.x;
			const dy = ptr.worldY - this.lastPtr.y;
			const speed = Math.sqrt(dx * dx + dy * dy) / dt;

			if (speed > SWEEP_THRESHOLD) {
				this.isSweeping = true;
				this.trail.push({ x: ptr.worldX, y: ptr.worldY, age: 0 });
				if (this.trail.length > TRAIL_SEGMENTS + 2) {
					this.trail.shift();
				}
			}
		}

		this.lastPtr = { x: ptr.worldX, y: ptr.worldY, t: now };
	}

	private drawTrail(): void {
		this.gfx.clear();
		if (this.trail.length < 2) return;

		for (let i = 1; i < this.trail.length; i++) {
			const prev = this.trail[i - 1];
			const curr = this.trail[i];
			const alpha = (1 - curr.age / TRAIL_LIFETIME_MS) * 0.65;
			this.gfx.lineStyle(2, 0xffffff, alpha);
			this.gfx.lineBetween(prev.x, prev.y, curr.x, curr.y);
		}
	}
}
