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

import Phaser from 'phaser';
import { BallState, isBallMoving } from './ball';
import { THEME } from '../theme';

export interface SlingshotConfig {
  maxDrag: number;       // max pull distance in canvas px
  launchSpeed: number;   // canvas px/s at full drag — scale with the arena so
                         // power is fair across window sizes
  grabRadiusFactor?: number;  // grab zone = ball.r × this (default 3.5)
  depth?: number;        // render depth of the aim graphics (default 1)
}

export class Slingshot {
  public maxDrag: number;
  public launchSpeed: number;

  private readonly grabRadiusFactor: number;
  private readonly depth: number;

  private gfx!: Phaser.GameObjects.Graphics;
  private dragging = false;
  private origin = { x: 0, y: 0 };
  private dragPt = { x: 0, y: 0 };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ball: BallState,
    cfg: SlingshotConfig,
    private readonly onLaunch?: (vx: number, vy: number) => void,
  ) {
    this.maxDrag          = cfg.maxDrag;
    this.launchSpeed      = cfg.launchSpeed;
    this.grabRadiusFactor = cfg.grabRadiusFactor ?? 3.5;
    this.depth            = cfg.depth ?? 1;
  }

  attach(): void {
    this.gfx = this.scene.add.graphics().setDepth(this.depth);
    this.scene.input.on('pointerdown', this.onDown, this);
    this.scene.input.on('pointermove', this.onMove, this);
    this.scene.input.on('pointerup',   this.onUp,   this);
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.onDown, this);
    this.scene.input.off('pointermove', this.onMove, this);
    this.scene.input.off('pointerup',   this.onUp,   this);
    this.gfx?.destroy();
  }

  /** Cancel an in-flight drag (e.g. on resize) without launching. */
  cancel(): void {
    this.dragging = false;
    this.gfx?.clear();
  }

  // ── Input handlers ──────────────────────────────────────────────────────────

  private onDown(ptr: Phaser.Input.Pointer): void {
    if (isBallMoving(this.ball)) return;

    const dx = ptr.x - this.ball.x;
    const dy = ptr.y - this.ball.y;
    if (Math.sqrt(dx * dx + dy * dy) > this.ball.r * this.grabRadiusFactor) return;

    this.dragging = true;
    this.origin.x = this.ball.x;
    this.origin.y = this.ball.y;
    this.dragPt.x = ptr.x;
    this.dragPt.y = ptr.y;
  }

  private onMove(ptr: Phaser.Input.Pointer): void {
    if (!this.dragging) return;

    let dx = ptr.x - this.origin.x;
    let dy = ptr.y - this.origin.y;
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
    this.gfx.clear();

    const dx  = this.dragPt.x - this.origin.x;
    const dy  = this.dragPt.y - this.origin.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) return;

    const power = len / this.maxDrag;
    const vx = -(dx / len) * power * this.launchSpeed;
    const vy = -(dy / len) * power * this.launchSpeed;

    this.ball.vx = vx;
    this.ball.vy = vy;
    this.onLaunch?.(vx, vy);
  }

  // ── Aim rendering ───────────────────────────────────────────────────────────

  private drawAim(): void {
    this.gfx.clear();

    const ox  = this.origin.x;
    const oy  = this.origin.y;
    const dx  = this.dragPt.x - ox;
    const dy  = this.dragPt.y - oy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 2) return;

    const power = len / this.maxDrag;  // 0..1

    // Rubber band: ball origin → drag point (gold)
    this.gfx.lineStyle(3, THEME.gold, 0.85);
    this.gfx.lineBetween(ox, oy, this.dragPt.x, this.dragPt.y);

    // Launch-direction preview (dashed, fades with distance)
    const lx = ox - dx;
    const ly = oy - dy;
    const segments = 7;
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 0.5) / segments;
      const alpha = (0.15 + power * 0.55) * (1 - t0);
      this.gfx.lineStyle(2, 0xffffff, alpha);
      this.gfx.lineBetween(
        ox + (lx - ox) * t0, oy + (ly - oy) * t0,
        ox + (lx - ox) * t1, oy + (ly - oy) * t1,
      );
    }

    // Power ring around ball (green → red as power rises)
    const ringColour = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x44ff88),
      Phaser.Display.Color.ValueToColor(0xff4444),
      100, Math.round(power * 100),
    );
    const ringHex = Phaser.Display.Color.GetColor(ringColour.r, ringColour.g, ringColour.b);
    this.gfx.lineStyle(2, ringHex, 0.75);
    this.gfx.strokeCircle(ox, oy, this.ball.r * 1.6);
  }
}
