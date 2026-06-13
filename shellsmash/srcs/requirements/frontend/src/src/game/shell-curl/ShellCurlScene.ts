/**
 * game/shell-curl/ShellCurlScene.ts — Shell Curl minigame.
 *
 * A two-player hot-seat curling game. Turtle shells slide across an ice sheet
 * toward a target house; teams alternate delivering stones until all are played
 * then score by counting stones in the house.
 */

import Phaser from 'phaser';
import { CURL_SHEET } from '../arenas/curl-sheet';
import {
  rectArenaToScreen,
  drawIceSheet,
  isStoneInHouse,
  isStoneOutOfBounds,
  distanceToHouseButton,
  type RectArenaPixels,
} from '../mechanics/rect-arena';
import {
  type StoneState,
  STONE_SRC_R,
  DEFAULT_CURL_BIAS,
  stepStone,
  resolveStoneCollision,
  drawStone,
} from '../mechanics/stone';
import {
  PowerType,
  PowerRegistry,
  ALL_POWERS,
} from '../mechanics/power-system';
import { TurnManager, type TurnPhase } from '../mechanics/turn-manager';
import { SweepController } from '../mechanics/sweep-controller';
import { ScoreHud } from '../mechanics/score-hud';
import { Slingshot } from '../mechanics/slingshot';
import { buildReturnButton } from '../mechanics/hud';
import { PowerPicker } from './PowerPicker';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Total ends per game. */
const TOTAL_ENDS = 3;

/** Stones each team delivers per end. */
const STONES_PER_TEAM = 4;

/** Max slingshot drag distance in source px. */
const MAX_DRAG_SRC = 280;

/** Full-drag launch speed in source px/s. */
const LAUNCH_SPEED_SRC = 820;

/** Powers available to players in Shell Curl. */
const DEFAULT_POWERS: PowerType[] = [
  PowerType.NONE,
  PowerType.HEAVY,
  PowerType.BOMB,
  PowerType.SPINNING,
  PowerType.SLICK,
];

/** Depth constants (consistent with HubScene). */
const DEPTH_BG       = 0;
const DEPTH_SHEET    = 1;
const DEPTH_STONES   = 2;
const DEPTH_AIM      = 3;
const DEPTH_PARTICLES = 4;
const DEPTH_HUD      = 20;
const DEPTH_OVERLAY  = 100;

/** Pause in ms between end-of-throw and advancing to next turn. */
const SETTLING_DELAY_MS = 800;

// ── Scene ─────────────────────────────────────────────────────────────────────

export class ShellCurlScene extends Phaser.Scene {
  private arena!: RectArenaPixels;

  // ── Game state ────────────────────────────────────────────────────────────
  private turnManager!:  TurnManager;
  private powerRegistry!: PowerRegistry;
  private allStones:     StoneState[]   = [];
  private stoneGfx:      Map<number, Phaser.GameObjects.Graphics> = new Map();
  private activeStone:   StoneState | null = null;
  private activeRingGfx: Phaser.GameObjects.Graphics | null = null;
  private activeRingTween: Phaser.Tweens.Tween | null = null;
  private nextStoneId    = 0;
  private settlingTimer  = 0;

  // ── Mechanics ─────────────────────────────────────────────────────────────
  private slingshot!:     Slingshot;
  private sweepCtrl!:     SweepController;
  private scoreHud!:      ScoreHud;
  private powerPicker!:   PowerPicker;

  // ── Graphics layers ───────────────────────────────────────────────────────
  private bgGfx!:         Phaser.GameObjects.Graphics;
  private sheetGfx!:      Phaser.GameObjects.Graphics;
  private hudObjects:     Phaser.GameObjects.GameObject[] = [];

  // ── Overlay ───────────────────────────────────────────────────────────────
  private overlayContainer: Phaser.GameObjects.Container | null = null;

