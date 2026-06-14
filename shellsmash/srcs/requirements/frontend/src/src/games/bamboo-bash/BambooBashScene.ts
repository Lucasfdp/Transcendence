/**
 * BambooBashScene — main scene of the Bamboo Bash minigame.
 *
 * A shell ball sits in the centre of the sumo ring; drag-to-launch slingshot
 * (mechanics/slingshot), ellipse-wall bouncing with friction (mechanics/ball).
 *
 * Goal: smash bamboo before the 30 s clock runs out. Bamboo spawns at random
 * spots, starts as one cane and grows a cane every 5 s (max 3). Hitting one
 * scores by size — 100 / 150 / 250 pts — and the ball rolls on for the next
 * shot. When the clock hits 0 the round freezes and an end screen lists the
 * players' scores.
 */

import Phaser from 'phaser';
import { ARENA_01 } from '../../shared/arenas/arena01';
import { ArenaPixels, arenaToScreen, drawSumoRing } from '../../shared/arenas/arena';
import { BallState, BALL_SRC_R, stepBall, isBallMoving, drawShellBall } from '../../shared/mechanics/ball';
import { Slingshot } from '../../shared/mechanics/slingshot';
import { buildReturnButton } from '../../shared/mechanics/hud';
import { showAchievementUnlocks } from '../../shared/achievement-popup';
import { THEME } from '../../shared/theme';
import { api } from '../../hub/api';
import {
  Bamboo, STAGE_POINTS,
  stepBamboo, randomSpot, bambooPos, hitsBamboo, drawBamboo,
} from './bamboo';

// Slingshot tuning in arena source px (scaled by the letterbox factor so the
// game feels identical at 1080p, 4K, or a tiny window)
const MAX_DRAG_SRC     = 380;    // max pull distance
const LAUNCH_SPEED_SRC = 1100;   // source px/s at full drag

// Round + spawn tuning
const ROUND_MS        = 30_000;  // countdown length
const SPAWN_EVERY_MS  = 1800;    // cadence of new bamboo while the field has room
const MAX_BAMBOO      = 6;       // max bamboo alive at once
const START_BAMBOO    = 2;       // bamboo present when the round begins

const DEPTH_OVERLAY = 30;

export class BambooBashScene extends Phaser.Scene {
  private bgGfx!:     Phaser.GameObjects.Graphics;
  private bambooGfx!: Phaser.GameObjects.Graphics;
  private ballGfx!:   Phaser.GameObjects.Graphics;

  private arena!: ArenaPixels;
  private ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
  private slingshot!: Slingshot;
  private hudObjects: Phaser.GameObjects.GameObject[] = [];

  private bamboos: Bamboo[] = [];
  private spawnAccMs = 0;

  private score = 0;
  private timeLeftMs = ROUND_MS;
  private running = true;

  private scoreText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;

  constructor() { super({ key: 'BambooBashScene' }); }

  create(): void {
    // Reset per-round state (scenes are reused across restarts)
    this.bamboos = [];
    this.spawnAccMs = 0;
    this.score = 0;
    this.timeLeftMs = ROUND_MS;
    this.running = true;
    this.overlay = undefined;

    this.arena = arenaToScreen(ARENA_01, this.scale.width, this.scale.height);
    this.resetBall();

    this.bgGfx     = this.add.graphics().setDepth(0);
    this.bambooGfx = this.add.graphics().setDepth(1);
    this.ballGfx   = this.add.graphics().setDepth(3);

    this.slingshot = new Slingshot(this, this.ball, {
      maxDrag: MAX_DRAG_SRC * this.arena.scale,
      launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
      depth: 2,
    });
    this.slingshot.attach();

    for (let i = 0; i < START_BAMBOO; i++) this.spawnBamboo();

    this.drawBackground();
    this.drawBamboos();
    drawShellBall(this.ballGfx, this.ball);
    this.buildHud();

    this.scale.on('resize', this.onResize, this);
  }

  shutdown(): void {
    this.scale.off('resize', this.onResize, this);
    this.slingshot.destroy();
    this.overlay?.destroy(true);
  }

  update(_time: number, delta: number): void {
    if (!this.running) return;

    // Countdown
    this.timeLeftMs = Math.max(0, this.timeLeftMs - delta);
    this.timerText.setText(this.formatTime());
    if (this.timeLeftMs <= 0) { this.endRound(); return; }

    // Grow existing bamboo
    for (const b of this.bamboos) stepBamboo(b, delta);

    // Spawn new bamboo on cadence while there's room
    this.spawnAccMs += delta;
    if (this.spawnAccMs >= SPAWN_EVERY_MS) {
      this.spawnAccMs = 0;
      if (this.bamboos.length < MAX_BAMBOO) this.spawnBamboo();
    }

    // Ball physics + collisions
    const moving = stepBall(this.ball, delta, this.arena);
    if (moving) this.checkBambooHits();

    this.drawBamboos();
    drawShellBall(this.ballGfx, this.ball);
  }

  // ── Gameplay ──────────────────────────────────────────────────────────────

  private spawnBamboo(): void {
    const spot = randomSpot(this.bamboos);
    if (!spot) return;
    this.bamboos.push({ nx: spot.nx, ny: spot.ny, stage: 1, ageMs: 0 });
  }

