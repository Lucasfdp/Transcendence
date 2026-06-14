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
import { BallState, BALL_SRC_R, drawShellBall, stepBall } from '../../shared/mechanics/ball';
import { Slingshot } from '../../shared/mechanics/slingshot';
import { buildReturnButton } from '../../shared/mechanics/hud';
import { showAchievementUnlocks } from '../../shared/achievement-popup';
import { PanelRect, SidePanel, SidePanelRow } from '../../shared/ui/panels/side-panel';
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
import { PowerType } from '../../shared/mechanics/power-system';
import { GAME_POWERS } from '../../shared/mechanics/game-powers';

interface BallRoundConfig {
  readonly totalTargets: number;
  readonly breakableTargets: number;
}

interface KameKnockLayout {
  readonly leftPanel?: PanelRect;
  readonly rightPanel?: PanelRect;
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
const SIDE_PANEL_MIN_CANVAS_W = 1_180;
const SIDE_PANEL_MIN_CANVAS_H = 560;
const SIDE_PANEL_MIN_W = 168;
const SIDE_PANEL_MAX_W = 230;
const SIDE_PANEL_PAD = 16;
const SIDE_PANEL_TOP = 74;
const SCORE_LOG_LIMIT = 8;

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
  private scoreEvents: string[] = [];

  private ballText: Phaser.GameObjects.Text | null = null;
  private infoPanel: SidePanel | null = null;
  private scoreLogPanel: SidePanel | null = null;
  private overlay?: Phaser.GameObjects.Container;
  private overlayHitZones: Phaser.GameObjects.Zone[] = [];

  /** Power pool for the current player, populated from ShellPickerScene registry. */
  private playerPowers: PowerType[] = [PowerType.NONE, ...GAME_POWERS['kame-knock']];
  /** Currently active power (NONE = no power selected). */
  private activePower: PowerType = PowerType.NONE;

  constructor() { super({ key: 'KameKnockScene' }); }

  /**
   * Phaser lifecycle — called automatically on scene stop/switch/restart.
   * Replaces the old once(SHUTDOWN, cleanupSceneResources) pattern, which
   * caused cleanupSceneResources() to be called twice when the overlay buttons
   * called it manually before scene.start()/scene.restart().
   */
  shutdown(): void {
    this.cleanupSceneResources();
  }

  create(): void {

    this.targets = [];
    this.nextTargetId = 0;
    this.currentBallIndex = 0;
    this.launchedThisBall = false;
    this.score = 0;
    this.combo = 0;
    this.running = true;
    this.scoreEvents = [];
    this.overlay = undefined;
    this.ballText = null;
    this.infoPanel = null;
    this.scoreLogPanel = null;

    this.arena = this.resolveArena();
    this.resetBall();

    // Read shell selection from registry (set by ShellPickerScene).
    // KameKnock uses player0's selection as the single active power pool.
    const sel = this.registry.get('shellSelection') as
      { player0?: string[] } | undefined;
    const specials = (sel?.player0 ?? [])
      .map((s) => s as PowerType)
      .filter((s) => (Object.values(PowerType) as string[]).includes(s) && s !== PowerType.NONE);
    this.playerPowers = [PowerType.NONE, ...new Set(specials)];
    if (this.playerPowers.length <= 1) {
      this.playerPowers = [PowerType.NONE, ...GAME_POWERS['kame-knock']];
    }
    this.activePower = PowerType.NONE;

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
    this.updateSidePanels();

    this.scale.on('resize', this.onResize, this);
  }