  constructor() { super({ key: 'ShellCurlScene' }); }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  create(): void {
    this.arena       = rectArenaToScreen(CURL_SHEET, this.scale.width, this.scale.height);
    this.turnManager = new TurnManager({ totalEnds: TOTAL_ENDS, stonesPerTeam: STONES_PER_TEAM });

    // Power registry — register only the subset offered in Shell Curl
    this.powerRegistry = new PowerRegistry();
    // Register all powers so badge colours are always available
    for (const type of Object.values(PowerType)) {
      this.powerRegistry.register(ALL_POWERS[type]);
    }

    // Graphics layers
    this.bgGfx    = this.add.graphics().setDepth(DEPTH_BG);
    this.sheetGfx = this.add.graphics().setDepth(DEPTH_SHEET);

    // Draw background & sheet
    this.drawBackground();
    drawIceSheet(this.sheetGfx, this.arena);

    // HUD
    this.scoreHud    = new ScoreHud(this, DEPTH_HUD);
    this.powerPicker = new PowerPicker(this, this.powerRegistry, DEPTH_HUD);
    this.hudObjects  = buildReturnButton(this);

    // Slingshot (shared mechanic) — starts detached; attached when stone is placed
    this.slingshot = new Slingshot(
      this,
      // Slingshot needs a BallState-like object; we'll swap the target when turns change
      { x: 0, y: 0, vx: 0, vy: 0, r: STONE_SRC_R * this.arena.scale },
      {
        maxDrag:    MAX_DRAG_SRC    * this.arena.scale,
        launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
        depth: DEPTH_AIM,
      },
      (vx, vy) => this.onLaunch(vx, vy),
    );

    // Sweep controller — created with a placeholder stone, swapped each turn
    this.sweepCtrl = new SweepController(this, this.makeEmptyStone(), DEPTH_PARTICLES);

    this.scoreHud.update(this.turnManager.state);
    this.beginTurn();

    this.scale.on('resize', this.onResize, this);
  }

  shutdown(): void {
    this.scale.off('resize', this.onResize, this);
    this.slingshot.destroy();
    this.sweepCtrl.destroy();
    this.scoreHud.destroy();
    this.powerPicker.destroy();
    this.clearAllStoneGfx();
    this.overlayContainer?.destroy(true);
  }

  update(_time: number, delta: number): void {
    const phase = this.turnManager.state.phase;

    if (phase === 'sweeping' && this.activeStone) {
      // Apply sweep friction
      const sweepMult = this.sweepCtrl.update(delta);
      if (sweepMult < 1 && !this.activeStone.stopped) {
        this.activeStone.vx *= sweepMult;
        this.activeStone.vy *= sweepMult;
      }

      // Advance physics
      const moving = stepStone(this.activeStone, delta, this.arena);

      // Apply active power update
      const def = this.powerRegistry.get(this.activeStone.power);
      def.onUpdate?.(this.activeStone, delta, this.arena);

      // Stone-stone collisions
      for (const other of this.allStones) {
        if (other.id === this.activeStone.id) continue;
        const prevStopped = other.stopped;
        resolveStoneCollision(this.activeStone, other);
        if (prevStopped && !other.stopped) {
          // Collision woke a resting stone — let it slide briefly
        }
        // Fire onCollide power hooks
        if (this.stonesOverlapping(this.activeStone, other)) {
          def.onCollide?.(this.activeStone, other, this.arena);
        }
        // Handle splitter
        if (this.activeStone.splitterPending) {
          this.activeStone.splitterPending = false;
          this.spawnSplitStones(this.activeStone);
        }
      }

      // Redraw all stones
      this.redrawAllStones();

      // Check if active stone has stopped or gone out of bounds
      if (!moving || isStoneOutOfBounds(this.activeStone, this.arena)) {
        if (isStoneOutOfBounds(this.activeStone, this.arena)) {
          this.removeStone(this.activeStone);
          this.activeStone = null;
        } else {
          // Stone stopped — fire onStop power hook
          const stopDef = this.powerRegistry.get(this.activeStone.power);
          stopDef.onStop?.(this.activeStone, this.arena, this.allStones);
        }
        this.turnManager.setPhase('settling');
        this.settlingTimer = 0;
      }
    }

    if (phase === 'settling') {
      // Advance all still-moving stones (knock-on effects from BOMB, MAGNET, etc.)
      let anyMoving = false;
      for (const s of this.allStones) {
        if (!s.stopped) {
          stepStone(s, delta, this.arena);
          if (isStoneOutOfBounds(s, this.arena)) {
            this.removeStone(s);
          } else {
            anyMoving = !s.stopped;
          }
        }
      }
      // Stone-stone collisions between coasting stones
      for (let i = 0; i < this.allStones.length; i++) {
        for (let j = i + 1; j < this.allStones.length; j++) {
          resolveStoneCollision(this.allStones[i], this.allStones[j]);
        }
      }
      this.redrawAllStones();

      if (!anyMoving) {
        this.settlingTimer += delta;
        if (this.settlingTimer >= SETTLING_DELAY_MS) {
          this.finishThrow();
        }
      } else {
        this.settlingTimer = 0;
      }
    }
  }

  // ── Turn flow ─────────────────────────────────────────────────────────────

