/**
 * KameKnockScene — billiards-like target-smashing minigame.
 *
 * The player launches a turtle shell with the shared Slingshot mechanic, chains
 * hits against timed targets, and scores higher multipliers while the shell is
 * still moving from the same launch.
 */

import Phaser from 'phaser';
import { api } from '../../hub/api';
import { ARENA_01 } from '../../shared/arenas/arena01';
import { ArenaPixels, arenaToScreen, drawSumoRing } from '../../shared/arenas/arena';
import { BallState, BALL_SRC_R, drawShellBall, isBallMoving, stepBall } from '../../shared/mechanics/ball';
import { Slingshot } from '../../shared/mechanics/slingshot';
import { buildReturnButton } from '../../shared/mechanics/hud';
import {
  TimedTarget,
  TimedTargetKind,
  hitsTimedTarget,
  randomTimedTargetSpot,
  targetHitAccuracy,
  timedTargetPosition,
  timedTargetRadius,
} from '../../shared/mechanics/timed-targets';
import { THEME } from '../../shared/theme';

interface BallRoundConfig {
  readonly totalTargets: number;
  readonly breakableTargets: number;
}

const BALL_ROUNDS: BallRoundConfig[] = [
  { totalTargets: 7, breakableTargets: 4 },
  { totalTargets: 10, breakableTargets: 6 },
  { totalTargets: 15, breakableTargets: 10 },
];

const MAX_DRAG_SRC = 380;
const LAUNCH_SPEED_SRC = 1_250;
const PERFECT_ACCURACY = 0.35;
const PERFECT_BONUS = 500;
const HIT_KNOCKBACK_SRC = 90;
const SOLID_BOUNCE_DAMP = 0.92;

const DEPTH_BG = 0;
const DEPTH_TARGETS = 1;
const DEPTH_AIM = 2;
const DEPTH_BALL = 3;
const DEPTH_FX = 4;
const DEPTH_HUD = 20;
const DEPTH_OVERLAY = 30;

const TARGET_COLOURS: Record<TimedTargetKind, { body: number; trim: number; label: string; points: number; radiusSrc: number }> = {
  daruma: { body: THEME.red, trim: THEME.gold, label: 'DARUMA', points: 100, radiusSrc: 30 },
  crate: { body: 0x7a4a24, trim: 0xc98a3a, label: 'CRATE', points: 120, radiusSrc: 28 },
  drum: { body: 0x2d4f7a, trim: 0xe8d5a3, label: 'DRUM', points: 150, radiusSrc: 32 },
};

const TARGET_TYPES: TimedTargetKind[] = ['daruma', 'crate', 'drum'];

export class KameKnockScene extends Phaser.Scene {
  private bgGfx!: Phaser.GameObjects.Graphics;
  private targetGfx!: Phaser.GameObjects.Graphics;
  private ballGfx!: Phaser.GameObjects.Graphics;

  private arena!: ArenaPixels;
  private ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
  private slingshot: Slingshot | null = null;
  private hudObjects: Phaser.GameObjects.GameObject[] = [];

  private targets: TimedTarget[] = [];
  private nextTargetId = 0;
  private currentBallIndex = 0;
  private launchedThisBall = false;
  private score = 0;
  private combo = 0;
  private running = true;

  private scoreText: Phaser.GameObjects.Text | null = null;
  private comboText: Phaser.GameObjects.Text | null = null;
  private ballText: Phaser.GameObjects.Text | null = null;
  private overlay?: Phaser.GameObjects.Container;
  private overlayHitZones: Phaser.GameObjects.Zone[] = [];

  constructor() { super({ key: 'KameKnockScene' }); }

  create(): void {
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanupSceneResources, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanupSceneResources, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupSceneResources, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanupSceneResources, this);

    this.targets = [];
    this.nextTargetId = 0;
    this.currentBallIndex = 0;
    this.launchedThisBall = false;
    this.score = 0;
    this.combo = 0;
    this.running = true;
    this.overlay = undefined;
    this.scoreText = null;
    this.comboText = null;
    this.ballText = null;

    this.arena = arenaToScreen(ARENA_01, this.scale.width, this.scale.height);
    this.resetBall();

    this.bgGfx = this.add.graphics().setDepth(DEPTH_BG);
    this.targetGfx = this.add.graphics().setDepth(DEPTH_TARGETS);
    this.ballGfx = this.add.graphics().setDepth(DEPTH_BALL);

    this.slingshot = new Slingshot(this, this.ball, {
      maxDrag: MAX_DRAG_SRC * this.arena.scale,
      launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
      depth: DEPTH_AIM,
    }, () => this.onLaunch());
    this.slingshot.attach();

    this.setupBallRound();

    this.drawBackground();
    this.drawTargets();
    drawShellBall(this.ballGfx, this.ball);
    this.buildHud();

