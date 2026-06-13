/**
 * BambooBashScene — main scene of the Bamboo Bash minigame.
 *
 * First draft: a shell ball in the centre of the sumo ring; slingshot
 * drag-to-launch (mechanics/slingshot), ellipse-wall bouncing with friction
 * (mechanics/ball), uniform-scale arena rendering (mechanics/arena).
 */

import Phaser from 'phaser';
import { ARENA_01 } from '../arenas/arena01';
import { ArenaPixels, arenaToScreen, drawSumoRing } from '../arenas/arena';
import { BallState, BALL_SRC_R, stepBall, drawShellBall } from '../mechanics/ball';
import { Slingshot } from '../mechanics/slingshot';
import { buildReturnButton } from '../mechanics/hud';

// Slingshot tuning in arena source px (scaled by the letterbox factor so the
// game feels identical at 1080p, 4K, or a tiny window)
const MAX_DRAG_SRC     = 380;    // max pull distance
const LAUNCH_SPEED_SRC = 1100;   // source px/s at full drag

export class BambooBashScene extends Phaser.Scene {
  private bgGfx!:   Phaser.GameObjects.Graphics;
  private ballGfx!: Phaser.GameObjects.Graphics;

  private arena!: ArenaPixels;
  private ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
  private slingshot!: Slingshot;
  private hudObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() { super({ key: 'BambooBashScene' }); }

  create(): void {
    this.arena = arenaToScreen(ARENA_01, this.scale.width, this.scale.height);
    this.resetBall();

    this.bgGfx   = this.add.graphics().setDepth(0);
    this.ballGfx = this.add.graphics().setDepth(2);

    this.slingshot = new Slingshot(this, this.ball, {
      maxDrag: MAX_DRAG_SRC * this.arena.scale,
      launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
      depth: 1,
    });
    this.slingshot.attach();

    this.drawBackground();
    drawShellBall(this.ballGfx, this.ball);
    this.hudObjects = buildReturnButton(this);

    this.scale.on('resize', this.onResize, this);
  }

  shutdown(): void {
    this.scale.off('resize', this.onResize, this);
    this.slingshot.destroy();
  }

  update(_time: number, delta: number): void {
    if (stepBall(this.ball, delta, this.arena)) {
      drawShellBall(this.ballGfx, this.ball);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private resetBall(): void {
    this.ball.x  = this.arena.cx;
    this.ball.y  = this.arena.cy;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.r  = BALL_SRC_R * this.arena.scale;
  }

  private drawBackground(): void {
    const { width, height } = this.scale;
    this.bgGfx.clear();

    // Bamboo-forest backdrop
    this.bgGfx.fillStyle(0x0a1208, 1);
    this.bgGfx.fillRect(0, 0, width, height);

    // Faint tatami grid
    const step = Math.round(Math.min(width, height) * 0.065);
    this.bgGfx.lineStyle(1, 0x152410, 0.55);
    for (let x = 0; x < width;  x += step) this.bgGfx.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += step) this.bgGfx.lineBetween(0, y, width, y);

    drawSumoRing(this.bgGfx, this.arena);
  }

  // ── Resize ──────────────────────────────────────────────────────────────────

  private onResize(): void {
    const oldArena = this.arena;
    this.arena = arenaToScreen(ARENA_01, this.scale.width, this.scale.height);

    // Cancel any in-flight drag and rescale pull distance + launch power
    this.slingshot.cancel();
    this.slingshot.maxDrag     = MAX_DRAG_SRC * this.arena.scale;
    this.slingshot.launchSpeed = LAUNCH_SPEED_SRC * this.arena.scale;

    // Carry the ball to the equivalent spot in the new arena space
    const relX = (this.ball.x - oldArena.cx) / oldArena.rx;
    const relY = (this.ball.y - oldArena.cy) / oldArena.ry;
    this.ball.x = this.arena.cx + relX * this.arena.rx;
    this.ball.y = this.arena.cy + relY * this.arena.ry;
    this.ball.r = BALL_SRC_R * this.arena.scale;

    // Rescale velocity so motion feels consistent across sizes
    const vScale = this.arena.scale / oldArena.scale;
    this.ball.vx *= vScale;
    this.ball.vy *= vScale;

    this.drawBackground();
    drawShellBall(this.ballGfx, this.ball);

    // Rebuild HUD at the new top-right corner
    this.hudObjects.forEach((o) => o.destroy());
    this.hudObjects = buildReturnButton(this);
  }
}