  private beginTurn(): void {
    const state = this.turnManager.state;
    if (state.phase === 'gameover') {
      this.showGameOverOverlay();
      return;
    }

    this.clearActiveRing();

    // Place active stone at delivery hack position
    const stone = this.spawnActiveStone(state.currentTeam);
    this.activeStone = stone;

    // Point the slingshot at this stone
    this.updateSlingshotTarget(stone);
    this.slingshot.attach();

    this.powerPicker.show(DEFAULT_POWERS);
    this.scoreHud.update(state);
    this.addActiveRing(stone);

    this.turnManager.setPhase('aiming');
  }

  private onLaunch(vx: number, vy: number): void {
    if (!this.activeStone || this.turnManager.state.phase !== 'aiming') return;

    // Apply power
    const power = this.powerPicker.getSelected();
    this.activeStone.power = power;
    const def = this.powerRegistry.get(power);
    def.onApply(this.activeStone, this.arena);

    this.activeStone.vx = vx;
    this.activeStone.vy = vy;
    this.activeStone.stopped = false;

    this.slingshot.destroy();
    // Recreate slingshot pointing at the stone for next turn — will be re-attached in beginTurn
    this.slingshot = new Slingshot(
      this,
      { x: 0, y: 0, vx: 0, vy: 0, r: STONE_SRC_R * this.arena.scale },
      {
        maxDrag:    MAX_DRAG_SRC    * this.arena.scale,
        launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
        depth: DEPTH_AIM,
      },
      (lvx, lvy) => this.onLaunch(lvx, lvy),
    );

    this.powerPicker.hide();
    this.clearActiveRing();

    // Re-attach sweep controller to the active stone
    (this.sweepCtrl as unknown as { stone: StoneState }).stone = this.activeStone;
    this.sweepCtrl.attach();

    this.turnManager.setPhase('sweeping');
    this.scoreHud.update(this.turnManager.state);
  }

  private finishThrow(): void {
    this.sweepCtrl.detach();

    // Remove any stones that ended up out of bounds
    // Use a snapshot to avoid mutating allStones while iterating
    const oob = this.allStones.filter(s => isStoneOutOfBounds(s, this.arena));
    for (const s of oob) this.removeStone(s); // removeStone also splices allStones

    const state = this.turnManager.state;
    // stonesLeft still reflects pre-throw counts. After consuming this throw,
    // total remaining = (left[0] + left[1]) - 1. If > 0, more throws remain.
    const totalRemaining = state.stonesLeft[0] + state.stonesLeft[1] - 1;

    if (totalRemaining > 0) {
      this.turnManager.nextThrow();
      this.beginTurn();
    } else {
      // All stones delivered — tally the end
      this.turnManager.setPhase('scoring');
      this.scoreEnd();
    }
  }

  private scoreEnd(): void {
    const inHouse = this.allStones.filter(s => isStoneInHouse(s, this.arena));
    if (inHouse.length === 0) {
      // Blank end
      this.turnManager.endEnd(null, 0);
      this.showEndScoreOverlay(null, 0);
      return;
    }

    // Find closest stone to button
    let bestDist = Infinity;
    let scoringTeam: 0 | 1 = 0;
    for (const s of inHouse) {
      const d = distanceToHouseButton(s, this.arena);
      if (d < bestDist) {
        bestDist    = d;
        scoringTeam = s.teamId;
      }
    }

    // Count scoring stones (all stones of scoring team closer than nearest opponent)
    const opponentDist = inHouse
      .filter(s => s.teamId !== scoringTeam)
      .map(s => distanceToHouseButton(s, this.arena))
      .reduce((min, d) => Math.min(min, d), Infinity);

    const points = inHouse.filter(
      s => s.teamId === scoringTeam && distanceToHouseButton(s, this.arena) < opponentDist,
    ).length;

    // Highlight scoring stones
    this.animateScoringStones(scoringTeam);

    this.turnManager.endEnd(scoringTeam, points);
    this.showEndScoreOverlay(scoringTeam, points);
  }

  // ── Stone management ──────────────────────────────────────────────────────

  private spawnActiveStone(teamId: 0 | 1): StoneState {
    const stone: StoneState = {
      id:       this.nextStoneId++,
      teamId,
      x:        this.arena.sheetX + this.arena.sheetW * (teamId === 0 ? 0.30 : 0.70),
      y:        this.arena.deliveryLineY,
      vx:       0,
      vy:       0,
      r:        STONE_SRC_R * this.arena.scale,
      power:    PowerType.NONE,
      stopped:  true,
      curlBias: DEFAULT_CURL_BIAS * (teamId === 0 ? 1 : -1), // teams curl opposite ways
    };

    const gfx = this.add.graphics().setDepth(DEPTH_STONES);
    this.stoneGfx.set(stone.id, gfx);
    this.allStones.push(stone);
    drawStone(gfx, stone, true);
    return stone;
  }

