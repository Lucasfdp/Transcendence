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
import { PanelRect, SidePanel, SidePanelRow } from '../../shared/ui/panels/side-panel';
import { PowerType, GameEffectHook, ALL_POWERS } from '../../shared/mechanics/power-system';
import { GAME_POWERS } from '../../shared/mechanics/game-powers';

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

// Side-panel layout
const SIDE_PANEL_MIN_CANVAS_W = 1_180;
const SIDE_PANEL_MIN_CANVAS_H = 560;
const SIDE_PANEL_MIN_W        = 168;
const SIDE_PANEL_MAX_W        = 230;
const SIDE_PANEL_PAD          = 16;
const SIDE_PANEL_TOP          = 74;
const SCORE_LOG_LIMIT         = 8;

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

  private infoPanel:     SidePanel | null = null;
  private scoreLogPanel: SidePanel | null = null;
  private scoreEvents:   string[]         = [];

  /**
   * Shell powers available to the player this game (read from registry).
   * Each power's onActivate is a stub — real effects are implemented incrementally.
   * TODO(#shell-effects-bamboo): implement per-power game effects.
   */
  private playerPowers: PowerType[] = [PowerType.NONE];
  private activePower:  PowerType   = PowerType.NONE;

  constructor() { super({ key: 'BambooBashScene' }); }

  create(): void {
    // Reset per-round state (scenes are reused across restarts)
    this.bamboos = [];
    this.spawnAccMs = 0;
    this.score = 0;
    this.timeLeftMs = ROUND_MS;
    this.running = true;
    this.overlay = undefined;
    this.infoPanel = null;
    this.scoreLogPanel = null;
    this.scoreEvents = [];

    this.arena = arenaToScreen(ARENA_01, this.scale.width, this.scale.height);
    this.resetBall();

    // Read shell selection from registry (set by ShellPickerScene).
    // Falls back to the full GAME_POWERS list for bamboo-bash if nothing was selected.
    const sel = this.registry.get('shellSelection') as
      { player0?: string[] } | undefined;
    const specials = (sel?.player0 ?? [])
      .map((s) => s as PowerType)
      .filter((s) => (Object.values(PowerType) as string[]).includes(s) && s !== PowerType.NONE);
    this.playerPowers = [PowerType.NONE, ...new Set(specials)];
    if (this.playerPowers.length <= 1) {
      this.playerPowers = [PowerType.NONE, ...GAME_POWERS['bamboo-bash']];
    }
    this.activePower = PowerType.NONE;

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
    this.updateSidePanels();

    this.scale.on('resize', this.onResize, this);
  }

  shutdown(): void {
    this.scale.off('resize', this.onResize, this);
    this.slingshot.destroy();
    this.overlay?.destroy(true);
    this.destroySidePanels();
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
      this.addScoreEvent(`Stage ${b.stage} bamboo`, `+${points}`);
      this.bamboos.splice(i, 1);
    }
  }

  private endRound(): void {
    this.running = false;
    this.timerText.setText(this.formatTime());
    this.slingshot.cancel();
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.updateSidePanels();
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
    this.updateSidePanels();
  }

  // ── Side panels ─────────────────────────────────────────────────────────────

  private resolveLayout(): { leftPanel?: PanelRect; rightPanel?: PanelRect } {
    const { width, height } = this.scale;
    if (width < SIDE_PANEL_MIN_CANVAS_W || height < SIDE_PANEL_MIN_CANVAS_H) return {};

    const arena       = this.arena;
    const leftFreeW   = arena.cx - arena.rx - SIDE_PANEL_PAD * 2;
    const rightFreeW  = width - (arena.cx + arena.rx) - SIDE_PANEL_PAD * 2;
    const panelW      = Math.floor(Math.min(SIDE_PANEL_MAX_W, leftFreeW, rightFreeW));
    if (panelW < SIDE_PANEL_MIN_W) return {};

    const panelH    = height - SIDE_PANEL_TOP - SIDE_PANEL_PAD;
    const leftPanel  = { x: SIDE_PANEL_PAD, y: SIDE_PANEL_TOP, width: panelW, height: panelH };
    const rightPanel = { x: width - SIDE_PANEL_PAD - panelW, y: SIDE_PANEL_TOP, width: panelW, height: panelH };
    return { leftPanel, rightPanel };
  }

  private updateSidePanels(): void {
    const layout = this.resolveLayout();
    if (!layout.leftPanel || !layout.rightPanel) {
      this.destroySidePanels();
      return;
    }

    this.infoPanel     ??= new SidePanel(this, 20);
    this.scoreLogPanel ??= new SidePanel(this, 20);

    this.infoPanel.update({
      title: 'BAMBOO GUIDE',
      rect: layout.leftPanel,
      rows: this.buildInfoRows(),
    });
    this.scoreLogPanel.update({
      title: 'SCORE LOG',
      rect: layout.rightPanel,
      rows: this.buildScoreLogRows(),
      footerRows: this.buildScoreFooterRows(),
    });
  }

  private destroySidePanels(): void {
    this.infoPanel?.destroy();
    this.scoreLogPanel?.destroy();
    this.infoPanel     = null;
    this.scoreLogPanel = null;
  }

  private buildInfoRows(): SidePanelRow[] {
    return [
      { label: 'Stage 1', subtitle: '+100 pts', icon: (g, x, y, s) => this.drawBambooIcon(g, x, y, s, 1) },
      { label: 'Stage 2', subtitle: '+150 pts', icon: (g, x, y, s) => this.drawBambooIcon(g, x, y, s, 2) },
      { label: 'Stage 3', subtitle: '+250 pts', icon: (g, x, y, s) => this.drawBambooIcon(g, x, y, s, 3) },
      { label: 'Grows every 5s', muted: true },
      { label: '30s round',      muted: true },
    ];
  }

  private buildScoreLogRows(): SidePanelRow[] {
    if (this.scoreEvents.length === 0) return [{ label: 'No scores yet', muted: true }];
    return this.scoreEvents.map((event, index) => {
      const [label, value] = event.split('\t');
      return { label, value, muted: index > 3 };
    });
  }

  private buildScoreFooterRows(): SidePanelRow[] {
    return [{
      label: 'SCORE',
      value: String(this.score),
      labelColor: THEME.textGold,
      valueColor: THEME.textGold,
      labelFontSize: '14px',
      valueFontSize: '24px',
    }];
  }

  private addScoreEvent(label: string, value: string): void {
    this.scoreEvents.unshift(`${label}\t${value}`);
    this.scoreEvents = this.scoreEvents.slice(0, SCORE_LOG_LIMIT);
    this.updateSidePanels();
  }

  /** Draw a mini bamboo cluster icon with `stage` canes, centred at (x, y). */
  private drawBambooIcon(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    size: number,
    stage: number,
  ): void {
    const caneW  = Math.max(2, size * 0.18);
    const caneH  = size * (0.55 + stage * 0.12);
    const spread = caneW + 2;
    const topY   = y - caneH * 0.65;

    for (let i = 0; i < stage; i++) {
      const offset = stage === 1 ? 0 : (i - (stage - 1) / 2) * spread;
      const cx     = x + offset;

      g.fillStyle(0x4e9a3a, 1);
      g.fillRect(cx - caneW / 2, topY, caneW, caneH);

      g.lineStyle(Math.max(1, caneW * 0.3), 0x2c5a1e, 0.9);
      g.lineBetween(cx - caneW / 2, topY + caneH * 0.4, cx + caneW / 2, topY + caneH * 0.4);
      g.lineBetween(cx - caneW / 2, topY + caneH * 0.75, cx + caneW / 2, topY + caneH * 0.75);
    }
  }
}
