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
import { ResponsiveScene } from '../../shared/responsive-scene';
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
import { PowerSidePanel } from '../../shared/ui/panels/PowerSidePanel';
import { PowerType } from '../../shared/mechanics/power-system';
import { GAME_POWERS } from '../../shared/mechanics/game-powers';
import {
  applyBallPower,
  BallExtState,
  BALL_FRICTION_BASE,
} from '../../shared/mechanics/ball-powers';
import {
  BOMB_RADIUS_SRC,
  REPEL_RADIUS_SRC,
} from '../../shared/mechanics/power-system';

// Slingshot tuning in arena source px (scaled by the letterbox factor so the
// game feels identical at 1080p, 4K, or a tiny window)
const MAX_DRAG_SRC     = 380;    // max pull distance
const LAUNCH_SPEED_SRC = 1100;   // source px/s at full drag

// Round + spawn tuning
const ROUND_MS        = 30_000;  // countdown length
const SPAWN_EVERY_MS  = 1800;    // cadence of new bamboo while the field has room
const MAX_BAMBOO      = 6;       // max bamboo alive at once
const START_BAMBOO    = 2;       // bamboo present when the round begins
const FREEZE_DURATION_MS = 5_000; // how long FREEZE pauses spawn accumulation

const DEPTH_OVERLAY = 30;
const DEPTH_HUD     = 20;

// Side-panel layout
const SIDE_PANEL_MIN_CANVAS_W = 1_180;
const SIDE_PANEL_MIN_CANVAS_H = 560;
const SIDE_PANEL_MIN_W        = 168;
const SIDE_PANEL_MAX_W        = 230;
const SIDE_PANEL_PAD          = 16;
const SIDE_PANEL_TOP          = 74;
const SCORE_LOG_LIMIT         = 8;

export class BambooBashScene extends ResponsiveScene {
  private bgGfx!:     Phaser.GameObjects.Graphics;
  private bambooGfx!: Phaser.GameObjects.Graphics;
  private ballGfx!:   Phaser.GameObjects.Graphics;

  private arena!: ArenaPixels;
  private ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
  private slingshot!: Slingshot;
  private hudObjects: Phaser.GameObjects.GameObject[] = [];

  private bamboos: Bamboo[] = [];
  private spawnAccMs   = 0;
  private spawnFreezeMs = 0; // FREEZE power: pauses spawn accumulation when > 0

  private score = 0;
  private timeLeftMs = ROUND_MS;
  private running = true;
  private countdownText?: Phaser.GameObjects.Text;

  private scoreText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;

  // ── Side panels ──────────────────────────────────────────────────────────────
  private scoreLogPanel: SidePanel | null = null;
  private scoreEvents:   string[]         = [];

  // ── Power panel ──────────────────────────────────────────────────────────────
  private powerSidePanel: PowerSidePanel | null = null;

  /** Shell power pool for this player (read from registry in create()). */
  private playerPowers: PowerType[] = [PowerType.NONE];
  /** Currently selected power (updated by panel onSelect callback). */
  private activePower:  PowerType   = PowerType.NONE;
  /** Powers already fired this game — one-shot each (NONE is always reusable). */
  private powerUsed: Set<PowerType> = new Set();

  /** True while ball was moving last frame — used to detect the stop transition. */
  private ballWasMoving = false;

  constructor() { super({ key: 'BambooBashScene' }); }