  private spawnSplitStones(parent: StoneState): void {
    const angles = [-Math.PI / 12, 0, Math.PI / 12];
    const parentSpeed = Math.sqrt(parent.vx * parent.vx + parent.vy * parent.vy);
    const parentAngle = Math.atan2(parent.vy, parent.vx);

    for (const offset of angles) {
      const child: StoneState = {
        id:       this.nextStoneId++,
        teamId:   parent.teamId,
        x:        parent.x,
        y:        parent.y,
        vx:       Math.cos(parentAngle + offset) * parentSpeed * 0.7,
        vy:       Math.sin(parentAngle + offset) * parentSpeed * 0.7,
        r:        parent.r * 0.65,
        power:    PowerType.NONE,
        stopped:  false,
        curlBias: parent.curlBias,
      };

      const gfx = this.add.graphics().setDepth(DEPTH_STONES);
      this.stoneGfx.set(child.id, gfx);
      this.allStones.push(child);
    }

    this.removeStone(parent);
  }

  private removeStone(stone: StoneState): void {
    const gfx = this.stoneGfx.get(stone.id);
    gfx?.destroy();
    this.stoneGfx.delete(stone.id);
    this.allStones = this.allStones.filter(s => s.id !== stone.id);
  }

  private clearAllStoneGfx(): void {
    for (const gfx of this.stoneGfx.values()) gfx.destroy();
    this.stoneGfx.clear();
    this.allStones = [];
  }

  // ── Active ring ───────────────────────────────────────────────────────────

  private addActiveRing(stone: StoneState): void {
    this.clearActiveRing();
    const gfx = this.add.graphics().setDepth(DEPTH_STONES + 1);
    gfx.lineStyle(3, 0xd4a843, 0.6);
    gfx.strokeCircle(stone.x, stone.y, stone.r * 1.45);
    this.activeRingGfx = gfx;
    this.activeRingTween = this.tweens.add({
      targets: gfx, alpha: 0.2, duration: 600, ease: 'Sine.easeInOut',
      yoyo: true, repeat: -1,
    });
  }

