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

// ── SweepController ───────────────────────────────────────────────────────────

export class SweepController {
	private isSweeping = false;
	private lastPtr = { x: 0, y: 0, t: 0 };
	private attached = false;

	// NOTE: ball param is accepted but not used internally — the controller only
	// tracks pointer speed. Kept in the signature so the scene can pass a ball
	// reference without a cast; future features (e.g. proximity checks) may need it.
	constructor(
		private readonly scene: Phaser.Scene,
		_ball: CurlingBallState, // accepted; not used internally
	) {}

	attach(): void {
		if (this.attached) return;
		this.attached = true;
		this.isSweeping = false;
		this.lastPtr = { x: 0, y: 0, t: 0 };
		this.scene.input.on("pointermove", this.onMove, this);
	}

	detach(): void {
		if (!this.attached) return;
		this.attached = false;
		this.isSweeping = false;
		this.scene.input.off("pointermove", this.onMove, this);
	}

	destroy(): void {
		this.detach();
	}

	/**
	 * Call once per frame (only during sweeping phase). Resets the sweeping
	 * flag; onMove re-sets it this frame if the pointer swept fast enough.
	 * Returns the friction multiplier to apply this frame.
	 */
	update(): number {
		const multiplier = this.isSweeping ? SWEEP_FRICTION_MULT : 1.0;
		this.isSweeping = false;
		return multiplier;
	}

	// ── Private ──────────────────────────────────────────────────────────────────

	private onMove(ptr: Phaser.Input.Pointer): void {
		const now = ptr.time;
		const dt = (now - this.lastPtr.t) / 1000; // seconds

		if (dt > 0 && this.lastPtr.t > 0) {
			// World coords (ptr.worldX/Y): the speed threshold must be
			// zoom-independent (see slingshot).
			const dx = ptr.worldX - this.lastPtr.x;
			const dy = ptr.worldY - this.lastPtr.y;
			const speed = Math.sqrt(dx * dx + dy * dy) / dt;
			if (speed > SWEEP_THRESHOLD) this.isSweeping = true;
		}

		this.lastPtr = { x: ptr.worldX, y: ptr.worldY, t: now };
	}
}