  create(): void {
    // Reset per-round state (scenes are reused across restarts)
    this.bamboos       = [];
    this.spawnAccMs    = 0;
    this.spawnFreezeMs = 0;
    this.score         = 0;
    this.timeLeftMs    = ROUND_MS;
    this.running       = false;   // held until the "3, 2, 1, GO!" countdown finishes
    this.countdownText = undefined;
    this.overlay       = undefined;
    this.scoreLogPanel = null;
    this.scoreEvents   = [];
    this.ballWasMoving = false;
    this.powerUsed     = new Set();
    this.activePower   = PowerType.NONE;

    this.arena = arenaToScreen(ARENA_01, this.scale.width, this.scale.height);
    this.resetBall();

    // Read shell selection from registry (set by ShellPickerScene).
    // BambooBash is single-player — use player0's pool only.
    const sel = this.registry.get('shellSelection') as
      { player0?: string[] } | undefined;
    const specials = (sel?.player0 ?? [])
      .map((s) => s as PowerType)
      .filter((s) => (Object.values(PowerType) as string[]).includes(s) && s !== PowerType.NONE);
    this.playerPowers = [PowerType.NONE, ...new Set(specials)];
    if (this.playerPowers.length <= 1) {
      this.playerPowers = [PowerType.NONE, ...GAME_POWERS['bamboo-bash']];
    }

    this.bgGfx     = this.add.graphics().setDepth(0);
    this.bambooGfx = this.add.graphics().setDepth(1);
    this.ballGfx   = this.add.graphics().setDepth(3);

    this.slingshot = new Slingshot(this, this.ball, {
      maxDrag: MAX_DRAG_SRC * this.arena.scale,
      launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
      depth: 2,
    }, () => this.onLaunch());
    // Slingshot stays detached until the countdown ends so the player can't
    // launch early (attached in beginPlay()).

    for (let i = 0; i < START_BAMBOO; i++) this.spawnBamboo();

    this.drawBackground();
    this.drawBamboos();
    drawShellBall(this.ballGfx, this.ball);
    this.buildHud();
    this.updateSidePanels();
    this.showPowerPanel();

    this.enableResponsive();   // relayout on resize/zoom (see ResponsiveScene)

    this.startCountdown();
  }

  // ── Pre-round countdown ─────────────────────────────────────────────────────