  private clearActiveRing(): void {
    this.activeRingTween?.stop();
    this.activeRingGfx?.destroy();
    this.activeRingGfx   = null;
    this.activeRingTween = null;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private drawBackground(): void {
    const { width, height } = this.scale;
    this.bgGfx.clear();
    this.bgGfx.fillStyle(0x0a1f3f, 1);
    this.bgGfx.fillRect(0, 0, width, height);
  }

  private redrawAllStones(): void {
    for (const s of this.allStones) {
      const gfx = this.stoneGfx.get(s.id);
      if (gfx) drawStone(gfx, s, false);
    }
    // Redraw active ring position
    if (this.activeStone && this.activeRingGfx) {
      this.activeRingGfx.clear();
      this.activeRingGfx.lineStyle(3, 0xd4a843, 0.6);
      this.activeRingGfx.strokeCircle(this.activeStone.x, this.activeStone.y, this.activeStone.r * 1.45);
    }
  }

  private animateScoringStones(teamId: 0 | 1): void {
    const colour = teamId === 0 ? 0x2255cc : 0xcc2222;
    for (const s of this.allStones) {
      if (s.teamId !== teamId || !isStoneInHouse(s, this.arena)) continue;
      const gfx = this.stoneGfx.get(s.id);
      if (!gfx) continue;
      this.tweens.add({
        targets: gfx,
        alpha: 0.3,
        duration: 200,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: 4,
        onComplete: () => { gfx.setAlpha(1); },
      });
    }
  }

  // ── Overlays ──────────────────────────────────────────────────────────────

  private showEndScoreOverlay(scoringTeam: 0 | 1 | null, points: number): void {
    const state = this.turnManager.state;
    const message = scoringTeam === null
      ? 'BLANK END — no points'
      : `TEAM ${scoringTeam === 0 ? 'BLUE' : 'RED'} scores ${points} point${points !== 1 ? 's' : ''}!`;

    this.showOverlay(message, state.phase === 'gameover' ? null : 'NEXT END', () => {
      this.clearAllStoneGfx();
      this.beginTurn();
    });
  }

  private showGameOverOverlay(): void {
    const [s0, s1] = this.turnManager.state.score;
    const winner   = s0 > s1 ? 'TEAM BLUE' : s1 > s0 ? 'TEAM RED' : 'DRAW';
    const message  = `${winner} WINS!\nBlue: ${s0}  Red: ${s1}`;
    this.showOverlay(message, null, null);
    this.scoreHud.update(this.turnManager.state);
  }

  private showOverlay(
    message: string,
    buttonLabel: string | null,
    onButton: (() => void) | null,
  ): void {
    this.overlayContainer?.destroy(true);

    const { width, height } = this.scale;
    const c = this.add.container(width / 2, height / 2).setDepth(DEPTH_OVERLAY);

    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.65);
    bg.fillRoundedRect(-240, -80, 480, 160, 12);
    bg.lineStyle(2, 0xd4a843, 0.8);
    bg.strokeRoundedRect(-240, -80, 480, 160, 12);
    c.add(bg);

    const txt = this.add.text(0, -28, message, {
      fontSize: '20px',
      color: '#e6ddd0',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      align: 'center',
    }).setOrigin(0.5);
    c.add(txt);

    if (buttonLabel && onButton) {
      const btnBg = this.add.graphics();
      btnBg.fillStyle(0x1a1005, 0.9);
      btnBg.fillRoundedRect(-80, 20, 160, 38, 6);
      btnBg.lineStyle(1.5, 0xd4a843, 0.8);
      btnBg.strokeRoundedRect(-80, 20, 160, 38, 6);
      c.add(btnBg);

      const btnTxt = this.add.text(0, 39, buttonLabel, {
        fontSize: '14px', color: '#d4a843', fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5);
      c.add(btnTxt);

      const zone = this.add.zone(0, 39, 160, 38).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => {
        this.overlayContainer?.destroy(true);
        this.overlayContainer = null;
        onButton();
      });
      c.add(zone);
    }

    this.overlayContainer = c;

    // Auto-dismiss if no button after 1.5 s
    if (!buttonLabel) {
      this.time.delayedCall(1500, () => {
        this.overlayContainer?.destroy(true);
        this.overlayContainer = null;
        this.beginTurn();
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private updateSlingshotTarget(stone: StoneState): void {
    // The Slingshot class holds a reference to the ball object; we update the
    // underlying object's properties so it tracks the new stone position.
    const ball = (this.slingshot as unknown as { ball: StoneState }).ball;
    if (ball) {
      ball.x = stone.x;
      ball.y = stone.y;
      ball.vx = 0;
      ball.vy = 0;
      ball.r  = stone.r;
    }
  }

  private makeEmptyStone(): StoneState {
    return {
      id: -1, teamId: 0,
      x: 0, y: 0, vx: 0, vy: 0,
      r: STONE_SRC_R * (this.arena?.scale ?? 1),
      power: PowerType.NONE,
      stopped: true,
      curlBias: 0,
    };
  }

  private stonesOverlapping(a: StoneState, b: StoneState): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy) < a.r + b.r;
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  private onResize(): void {
    const oldArena = this.arena;
    this.arena     = rectArenaToScreen(CURL_SHEET, this.scale.width, this.scale.height);

    const vScale   = this.arena.scale / oldArena.scale;

    for (const s of this.allStones) {
      // Rescale position relative to sheet
      s.x = this.arena.sheetX + (s.x - oldArena.sheetX) / oldArena.sheetW * this.arena.sheetW;
      s.y = this.arena.sheetY + (s.y - oldArena.sheetY) / oldArena.sheetH * this.arena.sheetH;
      s.r = STONE_SRC_R * this.arena.scale;
      s.vx *= vScale;
      s.vy *= vScale;
    }

    this.slingshot.cancel();
    this.slingshot.maxDrag      = MAX_DRAG_SRC     * this.arena.scale;
    this.slingshot.launchSpeed  = LAUNCH_SPEED_SRC * this.arena.scale;

    if (this.activeStone) this.updateSlingshotTarget(this.activeStone);

    this.drawBackground();
    drawIceSheet(this.sheetGfx, this.arena);
    this.redrawAllStones();

    this.scoreHud.update(this.turnManager.state);

    this.powerPicker.hide();
    if (this.turnManager.state.phase === 'aiming') {
      this.powerPicker.show(DEFAULT_POWERS);
    }

    this.hudObjects.forEach(o => o.destroy());
    this.hudObjects = buildReturnButton(this);
  }
}