  private cleanupSceneResources(): void {
    this.scale.off('resize', this.onResize, this);
    this.slingshot?.destroy();
    this.slingshot = null;
    this.clearOverlayHitZones();
    this.overlay?.destroy(true);
    this.overlay = undefined;
    this.destroySidePanels();
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
    if (this.scoreLogPanel) this.updateSidePanels();
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
      this.addScoreEvent(`${TARGET_COLOURS[target.kind].label}  +${gained}`, perfect ? 'PERFECT' : `x${this.combo}`);

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
    this.updateSidePanels();
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
      showAchievementUnlocks(this, result.unlockedAchievements ?? []);
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

    this.ballText = this.add.text(this.scale.width / 2, 16, this.formatBallText(), {
      fontSize: '26px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(DEPTH_HUD);
  }

  private resolveArena(): ArenaPixels {
    return arenaToScreen(ARENA_01, this.scale.width, this.scale.height);
  }

  private resolveLayout(): KameKnockLayout {
    const { width, height } = this.scale;

    if (width < SIDE_PANEL_MIN_CANVAS_W || height < SIDE_PANEL_MIN_CANVAS_H) {
      return {};
    }

    const arena = this.arena ?? this.resolveArena();
    const leftFreeW = arena.cx - arena.rx - SIDE_PANEL_PAD * 2;
    const rightFreeW = width - (arena.cx + arena.rx) - SIDE_PANEL_PAD * 2;
    const panelW = Math.floor(Math.min(SIDE_PANEL_MAX_W, leftFreeW, rightFreeW));

    if (panelW < SIDE_PANEL_MIN_W) return {};

    const panelH = height - SIDE_PANEL_TOP - SIDE_PANEL_PAD;
    const leftPanel = { x: SIDE_PANEL_PAD, y: SIDE_PANEL_TOP, width: panelW, height: panelH };
    const rightPanel = { x: width - SIDE_PANEL_PAD - panelW, y: SIDE_PANEL_TOP, width: panelW, height: panelH };

    return { leftPanel, rightPanel };
  }

  private updateSidePanels(): void {
    const layout = this.resolveLayout();
    if (!layout.leftPanel || !layout.rightPanel) {
      this.destroySidePanels();
      return;
    }

    this.infoPanel ??= new SidePanel(this, DEPTH_HUD);
    this.scoreLogPanel ??= new SidePanel(this, DEPTH_HUD);

    this.infoPanel.update({
      title: 'TARGET VALUES',
      rect: layout.leftPanel,
      rows: this.buildInfoRows(),
    });
    this.scoreLogPanel.update({
      title: 'SCORE LOG',
      rect: layout.rightPanel,
      rows: this.buildScoreLogRows(),
      footerRows: this.buildScoreStatusRows(),
    });
  }

  private destroySidePanels(): void {
    this.infoPanel?.destroy();
    this.scoreLogPanel?.destroy();
    this.infoPanel = null;
    this.scoreLogPanel = null;
  }

  private buildInfoRows(): SidePanelRow[] {
    return [
      // subtitle format used for long labels to prevent value-column overlap
      { label: 'Shell ball', subtitle: 'bounces off targets', icon: (g, x, y, size) => this.drawShellIcon(g, x, y, size / 2) },
      { label: 'Daruma',     value: '+100', icon: (g, x, y, size) => this.drawTargetIcon(g, x, y, size / 2, 'daruma', true) },
      { label: 'Crate',      value: '+120', icon: (g, x, y, size) => this.drawTargetIcon(g, x, y, size / 2, 'crate', true) },
      { label: 'Drum',       value: '+150', icon: (g, x, y, size) => this.drawTargetIcon(g, x, y, size / 2, 'drum', true) },
      { label: 'Solid target', subtitle: 'no score — bounces', icon: (g, x, y, size) => this.drawTargetIcon(g, x, y, size / 2, 'drum', false) },
      { label: 'Perfect hit', value: '+500', icon: (g, x, y, size) => this.drawSparkIcon(g, x, y, size / 2) },
      { label: 'Combo',       value: 'x chain', icon: (g, x, y, size) => this.drawComboIcon(g, x, y, size / 2) },
    ];
  }

  private buildScoreLogRows(): SidePanelRow[] {
    if (this.scoreEvents.length === 0) return [{ label: 'No scores yet', muted: true }];

    return this.scoreEvents.map((event, index) => {
      const [label, value] = event.split('\t');
      return {
        label,
        value,
        muted: index > 3,
      };
    });
  }

  private buildScoreStatusRows(): SidePanelRow[] {
    return [
      {
        label: 'COMBO',
        value: `x${Math.max(1, this.combo)}`,
        labelColor: THEME.text,
        valueColor: THEME.text,
        labelFontSize: '13px',
        valueFontSize: '18px',
      },
      {
        label: 'SCORE',
        value: String(this.score),
        labelColor: THEME.textGold,
        valueColor: THEME.textGold,
        labelFontSize: '14px',
        valueFontSize: '24px',
      },
    ];
  }

  private addScoreEvent(label: string, value: string): void {
    this.scoreEvents.unshift(`${label}\t${value}`);
    this.scoreEvents = this.scoreEvents.slice(0, SCORE_LOG_LIMIT);
    this.updateSidePanels();
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
    const pulse = 0.88 + Math.sin(target.ageMs * 0.006) * 0.12;
    const alpha = target.breakable ? 1 : 0.92;

    this.drawTargetBody(this.targetGfx, pos.x, pos.y, radius, target.kind, target.breakable, pulse, alpha);
  }

  private drawTargetIcon(g: Phaser.GameObjects.Graphics, x: number, y: number, radius: number, kind: TimedTargetKind, breakable: boolean): void {
    this.drawTargetBody(g, x, y, radius, kind, breakable, 0.96, breakable ? 1 : 0.92);
  }

  private drawTargetBody(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    kind: TimedTargetKind,
    breakable: boolean,
    pulse: number,
    alpha: number,
  ): void {
    const def = TARGET_COLOURS[kind];

    g.fillStyle(0x000000, 0.20 * alpha);
    g.fillEllipse(x + radius * 0.25, y + radius * 0.45, radius * 2.1, radius * 0.8);
    g.fillStyle(breakable ? def.body : 0x4d5566, alpha);
    g.fillCircle(x, y, radius * pulse);
    g.lineStyle(Math.max(2, radius * 0.12), breakable ? def.trim : 0x9aa4b8, alpha);
    g.strokeCircle(x, y, radius * 0.78);

    if (!breakable) {
      g.lineStyle(Math.max(2, radius * 0.09), 0xffffff, 0.75);
      g.strokeCircle(x, y, radius * 1.08);
      g.lineBetween(x - radius * 0.45, y, x + radius * 0.45, y);
      g.lineBetween(x, y - radius * 0.45, x, y + radius * 0.45);
      return;
    }

    if (kind === 'daruma') {
      g.fillStyle(0xffffff, alpha);
      g.fillCircle(x - radius * 0.28, y - radius * 0.18, radius * 0.14);
      g.fillCircle(x + radius * 0.28, y - radius * 0.18, radius * 0.14);
    } else if (kind === 'crate') {
      g.lineStyle(Math.max(1, radius * 0.08), def.trim, alpha);
      g.lineBetween(x - radius * 0.55, y - radius * 0.55, x + radius * 0.55, y + radius * 0.55);
      g.lineBetween(x + radius * 0.55, y - radius * 0.55, x - radius * 0.55, y + radius * 0.55);
    } else {
      g.fillStyle(def.trim, alpha * 0.9);
      g.fillRect(x - radius * 0.62, y - radius * 0.12, radius * 1.24, radius * 0.24);
    }
  }

  private drawShellIcon(g: Phaser.GameObjects.Graphics, x: number, y: number, radius: number): void {
    g.fillStyle(0x000000, 0.22);
    g.fillEllipse(x + radius * 0.3, y + radius * 0.5, radius * 2.4, radius * 0.9);
    g.fillStyle(0x2a7fd4, 1);
    g.fillCircle(x, y, radius);
    g.fillStyle(0x1a5fa8, 1);
    g.fillCircle(x + radius * 0.25, y - radius * 0.12, radius * 0.38);
    g.fillCircle(x - radius * 0.22, y + radius * 0.28, radius * 0.30);
    g.fillCircle(x + radius * 0.08, y + radius * 0.52, radius * 0.22);
    g.fillStyle(0xffffff, 0.55);
    g.fillCircle(x - radius * 0.28, y - radius * 0.30, radius * 0.22);
  }

  private drawSparkIcon(g: Phaser.GameObjects.Graphics, x: number, y: number, radius: number): void {
    g.lineStyle(2, THEME.gold, 0.95);
    g.lineBetween(x - radius, y, x + radius, y);
    g.lineBetween(x, y - radius, x, y + radius);
    g.lineBetween(x - radius * 0.7, y - radius * 0.7, x + radius * 0.7, y + radius * 0.7);
    g.lineBetween(x + radius * 0.7, y - radius * 0.7, x - radius * 0.7, y + radius * 0.7);
    g.fillStyle(THEME.gold, 0.95);
    g.fillCircle(x, y, radius * 0.26);
  }

  private drawComboIcon(g: Phaser.GameObjects.Graphics, x: number, y: number, radius: number): void {
    g.lineStyle(2, THEME.textMuted, 0.9);
    g.strokeCircle(x - radius * 0.32, y, radius * 0.54);
    g.strokeCircle(x + radius * 0.32, y, radius * 0.54);
    g.fillStyle(THEME.gold, 0.95);
    g.fillCircle(x, y, radius * 0.18);
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
    // Use 'pointerup' (not 'pointerdown') so the full click cycle completes inside
    // this scene before the transition fires. Using 'pointerdown' caused scene.start()
    // to run while the mouse button was still physically held — the subsequent mouseup
    // then arrived in HubScene's fresh InputPlugin with no zones registered yet,
    // corrupting Phaser's _tempHits/_overObjectsContainer state and breaking all
    // subsequent pointerup delivery in HubScene.
    zone.on('pointerup', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
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
    this.arena = this.resolveArena();
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
    this.ballText?.setPosition(this.scale.width / 2, 16);
    this.updateSidePanels();
    if (this.overlay) {
      this.overlay.destroy(true);
      this.showEndScreen();
    }
  }
}