  /** Show "3, 2, 1, GO!" then unlock play. */
  private startCountdown(): void {
    const steps = ['3', '2', '1', 'GO!'];

    this.countdownText = this.add.text(this.scale.width / 2, this.scale.height / 2, '', {
      fontSize: '120px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_OVERLAY);

    const showStep = (i: number): void => {
      const label = steps[i];
      const t = this.countdownText;
      if (!t) return;

      // Kill the previous step's fade-out tween before showing this number — its
      // fade (ends ~780ms) can otherwise finish just after this step's setAlpha(1)
      // (step cadence is 800ms) and stamp alpha back to 0, blanking the number.
      this.tweens.killTweensOf(t);
      t.setText(label).setScale(0.4).setAlpha(1);
      this.tweens.add({
        targets: t,
        scale: label === 'GO!' ? 1.6 : 1.2,
        duration: 650,
        ease: 'Back.easeOut',
      });
      this.tweens.add({
        targets: t,
        alpha: 0,
        delay: 500,
        duration: 280,
        ease: 'Cubic.easeIn',
      });

      if (i < steps.length - 1) {
        this.time.delayedCall(800, () => showStep(i + 1));
      } else {
        this.time.delayedCall(800, () => this.beginPlay());
      }
    };

    showStep(0);
  }

  /** Called when the countdown reaches the end — start the round. */
  private beginPlay(): void {
    this.countdownText?.destroy();
    this.countdownText = undefined;
    this.slingshot.attach();
    this.running = true;
  }

  protected onShutdown(): void {
    this.slingshot.destroy();
    this.overlay?.destroy(true);
    this.powerSidePanel?.destroy();
    this.powerSidePanel = null;
    this.countdownText?.destroy();
    this.destroySidePanels();
  }

  update(_time: number, delta: number): void {
    if (!this.running) return;

    // Countdown
    this.timeLeftMs = Math.max(0, this.timeLeftMs - delta);
    this.timerText.setText(this.formatTime());
    if (this.timeLeftMs <= 0) { this.endRound(); return; }

    // Grow existing bamboo (paused while FREEZE is active)
    this.spawnFreezeMs = Math.max(0, this.spawnFreezeMs - delta);
    for (const b of this.bamboos) stepBamboo(b, delta);

    // Spawn new bamboo on cadence while there's room (pause during freeze)
    if (this.spawnFreezeMs <= 0) {
      this.spawnAccMs += delta;
      if (this.spawnAccMs >= SPAWN_EVERY_MS) {
        this.spawnAccMs = 0;
        if (this.bamboos.length < MAX_BAMBOO) this.spawnBamboo();
      }
    }

    // Ball physics
    const moving = stepBall(this.ball, delta, this.arena);
    const ext    = this.ball as BallExtState;

    // Apply frictionOverride correction (SLICK / BOUNCER / SPINNING)
    if (moving && ext.frictionOverride !== undefined) {
      const factor = Math.pow(ext.frictionOverride / BALL_FRICTION_BASE, delta / 16.67);
      this.ball.vx *= factor;
      this.ball.vy *= factor;
    }

    if (moving) {
      this.checkBambooHits();
    } else {
      // Ball just stopped — resolve pending power flags (idempotent: flags cleared on first check)
      if (ext.phantomHidden) {
        this.ballGfx.setAlpha(1);
        ext.phantomHidden = false;
      }
      if (ext.bombPending) {
        this.resolveStopBomb();
        ext.bombPending = false;
      }
      if (ext.repelPending) {
        this.resolveStopRepel();
        ext.repelPending = false;
      }
      if (ext.freezePending) {
        this.spawnFreezeMs = FREEZE_DURATION_MS;
        ext.freezePending  = false;
      }
    }

    // Show power panel once ball has stopped (transition detection)
    if (!moving && this.ballWasMoving && this.running) {
      this.showPowerPanel();
    }
    this.ballWasMoving = moving;

    this.drawBamboos();
    drawShellBall(this.ballGfx, this.ball);
  }

  // ── Launch handler ────────────────────────────────────────────────────────────

  /**
   * Called by Slingshot after it sets ball.vx / ball.vy.
   * INVARIANT: applyBallPower is called exactly once per shot, AFTER the
   * slingshot has set velocity and AFTER resetBall reset the radius.
   */
  private onLaunch(): void {
    // Reset radius so powers don't stack across shots within the same game
    this.ball.r = BALL_SRC_R * this.arena.scale;

    applyBallPower(this.activePower, this.ball, this.arena);

    // Phantom: hide ball while in motion
    if ((this.ball as BallExtState).phantomHidden) {
      this.ballGfx.setAlpha(0.05);
    }

    // Track used powers (NONE is always reusable)
    if (this.activePower !== PowerType.NONE) {
      this.powerUsed.add(this.activePower);
    }

    // Reset selection to NONE and hide panel while ball is in flight
    this.activePower = PowerType.NONE;
    this.powerSidePanel?.hide();
  }

  // ── Stop-flag resolvers ───────────────────────────────────────────────────────

  private resolveStopBomb(): void {
    const blastR = BOMB_RADIUS_SRC * this.arena.scale;
    const bx = this.ball.x;
    const by = this.ball.y;
    this.bamboos = this.bamboos.filter(b => {
      const pos = bambooPos(b, this.arena);
      return Math.hypot(pos.x - bx, pos.y - by) >= blastR;
    });
    this.drawBamboos();
  }

  private resolveStopRepel(): void {
    const repelR = REPEL_RADIUS_SRC * this.arena.scale;
    const bx = this.ball.x;
    const by = this.ball.y;
    // Bamboos cannot be moved — clear those in range (simulates repel blast)
    this.bamboos = this.bamboos.filter(b => {
      const pos = bambooPos(b, this.arena);
      return Math.hypot(pos.x - bx, pos.y - by) >= repelR;
    });
    this.drawBamboos();
  }

  // ── Gameplay ──────────────────────────────────────────────────────────────

  private spawnBamboo(): void {
    const spot = randomSpot(this.bamboos);
    if (!spot) return;
    this.bamboos.push({ nx: spot.nx, ny: spot.ny, stage: 1, ageMs: 0 });
  }

  private checkBambooHits(): void {
    const ext = this.ball as BallExtState;
    for (let i = this.bamboos.length - 1; i >= 0; i--) {
      const b = this.bamboos[i];
      if (!hitsBamboo(b, this.arena, this.ball.x, this.ball.y, this.ball.r)) continue;

      // GHOST: pass through first bamboo without scoring
      if (ext.ghostUsed === false) {
        ext.ghostUsed = true;
        continue;
      }

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
    this.powerSidePanel?.hide();
    this.updateSidePanels();
    this.submitResult();
    this.showEndScreen();
  }

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
        if (this.overlay !== c) return;
        nameText.setText(me.displayName || me.username || 'You');
      })
      .catch(() => { /* keep the "You" fallback */ });

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
    zone.on('pointerup', (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => {
      event.stopPropagation();
      zone.disableInteractive();
      onClick();
    });
    c.add(zone);
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────

  private buildHud(): void {
    this.hudObjects = buildReturnButton(this);

    this.scoreText = this.add.text(16, 16, `SCORE  ${this.score}`, {
      fontSize: '22px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setDepth(DEPTH_HUD);

    this.timerText = this.add.text(this.scale.width / 2, 16, this.formatTime(), {
      fontSize: '26px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(DEPTH_HUD);
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

    this.bgGfx.fillStyle(0x0a1208, 1);
    this.bgGfx.fillRect(0, 0, width, height);

    const step = Math.round(Math.min(width, height) * 0.065);
    this.bgGfx.lineStyle(1, 0x152410, 0.55);
    for (let x = 0; x < width;  x += step) this.bgGfx.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += step) this.bgGfx.lineBetween(0, y, width, y);

    drawSumoRing(this.bgGfx, this.arena);
  }

  // ── Resize ──────────────────────────────────────────────────────────────────

  protected relayout(): void {
    const oldArena = this.arena;
    this.arena = arenaToScreen(ARENA_01, this.scale.width, this.scale.height);

    this.slingshot.cancel();
    this.slingshot.maxDrag     = MAX_DRAG_SRC * this.arena.scale;
    this.slingshot.launchSpeed = LAUNCH_SPEED_SRC * this.arena.scale;

    const relX = (this.ball.x - oldArena.cx) / oldArena.rx;
    const relY = (this.ball.y - oldArena.cy) / oldArena.ry;
    this.ball.x = this.arena.cx + relX * this.arena.rx;
    this.ball.y = this.arena.cy + relY * this.arena.ry;
    this.ball.r = BALL_SRC_R * this.arena.scale;

    if (isBallMoving(this.ball)) {
      const vScale = this.arena.scale / oldArena.scale;
      this.ball.vx *= vScale;
      this.ball.vy *= vScale;
    }

    this.drawBackground();
    this.drawBamboos();
    drawShellBall(this.ballGfx, this.ball);

    this.hudObjects.forEach((o) => o.destroy());
    this.hudObjects = buildReturnButton(this);
    this.scoreText.setPosition(16, 16);
    this.timerText.setPosition(this.scale.width / 2, 16);
    this.overlay?.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.countdownText?.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.updateSidePanels();
    // Re-show power panel if ball is currently stopped (player can still aim)
    if (!isBallMoving(this.ball) && this.running) {
      this.showPowerPanel();
    } else {
      this.powerSidePanel?.refresh();
    }
  }

  // ── Power panel ──────────────────────────────────────────────────────────────

  private resolveLayout(): { leftPanel?: PanelRect; rightPanel?: PanelRect } {
    const { width, height } = this.scale;
    if (width < SIDE_PANEL_MIN_CANVAS_W || height < SIDE_PANEL_MIN_CANVAS_H) return {};

    const arena      = this.arena;
    const leftFreeW  = arena.cx - arena.rx - SIDE_PANEL_PAD * 2;
    const rightFreeW = width - (arena.cx + arena.rx) - SIDE_PANEL_PAD * 2;
    const panelW     = Math.floor(Math.min(SIDE_PANEL_MAX_W, leftFreeW, rightFreeW));
    if (panelW < SIDE_PANEL_MIN_W) return {};

    const panelH     = height - SIDE_PANEL_TOP - SIDE_PANEL_PAD;
    const leftPanel  = { x: SIDE_PANEL_PAD, y: SIDE_PANEL_TOP, width: panelW, height: panelH };
    const rightPanel = { x: width - SIDE_PANEL_PAD - panelW, y: SIDE_PANEL_TOP, width: panelW, height: panelH };
    return { leftPanel, rightPanel };
  }

  /** Show or refresh the power panel in the left column before each shot. */
  private showPowerPanel(): void {
    const layout = this.resolveLayout();

    if (!this.powerSidePanel) {
      this.powerSidePanel = new PowerSidePanel(
        this,
        (type) => { this.activePower = type; },
        DEPTH_HUD,
      );
    }

    if (!layout.leftPanel) {
      // No room to dock — collapse into an edge drop-down instead of vanishing.
      this.powerSidePanel.showCollapsible('left', this.playerPowers, this.activePower, this.powerUsed);
      return;
    }

    this.powerSidePanel.show(layout.leftPanel, this.playerPowers, this.activePower, this.powerUsed);
  }

  // ── Side panels ─────────────────────────────────────────────────────────────

  private updateSidePanels(): void {
    const layout = this.resolveLayout();
    this.scoreLogPanel ??= new SidePanel(this, DEPTH_HUD);

    const content = {
      title: 'SCORE LOG',
      rows: this.buildScoreLogRows(),
      footerRows: this.buildScoreFooterRows(),
    };

    if (!layout.rightPanel) {
      // No room to dock — collapse into an edge drop-down instead of vanishing.
      this.scoreLogPanel.updateCollapsible('right', content);
      return;
    }

    this.scoreLogPanel.update({ ...content, rect: layout.rightPanel });
  }

  private destroySidePanels(): void {
    this.scoreLogPanel?.destroy();
    this.scoreLogPanel = null;
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
}