  private checkBambooHits(): void {
    for (let i = this.bamboos.length - 1; i >= 0; i--) {
      const b = this.bamboos[i];
      if (!hitsBamboo(b, this.arena, this.ball.x, this.ball.y, this.ball.r)) continue;

      const points = STAGE_POINTS[b.stage] ?? 0;
      this.score += points;
      this.scoreText.setText(`SCORE  ${this.score}`);

      const p = bambooPos(b, this.arena);
      this.popScore(p.x, p.y, points);
      this.bamboos.splice(i, 1);
    }
  }

  private endRound(): void {
    this.running = false;
    this.timerText.setText(this.formatTime());
    this.slingshot.cancel();
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.submitResult();
    this.showEndScreen();
  }

  /**
   * Submit the game result for progression.
   * Bamboo Bash is single-player — completing the timer always counts as a win.
   * Non-fatal: errors are logged but never block the end screen from showing.
   */
  private submitResult(): void {
    const user = this.registry.get('user') as { isGuest?: boolean } | undefined;
    if (user?.isGuest) return;

    api.submitGameResult('bamboo-bash', 'win').then((result) => {
      console.info('[BambooBash] progression:', result);
      showAchievementUnlocks(this, result.unlockedAchievements ?? []);
    }).catch((err: unknown) => {
      console.warn('[BambooBash] failed to submit result:', err);
    });
  }

  // ── Floating "+points" popup ────────────────────────────────────────────────

  private popScore(x: number, y: number, points: number): void {
    const t = this.add.text(x, y, `+${points}`, {
      fontSize: '22px',
      color: THEME.textGold,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(4);

    this.tweens.add({
      targets: t,
      y: y - 46,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  // ── End screen ──────────────────────────────────────────────────────────────

  private showEndScreen(): void {
    const { width, height } = this.scale;
    const c = this.add.container(width / 2, height / 2).setDepth(DEPTH_OVERLAY);
    this.overlay = c;

    const W = 460, H = 300;
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.72);
    bg.fillRoundedRect(-W / 2, -H / 2, W, H, 14);
    bg.lineStyle(2, THEME.gold, 0.85);
    bg.strokeRoundedRect(-W / 2, -H / 2, W, H, 14);
    c.add(bg);

    const title = this.add.text(0, -H / 2 + 38, "TIME'S UP!", {
      fontSize: '30px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5);
    c.add(title);

    const header = this.add.text(0, -H / 2 + 78, 'FINAL SCORES', {
      fontSize: '14px', color: THEME.text, fontFamily: THEME.font,
    }).setOrigin(0.5);
    c.add(header);

    // Player rows — single-player for now; fetch the real name, fall back to "You".
    const rowY = -H / 2 + 120;
    const nameText = this.add.text(-W / 2 + 40, rowY, 'You', {
      fontSize: '20px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    const scoreText = this.add.text(W / 2 - 40, rowY, String(this.score), {
      fontSize: '20px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(1, 0.5);
    c.add(nameText);
    c.add(scoreText);

    api.getMe()
      .then((me: { displayName?: string; username?: string }) => {
        if (this.overlay !== c) return;  // round restarted / left while loading
        nameText.setText(me.displayName || me.username || 'You');
      })
      .catch(() => { /* keep the "You" fallback */ });

    // Buttons
    this.addOverlayButton(c, -110, H / 2 - 50, 'PLAY AGAIN', () => this.scene.restart());
    this.addOverlayButton(c,  110, H / 2 - 50, 'RETURN', () => this.scene.start('HubScene'));
  }

  private addOverlayButton(
    c: Phaser.GameObjects.Container, x: number, y: number, label: string, onClick: () => void,
  ): void {
    const BW = 180, BH = 42;
    const g = this.add.graphics();
    g.fillStyle(0x1a1005, 0.95);
    g.fillRoundedRect(x - BW / 2, y - BH / 2, BW, BH, 8);
    g.lineStyle(1.5, THEME.gold, 0.85);
    g.strokeRoundedRect(x - BW / 2, y - BH / 2, BW, BH, 8);
    c.add(g);

    const t = this.add.text(x, y, label, {
      fontSize: '15px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5);
    c.add(t);

    const zone = this.add.zone(x, y, BW, BH).setInteractive({ useHandCursor: true });
    zone.on('pointerup', onClick);
    c.add(zone);
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────

  private buildHud(): void {
    this.hudObjects = buildReturnButton(this);

    this.scoreText = this.add.text(16, 16, `SCORE  ${this.score}`, {
      fontSize: '22px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setDepth(20);

    this.timerText = this.add.text(this.scale.width / 2, 16, this.formatTime(), {
      fontSize: '26px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(20);
  }

  private formatTime(): string {
    const s = Math.ceil(this.timeLeftMs / 1000);
    return `⏱ ${s}s`;
  }

  // ── Rendering helpers ───────────────────────────────────────────────────────

  private drawBamboos(): void {
    this.bambooGfx.clear();
    for (const b of this.bamboos) drawBamboo(this.bambooGfx, b, this.arena);
  }

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
    if (isBallMoving(this.ball)) {
      const vScale = this.arena.scale / oldArena.scale;
      this.ball.vx *= vScale;
      this.ball.vy *= vScale;
    }

    this.drawBackground();
    this.drawBamboos();
    drawShellBall(this.ballGfx, this.ball);

    // Reposition HUD
    this.hudObjects.forEach((o) => o.destroy());
    this.hudObjects = buildReturnButton(this);
    this.scoreText.setPosition(16, 16);
    this.timerText.setPosition(this.scale.width / 2, 16);
    this.overlay?.setPosition(this.scale.width / 2, this.scale.height / 2);
  }
}
