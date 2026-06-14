/**
 * game/shell-curl/ShellCurlScene.ts — Shell Curl minigame.
 *
 * A two-player hot-seat curling game. Turtle shells slide across an ice sheet
 * toward a target house; teams alternate delivering stones until all are played
 * then score by counting stones in the house.
 */

import Phaser from 'phaser';
import { api } from '../../hub/api';
import { CURL_SHEET } from '../../shared/arenas/curl-sheet';
import {
  rectArenaToScreen,
  drawIceSheet,
  isStoneInHouse,
  isStoneOutOfBounds,
  distanceToHouseButton,
  type RectArenaPixels,
} from '../../shared/mechanics/rect-arena';
import {
  type StoneState,
  STONE_SRC_R,
  DEFAULT_CURL_BIAS,
  stepStone,
  resolveStoneCollision,
  drawStone,
} from '../../shared/mechanics/stone';
import {
  PowerType,
  PowerRegistry,
  ALL_POWERS,
} from '../../shared/mechanics/power-system';
import { TurnManager, type TurnPhase } from '../../shared/mechanics/turn-manager';
import { SweepController } from '../../shared/mechanics/sweep-controller';
import { ScoreHud } from '../../shared/mechanics/score-hud';
import { showAchievementUnlocks } from '../../shared/achievement-popup';
import { Slingshot } from '../../shared/mechanics/slingshot';
import { buildReturnButton } from '../../shared/mechanics/hud';
import { PowerSidePanel } from './PowerSidePanel';
import { PanelRect } from '../../shared/ui/panels/side-panel';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Total ends per game. */
const TOTAL_ENDS = 3;

/** Stones each team delivers per end. */
const STONES_PER_TEAM = 4;

/** Max slingshot drag distance in source px. */
const MAX_DRAG_SRC = 450;

/** Slingshot grab zone = stone radius × this factor. Larger = easier to grab. */
const GRAB_RADIUS_FACTOR = 6.0;

/** Full-drag launch speed in source px/s. */
const LAUNCH_SPEED_SRC = 3300;

/**
 * Fallback power set used when no shell selection is in the registry
 * (e.g. the player launched the scene directly without going through the picker).
 */
const FALLBACK_POWERS: PowerType[] = [
  PowerType.NONE,
  PowerType.HEAVY,
  PowerType.BOMB,
  PowerType.SPLITTER,
  PowerType.GHOST,
  PowerType.MAGNET,
  PowerType.SPINNING,
  PowerType.BOUNCER,
  PowerType.SHIELD,
  PowerType.FREEZE,
  PowerType.SLICK,
];

/** Depth constants (consistent with HubScene). */
const DEPTH_BG        = 0;
const DEPTH_SHEET     = 1;
const DEPTH_BUMPERS   = 1.5;  // between ice sheet and stones
const DEPTH_STONES    = 2;
const DEPTH_AIM       = 3;
const DEPTH_PARTICLES = 4;
const DEPTH_HUD       = 20;
const DEPTH_OVERLAY   = 100;

/** Pause in ms between end-of-throw and advancing to next turn. */
const SETTLING_DELAY_MS = 800;

// Side-panel layout — panel sits in the LEFT strip beside the sheet.
// Min width is deliberately lower than other games because the curling sheet
// already has a reserved left margin (see curl-sheet.ts sheetX: 230).
const SIDE_PANEL_MIN_W  = 110;
const SIDE_PANEL_MAX_W  = 200;
const SIDE_PANEL_PAD    = 12;
const SIDE_PANEL_TOP    = 74;

// ── Pinball bumpers ───────────────────────────────────────────────────────────

interface BumperDef { readonly fx: number; readonly fy: number; }

interface Bumper {
  x: number; y: number; r: number;
  readonly fx: number; readonly fy: number;
  flashTimer: number; // ms remaining for hit-flash visual
}

/**
 * Generate random bumper positions for one end.
 * Bumpers are placed in the middle 15%–58% of the sheet width so the
 * delivery zone and the house approach remain clear.
 * Rejection-sampling ensures no two bumpers are closer than MIN_SEP.
 */