    this.scale.on('resize', this.onResize, this);
  }

  private cleanupSceneResources(): void {
    this.scale.off('resize', this.onResize, this);
    this.slingshot?.destroy();
    this.slingshot = null;
    this.clearOverlayHitZones();
    this.overlay?.destroy(true);
    this.overlay = undefined;
    this.scoreText = null;
    this.comboText = null;
    this.ballText = null;
  }

  update(_time: number, delta: number): void {
    if (!this.running) return;

    for (const target of this.targets) {
      target.ageMs += delta;
    }

    const moving = stepBall(this.ball, delta, this.arena);
    if (moving) this.checkTargetHits();
    if (this.launchedThisBall && !moving) this.finishBallRound();

    this.drawTargets();
    drawShellBall(this.ballGfx, this.ball);
    this.comboText?.setText(`COMBO  x${Math.max(1, this.combo)}`);
  }

  private onLaunch(): void {
    this.launchedThisBall = true;
    this.combo = 0;
  }

  private setupBallRound(): void {
    this.targets = [];
    this.launchedThisBall = false;
    this.combo = 0;
    this.resetBall();

    const config = BALL_ROUNDS[this.currentBallIndex];
    const breakableFlags = this.shuffledBreakableFlags(config);

    for (const breakable of breakableFlags) {
      this.spawnTarget(breakable);
    }

    if (this.ballText?.active) this.ballText.setText(this.formatBallText());
    if (this.comboText?.active) this.comboText.setText('COMBO  x1');
  }

  private shuffledBreakableFlags(config: BallRoundConfig): boolean[] {
    const flags = Array.from({ length: config.totalTargets }, (_value, index) => index < config.breakableTargets);
    return Phaser.Utils.Array.Shuffle(flags);
  }

  private spawnTarget(breakable: boolean): void {
    const spot = randomTimedTargetSpot(this.targets) ?? this.fallbackTargetSpot();

    const kind = Phaser.Math.RND.pick(TARGET_TYPES);
    const def = TARGET_COLOURS[kind];
    this.targets.push({
      id: this.nextTargetId++,
      kind,
      breakable,
      nx: spot.nx,
      ny: spot.ny,
      ageMs: 0,
      lifetimeMs: Number.POSITIVE_INFINITY,
      radiusSrc: def.radiusSrc,
      points: def.points,
    });
  }

  private fallbackTargetSpot(): { nx: number; ny: number } {
    const radius = 0.28 + Math.random() * 0.56;
    const theta = Math.random() * Math.PI * 2;
    return {
      nx: Math.cos(theta) * radius,
      ny: Math.sin(theta) * radius,
    };
  }

  private checkTargetHits(): void {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const target = this.targets[i];
      if (!hitsTimedTarget(target, this.arena, this.ball.x, this.ball.y, this.ball.r)) continue;

      const pos = timedTargetPosition(target, this.arena);
      if (!target.breakable) {
        this.bounceOffSolidTarget(pos.x, pos.y, timedTargetRadius(target, this.arena));
        continue;
      }

      this.combo += 1;
      const accuracy = targetHitAccuracy(target, this.arena, this.ball.x, this.ball.y);
      const perfect = accuracy <= PERFECT_ACCURACY;
      const gained = target.points * this.combo + (perfect ? PERFECT_BONUS : 0);
      this.score += gained;
      this.scoreText?.setText(`SCORE  ${this.score}`);

      this.popScore(pos.x, pos.y, gained, this.combo, perfect);
      this.applyHitKick(pos.x, pos.y);
      this.targets.splice(i, 1);
    }
  }

  private bounceOffSolidTarget(targetX: number, targetY: number, targetRadius: number): void {
    const dx = this.ball.x - targetX;
    const dy = this.ball.y - targetY;
    const dist = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / dist;
    const ny = dy / dist;
    const minDist = this.ball.r + targetRadius;

    if (dist < minDist) {
      const push = minDist - dist;
      this.ball.x += nx * push;
      this.ball.y += ny * push;
    }

    const dot = this.ball.vx * nx + this.ball.vy * ny;
    if (dot >= 0) return;

    this.ball.vx = (this.ball.vx - 2 * dot * nx) * SOLID_BOUNCE_DAMP;
    this.ball.vy = (this.ball.vy - 2 * dot * ny) * SOLID_BOUNCE_DAMP;
    this.popBounce(targetX, targetY);
  }

  private applyHitKick(targetX: number, targetY: number): void {
    const dx = this.ball.x - targetX;
    const dy = this.ball.y - targetY;
    const len = Math.max(1, Math.hypot(dx, dy));
    const kick = HIT_KNOCKBACK_SRC * this.arena.scale;
    this.ball.vx += (dx / len) * kick;
    this.ball.vy += (dy / len) * kick;
  }

  private endRound(): void {
    this.running = false;
    this.slingshot?.cancel();
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.combo = 0;
    this.submitResult();
    this.showEndScreen();
  }

  /**
   * Submit the game result to the backend for XP / coin / level progression.
   * Kame Knock is single-player — completing all rounds always counts as a win.
   * Non-fatal: errors are logged but never block the end screen from showing.
   */
  private submitResult(): void {
    const user = this.registry.get('user') as { isGuest?: boolean } | undefined;
    if (user?.isGuest) return;

    api.submitGameResult('kame-knock', 'win').then((result) => {
      console.info('[KameKnock] progression:', result);
    }).catch((err: unknown) => {
      console.warn('[KameKnock] failed to submit result:', err);
    });
  }

  private finishBallRound(): void {
    this.launchedThisBall = false;
    this.combo = 0;
    this.currentBallIndex += 1;

    if (this.currentBallIndex >= BALL_ROUNDS.length) {
      this.endRound();
      return;
    }

    this.setupBallRound();
    this.drawTargets();
    drawShellBall(this.ballGfx, this.ball);
  }

  private buildHud(): void {
    this.hudObjects = buildReturnButton(this);

    this.scoreText = this.add.text(16, 16, `SCORE  ${this.score}`, {
      fontSize: '22px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setDepth(DEPTH_HUD);

    this.comboText = this.add.text(16, 44, 'COMBO  x1', {
      fontSize: '16px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold',
    }).setDepth(DEPTH_HUD);

    this.ballText = this.add.text(this.scale.width / 2, 16, this.formatBallText(), {
      fontSize: '26px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(DEPTH_HUD);
  }

  private formatBallText(): string {
    const config = BALL_ROUNDS[this.currentBallIndex];
    return `BALL ${this.currentBallIndex + 1}/${BALL_ROUNDS.length}  ${config.breakableTargets} BREAK  ${config.totalTargets - config.breakableTargets} BOUNCE`;
  }

  private resetBall(): void {
    this.ball.x = this.arena.cx;
    this.ball.y = this.arena.cy;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.r = BALL_SRC_R * this.arena.scale;
  }

  private drawBackground(): void {
    const { width, height } = this.scale;
    this.bgGfx.clear();
    this.bgGfx.fillStyle(THEME.background, 1);
    this.bgGfx.fillRect(0, 0, width, height);

    const gridStep = Math.max(28, Math.round(70 * this.arena.scale));
    this.bgGfx.lineStyle(1, THEME.greenMuted, 0.45);
    for (let x = 0; x < width; x += gridStep) this.bgGfx.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += gridStep) this.bgGfx.lineBetween(0, y, width, y);

    drawSumoRing(this.bgGfx, this.arena);
  }

  private drawTargets(): void {
    this.targetGfx.clear();
    for (const target of this.targets) this.drawTarget(target);
  }

  private drawTarget(target: TimedTarget): void {
    const pos = timedTargetPosition(target, this.arena);
    const radius = timedTargetRadius(target, this.arena);
    const def = TARGET_COLOURS[target.kind];
    const pulse = 0.88 + Math.sin(target.ageMs * 0.006) * 0.12;
    const alpha = target.breakable ? 1 : 0.92;

    this.targetGfx.fillStyle(0x000000, 0.20 * alpha);
    this.targetGfx.fillEllipse(pos.x + radius * 0.25, pos.y + radius * 0.45, radius * 2.1, radius * 0.8);
    this.targetGfx.fillStyle(target.breakable ? def.body : 0x4d5566, alpha);
    this.targetGfx.fillCircle(pos.x, pos.y, radius * pulse);
    this.targetGfx.lineStyle(Math.max(2, radius * 0.12), target.breakable ? def.trim : 0x9aa4b8, alpha);
    this.targetGfx.strokeCircle(pos.x, pos.y, radius * 0.78);

    if (!target.breakable) {
      this.targetGfx.lineStyle(Math.max(2, radius * 0.09), 0xffffff, 0.75);
      this.targetGfx.strokeCircle(pos.x, pos.y, radius * 1.08);
      this.targetGfx.lineBetween(pos.x - radius * 0.45, pos.y, pos.x + radius * 0.45, pos.y);
      this.targetGfx.lineBetween(pos.x, pos.y - radius * 0.45, pos.x, pos.y + radius * 0.45);
      return;
    }

    if (target.kind === 'daruma') {
      this.targetGfx.fillStyle(0xffffff, alpha);
      this.targetGfx.fillCircle(pos.x - radius * 0.28, pos.y - radius * 0.18, radius * 0.14);
      this.targetGfx.fillCircle(pos.x + radius * 0.28, pos.y - radius * 0.18, radius * 0.14);
    } else if (target.kind === 'crate') {
      this.targetGfx.lineStyle(Math.max(1, radius * 0.08), def.trim, alpha);
      this.targetGfx.lineBetween(pos.x - radius * 0.55, pos.y - radius * 0.55, pos.x + radius * 0.55, pos.y + radius * 0.55);
      this.targetGfx.lineBetween(pos.x + radius * 0.55, pos.y - radius * 0.55, pos.x - radius * 0.55, pos.y + radius * 0.55);
    } else {
      this.targetGfx.fillStyle(def.trim, alpha * 0.9);
      this.targetGfx.fillRect(pos.x - radius * 0.62, pos.y - radius * 0.12, radius * 1.24, radius * 0.24);
    }
  }

  private popBounce(x: number, y: number): void {
    const text = this.add.text(x, y, 'BOUNCE', {
      fontSize: '16px',
      color: '#9aa4b8',
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_FX);

    this.tweens.add({
      targets: text,
      y: y - 34,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  private popScore(x: number, y: number, points: number, combo: number, perfect: boolean): void {
    const label = perfect ? `PERFECT +${points}` : `+${points}  x${combo}`;
    const text = this.add.text(x, y, label, {
      fontSize: perfect ? '24px' : '20px',
      color: perfect ? THEME.textGold : THEME.text,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_FX);

    this.tweens.add({
      targets: text,
      y: y - 48,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  private showEndScreen(): void {
    this.clearOverlayHitZones();

    const { width, height } = this.scale;
    const panelW = 460;
    const panelH = 280;
    const container = this.add.container(width / 2, height / 2).setDepth(DEPTH_OVERLAY);
    this.overlay = container;

    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.72);
    bg.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
    bg.lineStyle(2, THEME.gold, 0.85);
    bg.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
    container.add(bg);

    const title = this.add.text(0, -panelH / 2 + 42, 'KAME KNOCK', {
      fontSize: '30px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(title);

    const score = this.add.text(0, -18, `FINAL SCORE\n${this.score}`, {
      fontSize: '24px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5);
    container.add(score);

    this.addOverlayButton(container, -110, panelH / 2 - 50, 'PLAY AGAIN', () => {
      this.cleanupSceneResources();
      this.scene.restart();
    });
    this.addOverlayButton(container, 110, panelH / 2 - 50, 'RETURN', () => {
      this.cleanupSceneResources();
      this.scene.start('HubScene');
    });
  }

  private addOverlayButton(
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    label: string,
    onClick: () => void,
  ): void {
    const buttonW = 180;
    const buttonH = 42;
    const bg = this.add.graphics();
    bg.fillStyle(THEME.background, 0.95);
    bg.fillRoundedRect(x - buttonW / 2, y - buttonH / 2, buttonW, buttonH, 8);
    bg.lineStyle(1.5, THEME.gold, 0.85);
    bg.strokeRoundedRect(x - buttonW / 2, y - buttonH / 2, buttonW, buttonH, 8);
    container.add(bg);

    const text = this.add.text(x, y, label, {
      fontSize: '15px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(text);

    const zone = this.add
      .zone(container.x + x, container.y + y, buttonW, buttonH)
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTH_OVERLAY + 2);
    zone.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      zone.disableInteractive();
      onClick();
    });
    this.overlayHitZones.push(zone);
  }

  private clearOverlayHitZones(): void {
    for (const zone of this.overlayHitZones) {
      zone.destroy();
    }
    this.overlayHitZones = [];
  }

  private onResize(): void {
    const oldArena = this.arena;
    this.arena = arenaToScreen(ARENA_01, this.scale.width, this.scale.height);
    const velocityScale = this.arena.scale / oldArena.scale;

    this.slingshot?.cancel();
    if (this.slingshot) {
      this.slingshot.maxDrag = MAX_DRAG_SRC * this.arena.scale;
      this.slingshot.launchSpeed = LAUNCH_SPEED_SRC * this.arena.scale;
    }

    const relX = (this.ball.x - oldArena.cx) / oldArena.rx;
    const relY = (this.ball.y - oldArena.cy) / oldArena.ry;
    this.ball.x = this.arena.cx + relX * this.arena.rx;
    this.ball.y = this.arena.cy + relY * this.arena.ry;
    this.ball.r = BALL_SRC_R * this.arena.scale;
    this.ball.vx *= velocityScale;
    this.ball.vy *= velocityScale;

    this.drawBackground();
    this.drawTargets();
    drawShellBall(this.ballGfx, this.ball);

    this.hudObjects.forEach((object) => object.destroy());
    this.hudObjects = buildReturnButton(this);
    this.scoreText?.setPosition(16, 16);
    this.comboText?.setPosition(16, 44);
    this.ballText?.setPosition(this.scale.width / 2, 16);
    if (this.overlay) {
      this.overlay.destroy(true);
      this.showEndScreen();
    }
  }
}