function generateBumperDefs(): BumperDef[] {
  const count  = 5 + Math.floor(Math.random() * 4); // 5–8 bumpers
  const MIN_SEP = 0.13; // minimum fractional distance between bumper centres
  const defs: BumperDef[] = [];
  let attempts = 0;

  while (defs.length < count && attempts < 300) {
    attempts++;
    const fx = 0.15 + Math.random() * 0.43; // 15%–58% along sheet
    const fy = 0.10 + Math.random() * 0.80; // 10%–90% up sheet

    const clear = defs.every(d => {
      const dx = d.fx - fx;
      const dy = d.fy - fy;
      return Math.sqrt(dx * dx + dy * dy) >= MIN_SEP;
    });

    if (clear) defs.push({ fx, fy });
  }

  return defs;
}

const BUMPER_RADIUS_SRC = 28;   // source px — same as stone radius
const BUMPER_FLASH_MS   = 130;  // duration of hit-flash glow
const BUMPER_BOOST      = 1.10; // 10% speed boost on bumper hit (pinball feel)

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
  private slingshot!:  Slingshot;
  private sweepCtrl!:  SweepController;
  private scoreHud!:   ScoreHud;

  // ── Graphics layers ───────────────────────────────────────────────────────
  private bgGfx!:      Phaser.GameObjects.Graphics;
  private sheetGfx!:   Phaser.GameObjects.Graphics;
  private bumperGfx!:  Phaser.GameObjects.Graphics;
  private hudObjects:  Phaser.GameObjects.GameObject[] = [];

  // ── Bumpers ───────────────────────────────────────────────────────────────
  private bumpers:     Bumper[] = [];

  // ── Overlay ───────────────────────────────────────────────────────────────
  private overlayContainer: Phaser.GameObjects.Container | null = null;

  // ── Power side panel (replaces the bottom PowerPicker bar) ────────────────
  private powerSidePanel: PowerSidePanel | null = null;

  // ── Per-player power pools (read from registry, set in create()) ──────────
  private playerPowers: [PowerType[], PowerType[]] = [FALLBACK_POWERS, FALLBACK_POWERS];

  constructor() { super({ key: 'ShellCurlScene' }); }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  create(): void {
    this.arena       = rectArenaToScreen(CURL_SHEET, this.scale.width, this.scale.height);
    this.turnManager = new TurnManager({ totalEnds: TOTAL_ENDS, stonesPerTeam: STONES_PER_TEAM });

    // Read per-player shell selections from the registry (set by ShellPickerScene).
    // Falls back to FALLBACK_POWERS if no selection is present (direct launch / dev).
    const sel = this.registry.get('shellSelection') as
      { player0?: string[]; player1?: string[] } | undefined;

    const buildPool = (picks: string[] | undefined): PowerType[] => {
      const specials = (picks ?? [])
        .map((s) => s as PowerType)
        .filter((s) => (Object.values(PowerType) as string[]).includes(s) && s !== PowerType.NONE);
      return [PowerType.NONE, ...new Set(specials)];
    };

    const p0 = buildPool(sel?.player0);
    const p1 = buildPool(sel?.player1);
    this.playerPowers = [
      p0.length > 1 ? p0 : FALLBACK_POWERS,
      p1.length > 1 ? p1 : FALLBACK_POWERS,
    ];

    // Power registry — register ALL powers so the registry can always resolve any type
    this.powerRegistry = new PowerRegistry();
    for (const type of Object.values(PowerType)) {
      this.powerRegistry.register(ALL_POWERS[type]);
    }

    // Graphics layers
    this.bgGfx    = this.add.graphics().setDepth(DEPTH_BG);
    this.sheetGfx = this.add.graphics().setDepth(DEPTH_SHEET);
    this.bumperGfx = this.add.graphics().setDepth(DEPTH_BUMPERS);

    // Draw background & sheet
    this.drawBackground();
    drawIceSheet(this.sheetGfx, this.arena);
    this.buildBumpers();
    this.drawBumpers();

    // HUD
    this.scoreHud   = new ScoreHud(this, DEPTH_HUD);
    this.hudObjects = buildReturnButton(this);

    // Slingshot (shared mechanic) — starts detached; attached when stone is placed
    this.slingshot = new Slingshot(
      this,
      // Slingshot needs a BallState-like object; we'll swap the target when turns change
      { x: 0, y: 0, vx: 0, vy: 0, r: STONE_SRC_R * this.arena.scale },
      {
        maxDrag:          MAX_DRAG_SRC     * this.arena.scale,
        launchSpeed:      LAUNCH_SPEED_SRC * this.arena.scale,
        grabRadiusFactor: GRAB_RADIUS_FACTOR,
        depth: DEPTH_AIM,
      },
      (vx, vy) => this.onLaunch(vx, vy),
    );

    // Sweep controller — created with a placeholder stone, swapped each turn
    this.sweepCtrl = new SweepController(this, this.makeEmptyStone(), DEPTH_PARTICLES);

    this.scoreHud.update(this.turnManager.state);
    this.beginTurn(); // calls showPowerPanel() internally

    this.scale.on('resize', this.onResize, this);
  }

  shutdown(): void {
    this.scale.off('resize', this.onResize, this);
    this.slingshot.destroy();
    this.sweepCtrl.destroy();
    this.scoreHud.destroy();
    this.powerSidePanel?.destroy();
    this.powerSidePanel = null;
    this.clearAllStoneGfx();
    this.bumperGfx.destroy();
    this.overlayContainer?.destroy(true);
  }

  update(_time: number, delta: number): void {
    const phase = this.turnManager.state.phase;

    if (phase === 'sweeping' && this.activeStone) {
      // Apply sweep friction to active stone only
      const sweepMult = this.sweepCtrl.update(delta);
      if (sweepMult < 1 && !this.activeStone.stopped) {
        this.activeStone.vx *= sweepMult;
        this.activeStone.vy *= sweepMult;
      }

      // Step ALL moving stones this frame so knocked stones move immediately
      for (const s of this.allStones) {
        if (!s.stopped) stepStone(s, delta, this.arena);
      }

      // Apply active power update
      const def = this.powerRegistry.get(this.activeStone.power);
      def.onUpdate?.(this.activeStone, delta, this.arena);

      // Active-stone collisions: check overlap BEFORE resolving so onCollide
      // fires on first contact (resolution pushes stones apart, breaking the check).
      for (const other of this.allStones) {
        if (!this.activeStone) break;
        if (other.id === this.activeStone.id) continue;
        const colliding = this.stonesOverlapping(this.activeStone, other);
        resolveStoneCollision(this.activeStone, other);
        if (colliding) {
          def.onCollide?.(this.activeStone, other, this.arena);
        }
        if (this.activeStone?.splitterPending) {
          this.activeStone.splitterPending = false;
          this.spawnSplitStones(this.activeStone);
          this.activeStone = null;
          break;
        }
      }
      // Resolve collisions between all other stone pairs
      for (let i = 0; i < this.allStones.length; i++) {
        for (let j = i + 1; j < this.allStones.length; j++) {
          const si = this.allStones[i];
          const sj = this.allStones[j];
          if (this.activeStone && (si.id === this.activeStone.id || sj.id === this.activeStone.id)) continue;
          resolveStoneCollision(si, sj);
        }
      }

      // Bumper collisions for all moving stones
      this.resolveStoneBumperCollisions(this.allStones);

      // Decay bumper flash timers
      let needBumperRedraw = false;
      for (const b of this.bumpers) {
        if (b.flashTimer > 0) {
          b.flashTimer = Math.max(0, b.flashTimer - delta);
          needBumperRedraw = true;
        }
      }
      if (needBumperRedraw) this.drawBumpers();

      // Redraw all stones
      this.redrawAllStones();

      // Transition to settling once the active stone stops, leaves bounds, or was split
      const as = this.activeStone;
      if (!as || as.stopped || isStoneOutOfBounds(as, this.arena)) {
        if (as) {
          if (isStoneOutOfBounds(as, this.arena)) {
            this.removeStone(as);
          } else {
            const stopDef = this.powerRegistry.get(as.power);
            stopDef.onStop?.(as, this.arena, this.allStones);
          }
        }
        this.activeStone = null;
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
            anyMoving = anyMoving || !s.stopped;
          }
        }
      }
      // Stone-stone collisions between coasting stones
      for (let i = 0; i < this.allStones.length; i++) {
        for (let j = i + 1; j < this.allStones.length; j++) {
          resolveStoneCollision(this.allStones[i], this.allStones[j]);
        }
      }
      // Bumper collisions in settling phase
      this.resolveStoneBumperCollisions(this.allStones);
      // Re-check anyMoving after bumper hits (bumpers can re-launch stopped stones)
      for (const s of this.allStones) {
        if (!s.stopped) anyMoving = true;
      }
      // Decay bumper flash timers
      for (const b of this.bumpers) {
        if (b.flashTimer > 0) b.flashTimer = Math.max(0, b.flashTimer - delta);
      }
      this.drawBumpers();
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

    this.scoreHud.update(state);
    this.addActiveRing(stone);

    this.turnManager.setPhase('aiming');
    this.showPowerPanel();
  }

  private onLaunch(vx: number, vy: number): void {
    if (!this.activeStone || this.turnManager.state.phase !== 'aiming') return;

    // Apply power
    const power = this.powerSidePanel?.getSelected() ?? PowerType.NONE;
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
        maxDrag:          MAX_DRAG_SRC     * this.arena.scale,
        launchSpeed:      LAUNCH_SPEED_SRC * this.arena.scale,
        grabRadiusFactor: GRAB_RADIUS_FACTOR,
        depth: DEPTH_AIM,
      },
      (lvx, lvy) => this.onLaunch(lvx, lvy),
    );

    this.powerSidePanel?.hide();
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
      x:        this.arena.deliveryX,
      y:        this.arena.deliveryY,
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
    const a = this.arena;
    this.bgGfx.clear();

    // ── Base fill: dark dojo night ───────────────────────────────────────────
    this.bgGfx.fillStyle(0x0c0a07, 1);
    this.bgGfx.fillRect(0, 0, width, height);

    // ── Side column base (slightly warmer dark) ───────────────────────────────
    const rightX = a.sheetX + a.sheetW;
    const rightW = width - rightX;
    this.bgGfx.fillStyle(0x130e08, 0.70);
    this.bgGfx.fillRect(0, 0, a.sheetX, height);
    this.bgGfx.fillRect(rightX, 0, rightW, height);

    // ── Wood-grain planks on side panels ─────────────────────────────────────
    const grainStep = Math.max(7, 9 * a.scale);
    for (let y = 0; y < height; y += grainStep) {
      const wave = Math.sin(y * 0.07 + 1.2) * 2 * a.scale;
      this.bgGfx.lineStyle(1, 0x231805, 0.45);
      if (a.sheetX > 4) {
        this.bgGfx.lineBetween(wave, y, a.sheetX + wave * 0.5, y);
      }
      if (rightW > 4) {
        this.bgGfx.lineBetween(rightX - wave * 0.5, y, width - wave, y);
      }
    }

    // ── Bamboo stalks — adapt count to available side-strip width ────────────
    const sideW = a.sheetX; // left strip width in screen px (same for right)
    const stalkFracs = sideW < 120 ? [0.50] : sideW < 250 ? [0.30, 0.70] : [0.18, 0.50, 0.82];
    if (a.sheetX > 18) {
      for (const frac of stalkFracs) {
        this.drawBambooStalk(a.sheetX * frac, height, a.scale);
      }
    }
    if (rightW > 18) {
      for (const frac of stalkFracs) {
        this.drawBambooStalk(rightX + rightW * frac, height, a.scale);
      }
    }

    // ── Paper lanterns — flanking the scoring house ───────────────────────────
    // For horizontal layout: hang lanterns near the far (right) end of the sheet.
    // For vertical layout: hang them in the top strip above the sheet.
    if (a.orientation === 'horizontal') {
      // Lanterns at top-left and top-right of the scoring house zone
      const lanternY = a.sheetY - Math.max(8, a.sheetY * 0.35);
      const fanCX    = a.houseFarCX;
      if (a.sheetY > 20) {
        this.drawPaperLantern(fanCX - 50 * a.scale, lanternY, 0, a.scale);
        this.drawPaperLantern(fanCX + 50 * a.scale, lanternY, 1, a.scale);
      }
    } else {
      const lanternY = a.sheetY * 0.48;
      if (a.sheetY > 28 * a.scale) {
        this.drawPaperLantern(a.sheetX + a.sheetW * 0.27, lanternY, 0, a.scale);
        this.drawPaperLantern(a.sheetX + a.sheetW * 0.73, lanternY, 1, a.scale);
      }
    }

    // ── Wooden border frame around the ice sheet ──────────────────────────────
    const bw = Math.max(3, 5 * a.scale);
    this.bgGfx.fillStyle(0x1c1208, 1);
    // Top bar
    this.bgGfx.fillRect(a.sheetX - bw, a.sheetY - bw, a.sheetW + bw * 2, bw);
    // Bottom bar
    this.bgGfx.fillRect(a.sheetX - bw, a.sheetY + a.sheetH, a.sheetW + bw * 2, bw);
    // Left bar
    this.bgGfx.fillRect(a.sheetX - bw, a.sheetY, bw, a.sheetH);
    // Right bar
    this.bgGfx.fillRect(a.sheetX + a.sheetW, a.sheetY, bw, a.sheetH);

    // ── Gold accent corner brackets ───────────────────────────────────────────
    const cs = Math.max(10, 14 * a.scale); // corner arm length
    const lw = Math.max(1.5, 2.0 * a.scale);
    this.bgGfx.lineStyle(lw, 0xd4a843, 0.92);
    for (const [cx, cy] of [
      [a.sheetX - bw, a.sheetY - bw],
      [a.sheetX + a.sheetW + bw, a.sheetY - bw],
      [a.sheetX - bw, a.sheetY + a.sheetH + bw],
      [a.sheetX + a.sheetW + bw, a.sheetY + a.sheetH + bw],
    ] as [number, number][]) {
      this.bgGfx.lineBetween(cx - cs, cy, cx + cs, cy);
      this.bgGfx.lineBetween(cx, cy - cs, cx, cy + cs);
    }

    // ── Top/bottom vignette ───────────────────────────────────────────────────
    const vigH = Math.max(16, 24 * a.scale);
    for (let i = 0; i < 5; i++) {
      const band = vigH * (1 - i / 5);
      this.bgGfx.fillStyle(0x000000, 0.07 * (5 - i));
      this.bgGfx.fillRect(0, 0, width, band);
      this.bgGfx.fillRect(0, height - band, width, band);
    }
  }

  /** Draw a single bamboo stalk rising from the bottom of the canvas. */
  private drawBambooStalk(x: number, height: number, scale: number): void {
    const stalkW = Math.max(5, 8 * scale);
    const segH   = Math.max(55, 80 * scale);
    const numSegs = Math.ceil(height / segH) + 2;

    // Stalk segments — alternating shades
    for (let i = 0; i < numSegs; i++) {
      const topY = height - (i + 1) * segH;
      const shade = i % 2 === 0 ? 0x2e5a1c : 0x254d16;
      this.bgGfx.fillStyle(shade, 0.88);
      this.bgGfx.fillRect(x - stalkW / 2, topY, stalkW, segH);
    }

    // Joint rings
    this.bgGfx.lineStyle(Math.max(1, 1.5 * scale), 0x1b3910, 0.95);
    for (let i = 0; i <= numSegs; i++) {
      const jy = height - i * segH;
      this.bgGfx.lineBetween(x - stalkW * 0.75, jy, x + stalkW * 0.75, jy);
    }

    // Leaves — one cluster per joint, alternating sides
    for (let i = 1; i < numSegs; i++) {
      const jy  = height - i * segH;
      const ll  = Math.max(16, 26 * scale);  // leaf length
      const lth = Math.max(4, 6.5 * scale);  // leaf thickness
      const side = i % 2 === 0 ? 1 : -1;

      // Primary leaf
      this.bgGfx.fillStyle(0x3d7a22, 0.68);
      this.bgGfx.fillEllipse(
        x + side * (stalkW / 2 + ll * 0.5),
        jy - lth * 0.6,
        ll, lth,
      );
      // Smaller upper leaf
      this.bgGfx.fillStyle(0x4a8f28, 0.50);
      this.bgGfx.fillEllipse(
        x + side * (stalkW / 2 + ll * 0.36),
        jy - lth * 2.0,
        ll * 0.62, lth * 0.65,
      );
    }
  }

  /** Draw a Japanese paper lantern hanging from y=0. */
  private drawPaperLantern(x: number, y: number, variant: number, scale: number): void {
    const lw = Math.max(15, 22 * scale);
    const lh = Math.max(21, 30 * scale);

    // Hanging cord
    this.bgGfx.lineStyle(Math.max(1, 1 * scale), 0x5a4530, 0.55);
    this.bgGfx.lineBetween(x, 0, x, y - lh * 0.52);

    // Soft ambient glow
    const glowColor = variant === 0 ? 0xff5500 : 0xffaa00;
    this.bgGfx.fillStyle(glowColor, 0.07);
    this.bgGfx.fillCircle(x, y, lh * 1.3);

    // Lantern body
    const bodyColor = variant === 0 ? 0xb01818 : 0xcc8800;
    this.bgGfx.fillStyle(bodyColor, 0.82);
    this.bgGfx.fillEllipse(x, y, lw, lh);

    // Horizontal ribs
    this.bgGfx.lineStyle(Math.max(1, 1 * scale), 0x000000, 0.16);
    for (let i = -2; i <= 2; i++) {
      const ry = y + i * lh * 0.14;
      const hw = Math.sqrt(Math.max(0, 1 - Math.pow(i / 2.8, 2))) * lw * 0.50;
      this.bgGfx.lineBetween(x - hw, ry, x + hw, ry);
    }

    // Inner light
    this.bgGfx.fillStyle(0xffdd88, 0.24);
    this.bgGfx.fillEllipse(x, y, lw * 0.52, lh * 0.52);

    // Caps (top and bottom)
    const capH = Math.max(3, 4.5 * scale);
    const capW = lw * 0.54;
    this.bgGfx.fillStyle(0x1c1208, 0.92);
    this.bgGfx.fillRect(x - capW / 2, y - lh * 0.5 - capH, capW, capH);
    this.bgGfx.fillRect(x - capW / 2, y + lh * 0.5, capW, capH);
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
      this.buildBumpers(true); // fresh random layout for new end
      this.drawBumpers();
      this.beginTurn();
    });
  }

  private showGameOverOverlay(): void {
    const [s0, s1] = this.turnManager.state.score;
    const winner   = s0 > s1 ? 'TEAM BLUE' : s1 > s0 ? 'TEAM RED' : 'DRAW';
    const message  = `${winner} WINS!\nBlue: ${s0}  Red: ${s1}`;
    // Team 0 (BLUE) is the local player in hot-seat mode.
    // A draw is recorded as a win — the local player completed the game.
    const localPlayerWon = s0 >= s1;
    this.submitResult(localPlayerWon);
    this.showOverlay(message, null, null);
    this.scoreHud.update(this.turnManager.state);
  }

  /**
   * Submit the game result for progression.
   * Non-fatal: errors are logged but never block the overlay from showing.
   */
  private submitResult(localPlayerWon: boolean): void {
    const user = this.registry.get('user') as { isGuest?: boolean } | undefined;
    if (user?.isGuest) return;

    api.submitGameResult('shell-curl', localPlayerWon ? 'win' : 'loss').then((result) => {
      console.info('[ShellCurl] progression:', result);
      showAchievementUnlocks(this, result.unlockedAchievements ?? []);
    }).catch((err: unknown) => {
      console.warn('[ShellCurl] failed to submit result:', err);
    });
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

  // ── Bumpers ───────────────────────────────────────────────────────────────

  /** Generate new random bumper positions and map them to canvas pixels. */
  private buildBumpers(regenerate = false): void {
    const { sheetX, sheetY, sheetW, sheetH, scale } = this.arena;

    // On resize, reuse existing fractional positions; regenerate at end start.
    const defs: BumperDef[] = regenerate || this.bumpers.length === 0
      ? generateBumperDefs()
      : this.bumpers.map(b => ({ fx: b.fx, fy: b.fy }));

    this.bumpers = defs.map(def => ({
      x:          sheetX + def.fx * sheetW,
      y:          sheetY + def.fy * sheetH,
      r:          BUMPER_RADIUS_SRC * scale,
      fx:         def.fx,
      fy:         def.fy,
      flashTimer: 0,
    }));
  }

  /** Draw all bumpers onto bumperGfx. */
  private drawBumpers(): void {
    this.bumperGfx.clear();
    for (const b of this.bumpers) {
      const flashing = b.flashTimer > 0;

      // Glow halo when flashing
      if (flashing) {
        const glowAlpha = (b.flashTimer / BUMPER_FLASH_MS) * 0.55;
        this.bumperGfx.fillStyle(0xffd700, glowAlpha);
        this.bumperGfx.fillCircle(b.x, b.y, b.r * 1.75);
      }

      // Dark wood body
      this.bumperGfx.fillStyle(0x2a1a08, 1);
      this.bumperGfx.fillCircle(b.x, b.y, b.r);

      // Gold ring
      const ringAlpha = flashing ? 1.0 : 0.85;
      this.bumperGfx.lineStyle(Math.max(1.5, 2.5 * this.arena.scale), 0xd4a843, ringAlpha);
      this.bumperGfx.strokeCircle(b.x, b.y, b.r);

      // Centre dot
      this.bumperGfx.fillStyle(0xd4a843, flashing ? 1.0 : 0.60);
      this.bumperGfx.fillCircle(b.x, b.y, b.r * 0.22);
    }
  }

  /**
   * Elastic reflection off each bumper.
   * Stones bounce along the collision normal and receive a 10% speed boost.
   */
  private resolveStoneBumperCollisions(stones: StoneState[]): void {
    for (const s of stones) {
      if (s.stopped && s.frozen) continue;
      for (const b of this.bumpers) {
        const dx   = s.x - b.x;
        const dy   = s.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minD = s.r + b.r;
        if (dist >= minD || dist < 0.001) continue;

        // Push stone out of overlap
        const nx  = dx / dist;
        const ny  = dy / dist;
        const overlap = minD - dist;
        s.x += nx * overlap;
        s.y += ny * overlap;

        // Reflect velocity along collision normal
        const dot = s.vx * nx + s.vy * ny;
        if (dot < 0) {
          // Only reflect if moving toward the bumper
          s.vx  = (s.vx - 2 * dot * nx) * BUMPER_BOOST;
          s.vy  = (s.vy - 2 * dot * ny) * BUMPER_BOOST;
          s.stopped = false;
          b.flashTimer = BUMPER_FLASH_MS;
        }
      }
    }
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
    this.buildBumpers();
    this.drawBumpers();
    this.redrawAllStones();

    this.scoreHud.update(this.turnManager.state);

    this.hudObjects.forEach(o => o.destroy());
    this.hudObjects = buildReturnButton(this);
    this.updatePowerPanel();
  }

  // ── Power side panel ──────────────────────────────────────────────────────

  private resolveLayout(): { rect: PanelRect; panelW: number } | null {
    const { width: canvasW, height: canvasH } = this.scale;
    const a = this.arena;

    // Panel occupies the RIGHT strip beside the ice sheet.
    const rightX = a.sheetX + a.sheetW + SIDE_PANEL_PAD;
    const availW = canvasW - rightX - SIDE_PANEL_PAD;
    if (availW < SIDE_PANEL_MIN_W) return null;

    const panelW = Math.min(availW, SIDE_PANEL_MAX_W);
    const panelH = canvasH - SIDE_PANEL_TOP - 16;
    if (panelH < 200) return null;

    return {
      rect: { x: rightX, y: SIDE_PANEL_TOP, width: panelW, height: panelH },
      panelW,
    };
  }

  /** Returns the power pool for the team whose turn it currently is. */
  private currentTeamPowers(): PowerType[] {
    const team = this.turnManager.state.currentTeam;
    return this.playerPowers[team] ?? FALLBACK_POWERS;
  }

  /** Show the power panel fresh at the start of each aiming turn (resets selection to NONE). */
  private showPowerPanel(): void {
    const layout = this.resolveLayout();
    if (!layout) return;

    if (!this.powerSidePanel) {
      this.powerSidePanel = new PowerSidePanel(this, () => {}, DEPTH_HUD);
    }
    this.powerSidePanel.show(layout.rect, this.currentTeamPowers(), PowerType.NONE);
  }

  /** Refresh the power panel on resize — preserves the current selection. */
  private updatePowerPanel(): void {
    const layout   = this.resolveLayout();
    const isAiming = this.turnManager.state.phase === 'aiming';

    if (!layout || !isAiming) {
      this.powerSidePanel?.hide();
      return;
    }

    if (!this.powerSidePanel) {
      this.powerSidePanel = new PowerSidePanel(this, () => {}, DEPTH_HUD);
    }
    const sel = this.powerSidePanel.getSelected();
    this.powerSidePanel.show(layout.rect, this.currentTeamPowers(), sel);
  }
}
