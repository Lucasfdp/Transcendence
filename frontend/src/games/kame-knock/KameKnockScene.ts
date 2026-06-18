/**
 * KameKnockScene — billiards-like target-smashing minigame.
 *
 * The player launches a turtle shell with the shared Slingshot mechanic, chains
 * hits against timed targets, and scores higher multipliers while the shell is
 * still moving from the same launch.
 *
 * Offline is a single-player score chase. Online uses the matchmaking snapshot
 * as authority for turn order, shared targets, and score.
 */

import Phaser from 'phaser';
import { api } from '../../features/hub/api';
import { ResponsiveScene } from '../../shared/responsive-scene';
import { ARENA_01 } from '../../shared/arenas/arena01';
import { ArenaPixels, arenaToScreen, drawSumoRing } from '../../shared/arenas/arena';
import { BallState, BALL_SRC_R, drawShellBall, stepBall } from '../../shared/mechanics/ball';
import { Slingshot } from '../../shared/mechanics/slingshot';
import { buildReturnButton } from '../../shared/mechanics/hud';
import { showAchievementUnlocks } from '../../shared/achievement-popup';
import { PanelRect, SidePanel, SidePanelRow } from '../../shared/ui/panels/side-panel';
import { PowerSidePanel } from '../../shared/ui/panels/PowerSidePanel';
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
import {
  applyBallPower,
  BallExtState,
  BALL_FRICTION_BASE,
} from '../../shared/mechanics/ball-powers';
import {
  BOMB_RADIUS_SRC,
  REPEL_RADIUS_SRC,
} from '../../shared/mechanics/power-system';
import { getGameSocket, type GameSnapshot, type KameKnockSnapshot, type KameKnockThrowEvent, type OnlineMatchContext } from '../../services/network/gameSocket';

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
const SIDE_PANEL_MIN_W = 100;
const SIDE_PANEL_MAX_W = 230;
const SIDE_PANEL_PAD = 16;
const SIDE_PANEL_TOP = 74;
const SCORE_LOG_LIMIT = 8;
const FREEZE_DURATION_MS = 5_000;

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
const PLAYER_COLOURS = [THEME.gold, THEME.red, 0x66aaff, 0x6ab04c, 0xb56cff];

/** Fallback power pool when no ShellPicker selection is present. */
const FALLBACK_POWERS: PowerType[] = [PowerType.NONE, ...GAME_POWERS['kame-knock']];

export class KameKnockScene extends ResponsiveScene {
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
  private targetFreezeMs = 0; // FREEZE power: pauses target age when > 0

  private ballText: Phaser.GameObjects.Text | null = null;
  private countdownText?: Phaser.GameObjects.Text;
  private scoreLogPanel: SidePanel | null = null;
  private overlay?: Phaser.GameObjects.Container;
  private overlayHitZones: Phaser.GameObjects.Zone[] = [];

  // ── Power state ──────────────────────────────────────────────────────────────
  private powerSidePanel: PowerSidePanel | null = null;

  /** Per-player power pools. Offline uses player 0; online maps by side. */
  private playerPowers: PowerType[][] = [FALLBACK_POWERS];
  private activePower: PowerType = PowerType.NONE;
  /** Per-player used-power tracking (one-shot each per game, NONE always reusable). */
  private powerUsed: Array<Set<PowerType>> = [new Set()];

  private localPlayerCount = 1;
  private onlineMatch: OnlineMatchContext | null = null;
  private lastOnlineSeq = -1;
  private onlineStatusText: Phaser.GameObjects.Text | null = null;
  private pendingOnlineTargetHits = new Set<number>();
  private onlineReplayThrower: number | null = null;
  private onlineReplayTurnNumber: number | null = null;
  private onlineSettledSubmitted = false;
  private onlineReleasePending = false;
  private visibleBallSide = 0;
  private onlineBalls = new Map<number, BallState>();

  private readonly handleOnlineState = (snapshot: GameSnapshot): void => {
    if (snapshot.gameId === 'kame-knock') this.applyOnlineSnapshot(snapshot);
  };

  private readonly handleOnlineThrow = (event: KameKnockThrowEvent): void => {
    this.playOnlineThrow(event);
  };

  constructor() { super({ key: 'KameKnockScene' }); }

  protected onShutdown(): void {
    this.cleanupSceneResources();
  }

  create(): void {
    const registryOnlineMatch = (this.registry.get('onlineMatch') as OnlineMatchContext | undefined) ?? null;
    this.onlineMatch = registryOnlineMatch?.snapshot?.gameId === 'kame-knock' ? registryOnlineMatch : null;
    this.lastOnlineSeq = -1;
    this.pendingOnlineTargetHits.clear();
    this.onlineReplayThrower = null;
    this.onlineReplayTurnNumber = null;
    this.onlineSettledSubmitted = false;
    this.onlineReleasePending = false;
    this.visibleBallSide = 0;
    this.onlineBalls.clear();

    this.targets          = [];
    this.nextTargetId     = 0;
    this.currentBallIndex = 0;
    this.launchedThisBall = false;
    this.score            = 0;
    this.combo            = 0;
    this.running          = !this.onlineMatch;
    this.scoreEvents      = [];
    this.overlay          = undefined;
    this.ballText         = null;
    this.countdownText    = undefined;
    this.scoreLogPanel    = null;
    this.targetFreezeMs   = 0;
    this.activePower      = PowerType.NONE;
    this.localPlayerCount = 1;
    this.powerUsed        = Array.from({ length: 5 }, () => new Set<PowerType>());

    this.arena = this.resolveArena();
    this.resetBall();

    // Read shell selection from registry.
    const sel = this.registry.get('shellSelection') as
      Record<string, string[] | undefined> | undefined;

    const buildPool = (picks: string[] | undefined): PowerType[] => {
      const specials = (picks ?? [])
        .map((s) => s as PowerType)
        .filter((s) => (Object.values(PowerType) as string[]).includes(s) && s !== PowerType.NONE);
      const pool = [PowerType.NONE, ...new Set(specials)];
      return pool.length > 1 ? pool : FALLBACK_POWERS;
    };

    this.localPlayerCount = this.onlineMatch ? (this.onlineMatch.snapshot?.players.length ?? 2) : 1;
    this.playerPowers = Array.from({ length: 5 }, (_, index) => buildPool(sel?.[`player${index}`]));
    if (this.onlineMatch) this.playerPowers[this.onlineMatch.side] = buildPool(sel?.player0);

    this.bgGfx     = this.add.graphics().setDepth(DEPTH_BG);
    this.targetGfx = this.add.graphics().setDepth(DEPTH_TARGETS);
    this.ballGfx   = this.add.graphics().setDepth(DEPTH_BALL);

    this.slingshot = new Slingshot(this, this.ball, {
      maxDrag: MAX_DRAG_SRC * this.arena.scale,
      launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
      depth: DEPTH_AIM,
    }, () => this.onLaunch());

    const initialOnlineSnapshot = this.onlineMatch?.snapshot?.gameId === 'kame-knock' ? this.onlineMatch.snapshot : null;
    if (initialOnlineSnapshot) this.applyOnlineSnapshot(initialOnlineSnapshot, true);
    else this.setupBallRound();

    this.drawBackground();
    this.drawTargets();
    this.drawBall();
    this.buildHud();
    if (this.onlineMatch) this.createOnlineStatusText();
    this.updateSidePanels();
    this.showPowerPanel();

    if (this.onlineMatch) {
      this.initOnlineMatch();
      if (initialOnlineSnapshot?.phase === 'active') this.startOnlineCountdown();
    } else {
      this.syncSlingshotForTurn();
    }

    this.enableResponsive();   // relayout on resize/zoom (see ResponsiveScene)
  }

  private cleanupSceneResources(): void {
    this.slingshot?.destroy();
    this.slingshot = null;
    this.clearOverlayHitZones();
    this.overlay?.destroy(true);
    this.overlay = undefined;
    this.powerSidePanel?.destroy();
    this.powerSidePanel = null;
    this.countdownText?.destroy();
    this.countdownText = undefined;
    this.destroySidePanels();
    this.ballText = null;
    if (this.onlineMatch) {
      const socket = getGameSocket();
      socket.off('game:state', this.handleOnlineState);
      socket.off('game:end', this.handleOnlineState);
      socket.off('game:kame-throw', this.handleOnlineThrow);
    }
    this.onlineStatusText?.destroy();
    this.onlineStatusText = null;
  }

  update(_time: number, delta: number): void {
    if (!this.running) return;

    // Advance target age (paused during FREEZE)
    this.targetFreezeMs = Math.max(0, this.targetFreezeMs - delta);
    if (this.targetFreezeMs <= 0) {
      for (const target of this.targets) {
        target.ageMs += delta;
      }
    }

    const ball = this.activeBall();
    const moving = stepBall(ball, delta, this.arena);
    const ext    = ball as BallExtState;

    // Apply frictionOverride correction (SLICK / BOUNCER / SPINNING)
    if (moving && ext.frictionOverride !== undefined) {
      const factor = Math.pow(ext.frictionOverride / BALL_FRICTION_BASE, delta / 16.67);
      ball.vx *= factor;
      ball.vy *= factor;
    }

    if (moving) {
      this.checkTargetHits();
    }

    // Resolve stop flags when ball comes to rest
    if (!moving && this.launchedThisBall) {
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
        this.targetFreezeMs = FREEZE_DURATION_MS;
        ext.freezePending   = false;
      }
    }

    if (this.launchedThisBall && !moving) this.finishBallRound();

    this.drawTargets();
    this.drawBall();
  }

  // ── Launch handler ────────────────────────────────────────────────────────────

  private onLaunch(): void {
    if (this.onlineMatch) {
      const sourceVx = this.ball.vx / this.arena.scale;
      const sourceVy = this.ball.vy / this.arena.scale;
      const power = this.activePower;
      this.onlineReleasePending = true;
      this.ball.vx = 0;
      this.ball.vy = 0;
      const p = this.currentPlayerIndex();
      if (power !== PowerType.NONE) (this.powerUsed[p] ?? this.powerUsed[0]).add(power);
      this.activePower = PowerType.NONE;
      this.powerSidePanel?.hide();
      this.slingshot?.destroy();
      this.updateOnlineStatus('Launching...');
      getGameSocket().emit('game:input', {
        matchId: this.onlineMatch.matchId,
        action: 'release',
        payload: {
          roundNumber: this.onlineRoundNumber(),
          turnNumber: this.onlineTurnNumber(),
          vx: sourceVx,
          vy: sourceVy,
          power,
        },
      });
      return;
    }

    this.launchedThisBall = true;
    this.combo = 0;

    // Apply power to ball (velocity already set by Slingshot, radius reset in setupBallRound)
    applyBallPower(this.activePower, this.ball, this.arena);

    if ((this.ball as BallExtState).phantomHidden) {
      this.ballGfx.setAlpha(0.05);
    }

    // Track used powers for the current player
    const p = this.currentPlayerIndex();
    if (this.activePower !== PowerType.NONE) {
      (this.powerUsed[p] ?? this.powerUsed[0]).add(this.activePower);
    }

    this.activePower = PowerType.NONE;
    this.powerSidePanel?.hide();
  }

  // ── Stop-flag resolvers ───────────────────────────────────────────────────────

  private resolveStopBomb(): void {
    const blastR = BOMB_RADIUS_SRC * this.arena.scale;
    const ball = this.activeBall();
    const bx = ball.x;
    const by = ball.y;
    if (this.onlineMatch) {
      this.targets = this.targets.filter(t => {
        if (!t.breakable) return true;
        const pos = timedTargetPosition(t, this.arena);
        const hit = Math.hypot(pos.x - bx, pos.y - by) < blastR;
        if (hit) this.reportOnlineTargetHit(t, 1, false);
        return !hit;
      });
      return;
    }
    this.targets = this.targets.filter(t => {
      if (!t.breakable) return true;
      const pos = timedTargetPosition(t, this.arena);
      return Math.hypot(pos.x - bx, pos.y - by) >= blastR;
    });
  }

  private resolveStopRepel(): void {
    const repelR = REPEL_RADIUS_SRC * this.arena.scale;
    const ball = this.activeBall();
    const bx = ball.x;
    const by = ball.y;
    if (this.onlineMatch) {
      this.targets = this.targets.filter(t => {
        if (!t.breakable) return true;
        const pos = timedTargetPosition(t, this.arena);
        const hit = Math.hypot(pos.x - bx, pos.y - by) < repelR;
        if (hit) this.reportOnlineTargetHit(t, 1, false);
        return !hit;
      });
      return;
    }
    this.targets = this.targets.filter(t => {
      if (!t.breakable) return true;
      const pos = timedTargetPosition(t, this.arena);
      return Math.hypot(pos.x - bx, pos.y - by) >= repelR;
    });
  }

  // ── Turn helpers ──────────────────────────────────────────────────────────────

  /** Index of the player whose turn it currently is. */
  private currentPlayerIndex(): number {
    if (this.onlineMatch?.snapshot?.gameId === 'kame-knock') return this.onlineMatch.snapshot.currentTurn;
    return this.currentBallIndex % this.localPlayerCount;
  }

  private setupBallRound(): void {
    this.targets      = [];
    this.launchedThisBall = false;
    this.combo        = 0;
    this.resetBall();

    const config = BALL_ROUNDS[this.currentBallIndex];
    if (!config) return;

    const breakableFlags = this.shuffledBreakableFlags(config);
    for (const breakable of breakableFlags) this.spawnTarget(breakable);

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
    const def  = TARGET_COLOURS[kind];
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
    const theta  = Math.random() * Math.PI * 2;
    return { nx: Math.cos(theta) * radius, ny: Math.sin(theta) * radius };
  }

  private checkTargetHits(): void {
    const ball = this.activeBall();
    const ext = ball as BallExtState;
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const target = this.targets[i];
      if (!hitsTimedTarget(target, this.arena, ball.x, ball.y, ball.r)) continue;

      const pos = timedTargetPosition(target, this.arena);
      if (!target.breakable) {
        this.bounceOffSolidTarget(pos.x, pos.y, timedTargetRadius(target, this.arena));
        continue;
      }

      // GHOST: pass through first breakable target without scoring
      if (ext.ghostUsed === false) {
        ext.ghostUsed = true;
        continue;
      }

      this.combo += 1;
      const accuracy = targetHitAccuracy(target, this.arena, ball.x, ball.y);
      const perfect  = accuracy <= PERFECT_ACCURACY;
      if (this.onlineMatch) {
        this.reportOnlineTargetHit(target, this.combo, perfect);
        this.targets.splice(i, 1);
        this.popScore(pos.x, pos.y, target.points * this.combo + (perfect ? PERFECT_BONUS : 0), this.combo, perfect);
        continue;
      }
      const gained   = target.points * this.combo + (perfect ? PERFECT_BONUS : 0);
      this.score    += gained;
      this.addScoreEvent(`${TARGET_COLOURS[target.kind].label}  +${gained}`, perfect ? 'PERFECT' : `x${this.combo}`);

      this.popScore(pos.x, pos.y, gained, this.combo, perfect);
      this.applyHitKick(pos.x, pos.y);
      this.targets.splice(i, 1);
    }
  }

  private bounceOffSolidTarget(targetX: number, targetY: number, targetRadius: number): void {
    const ball = this.activeBall();
    const dx = ball.x - targetX;
    const dy = ball.y - targetY;
    const dist = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / dist;
    const ny = dy / dist;
    const minDist = ball.r + targetRadius;

    if (dist < minDist) {
      ball.x += nx * (minDist - dist);
      ball.y += ny * (minDist - dist);
    }

    const dot = ball.vx * nx + ball.vy * ny;
    if (dot >= 0) return;

    ball.vx = (ball.vx - 2 * dot * nx) * SOLID_BOUNCE_DAMP;
    ball.vy = (ball.vy - 2 * dot * ny) * SOLID_BOUNCE_DAMP;
    this.popBounce(targetX, targetY);
  }

  private applyHitKick(targetX: number, targetY: number): void {
    const ball = this.activeBall();
    const dx  = ball.x - targetX;
    const dy  = ball.y - targetY;
    const len = Math.max(1, Math.hypot(dx, dy));
    const kick = HIT_KNOCKBACK_SRC * this.arena.scale;
    ball.vx += (dx / len) * kick;
    ball.vy += (dy / len) * kick;
  }

  private endRound(): void {
    this.running = false;
    this.slingshot?.cancel();
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.combo   = 0;
    this.powerSidePanel?.hide();
    this.updateSidePanels();
    this.submitResult();
    this.showEndScreen();
  }

  private initOnlineMatch(): void {
    const socket = getGameSocket();
    socket.off('game:state', this.handleOnlineState);
    socket.off('game:end', this.handleOnlineState);
    socket.off('game:kame-throw', this.handleOnlineThrow);
    socket.on('game:state', this.handleOnlineState);
    socket.on('game:end', this.handleOnlineState);
    socket.on('game:kame-throw', this.handleOnlineThrow);
    this.updateOnlineStatus('Connected to Kame Knock match.');
  }

  private startOnlineCountdown(): void {
    if (!this.onlineMatch || this.countdownText) return;
    this.running = false;
    this.slingshot?.destroy();
    this.powerSidePanel?.hide();

    const steps = ['3', '2', '1', 'GO!'];
    this.countdownText = this.add.text(this.scale.width / 2, this.scale.height / 2, '', {
      fontSize: '120px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_OVERLAY);

    const showStep = (i: number): void => {
      const label = steps[i];
      const text = this.countdownText;
      if (!text) return;

      this.tweens.killTweensOf(text);
      text.setText(label).setScale(0.4).setAlpha(1);
      this.tweens.add({ targets: text, scale: label === 'GO!' ? 1.6 : 1.2, duration: 650, ease: 'Back.easeOut' });
      this.tweens.add({ targets: text, alpha: 0, delay: 500, duration: 280, ease: 'Cubic.easeIn' });

      if (i < steps.length - 1) this.time.delayedCall(800, () => showStep(i + 1));
      else this.time.delayedCall(800, () => this.beginOnlinePlay());
    };

    showStep(0);
  }

  private beginOnlinePlay(): void {
    this.countdownText?.destroy();
    this.countdownText = undefined;
    const snapshot = this.onlineMatch?.snapshot;
    if (!snapshot || snapshot.gameId !== 'kame-knock' || snapshot.phase !== 'active') return;
    this.running = true;
    this.showPowerPanel();
    this.syncSlingshotForTurn();
  }

  private createOnlineStatusText(): void {
    this.onlineStatusText = this.add.text(this.scale.width / 2, 48, '', {
      fontSize: '13px', color: '#d4a843', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(DEPTH_HUD + 2);
  }

  private updateOnlineStatus(message: string): void {
    this.onlineStatusText?.setText(message);
  }

  private markOnlineAway(): void {
    const phase = this.onlineMatch?.snapshot?.phase;
    if (this.onlineMatch && phase !== 'finished' && phase !== 'abandoned') {
      getGameSocket().emit('match:status', { away: true });
    }
  }

  private applyOnlineSnapshot(snapshot: KameKnockSnapshot, initial = false): void {
    if (!this.onlineMatch || snapshot.matchId !== this.onlineMatch.matchId || snapshot.seq < this.lastOnlineSeq) return;
    this.lastOnlineSeq = snapshot.seq;
    this.onlineMatch.snapshot = snapshot;
    this.localPlayerCount = snapshot.players.length;
    this.currentBallIndex = Math.max(0, snapshot.roundNumber - 1);
    if (!this.launchedThisBall) this.visibleBallSide = snapshot.currentTurn;
    this.score = snapshot.score[this.onlineMatch.side] ?? this.score;
    this.targets = snapshot.targets.map((target) => ({ ...target }));
    this.nextTargetId = snapshot.nextTargetId;
    this.syncOnlineBalls(snapshot);
    const liveTargetIds = new Set(this.targets.map((target) => target.id));
    for (const pendingId of [...this.pendingOnlineTargetHits]) {
      if (!liveTargetIds.has(pendingId)) this.pendingOnlineTargetHits.delete(pendingId);
    }

    if (!this.launchedThisBall) this.resetBallForPlayer(snapshot.currentTurn);
    this.ballText?.setText(this.formatBallText());
    this.drawTargets();
    this.drawBall();
    this.updateSidePanels();

    if (snapshot.phase === 'finished' || snapshot.phase === 'abandoned') {
      this.showOnlineEndScreen(snapshot);
      return;
    }

    if (snapshot.phase !== 'active') {
      this.updateOnlineStatus('Waiting for players...');
      return;
    }

    if (!this.running && !this.countdownText) this.startOnlineCountdown();

    if (!this.launchedThisBall) this.onlineSettledSubmitted = false;
    if (!initial) this.activePower = PowerType.NONE;
    if (this.isLocalOnlineTurn()) this.updateOnlineStatus(`Your turn (P${this.onlineMatch.side + 1})`);
    else this.updateOnlineStatus(`P${snapshot.currentTurn + 1} turn`);
    this.showPowerPanel();
    this.syncSlingshotForTurn();
  }

  private playOnlineThrow(event: KameKnockThrowEvent): void {
    if (!this.onlineMatch || event.matchId !== this.onlineMatch.matchId) return;
    if (event.roundNumber !== this.onlineRoundNumber()) return;

    this.slingshot?.destroy();
    this.onlineReplayThrower = event.side;
    this.onlineReplayTurnNumber = event.turnNumber;
    this.onlineSettledSubmitted = false;
    this.onlineReleasePending = false;
    this.visibleBallSide = event.side;
    this.launchedThisBall = true;
    this.combo = 0;
    const ball = this.ballForOnlineSide(event.side);
    ball.vx = 0;
    ball.vy = 0;
    this.resetBallForPlayer(event.side);
    ball.vx = event.vx * this.arena.scale;
    ball.vy = event.vy * this.arena.scale;
    ball.r = BALL_SRC_R * this.arena.scale;
    const power = (Object.values(PowerType) as string[]).includes(event.power) ? event.power as PowerType : PowerType.NONE;
    applyBallPower(power, ball, this.arena);
    if ((ball as BallExtState).phantomHidden) this.ballGfx.setAlpha(0.05);
    this.powerSidePanel?.hide();
    this.updateOnlineStatus(event.side === this.onlineMatch.side ? 'Your throw...' : `P${event.side + 1} throw...`);
  }

  private reportOnlineTargetHit(target: TimedTarget, combo: number, perfect: boolean): void {
    if (!this.onlineMatch || this.pendingOnlineTargetHits.has(target.id)) return;
    if (this.onlineReplayThrower !== this.onlineMatch.side) return;
    this.pendingOnlineTargetHits.add(target.id);
    getGameSocket().emit('game:input', {
      matchId: this.onlineMatch.matchId,
      action: 'target:hit',
      payload: {
        roundNumber: this.onlineRoundNumber(),
        turnNumber: this.onlineReplayTurnNumber ?? this.onlineTurnNumber(),
        targetId: target.id,
        combo,
        perfect,
      },
    });
  }

  private syncSlingshotForTurn(): void {
    if (!this.slingshot) return;
    if (!this.onlineMatch || (this.running && this.isLocalOnlineTurn() && !this.launchedThisBall && !this.onlineReleasePending)) this.slingshot.attach();
    else this.slingshot.destroy();
  }

  private isLocalOnlineTurn(): boolean {
    return !!this.onlineMatch?.snapshot && this.onlineMatch.snapshot.gameId === 'kame-knock'
      && this.onlineMatch.snapshot.currentTurn === this.onlineMatch.side
      && !this.onlineMatch.spectator;
  }

  private onlineRoundNumber(): number {
    return this.onlineMatch?.snapshot?.gameId === 'kame-knock' ? this.onlineMatch.snapshot.roundNumber : this.currentBallIndex + 1;
  }

  private onlineTurnNumber(): number {
    return this.onlineMatch?.snapshot?.gameId === 'kame-knock' ? this.onlineMatch.snapshot.turnNumber : this.currentBallIndex;
  }

  private showOnlineEndScreen(snapshot: KameKnockSnapshot): void {
    this.running = false;
    this.slingshot?.destroy();
    this.powerSidePanel?.hide();
    this.overlay?.destroy(true);
    this.clearOverlayHitZones();

    const { width, height } = this.scale;
    const panelW = 520, panelH = 340;
    const container = this.add.container(width / 2, height / 2).setDepth(DEPTH_OVERLAY);
    this.overlay = container;

    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.74);
    bg.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
    bg.lineStyle(2, THEME.gold, 0.85);
    bg.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
    container.add(bg);

    const title = snapshot.winnerSide === null
      ? 'DRAW'
      : snapshot.winnerSide === this.onlineMatch?.side ? 'YOU WIN!' : 'YOU LOSE';
    container.add(this.add.text(0, -panelH / 2 + 38, title, {
      fontSize: '30px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5));

    container.add(this.add.text(0, -panelH / 2 + 78, 'FINAL SCORES', {
      fontSize: '14px', color: THEME.text, fontFamily: THEME.font,
    }).setOrigin(0.5));

    snapshot.players.forEach((player, index) => {
      const y = -panelH / 2 + 120 + index * 30;
      const color = player.side === snapshot.winnerSide ? THEME.textGold : THEME.text;
      const name = player.side === this.onlineMatch?.side ? `${player.username} (You)` : player.username;
      container.add(this.add.text(-panelW / 2 + 48, y, name, {
        fontSize: '18px', color, fontFamily: THEME.font, fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      container.add(this.add.text(panelW / 2 - 48, y, String(snapshot.score[player.side] ?? 0), {
        fontSize: '18px', color, fontFamily: THEME.font, fontStyle: 'bold',
      }).setOrigin(1, 0.5));
    });

    this.addOverlayButton(container, 0, panelH / 2 - 50, 'RETURN', () => {
      this.registry.remove('onlineMatch');
      this.scene.start('HubScene');
    });
  }

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
    if (this.onlineMatch) {
      const ball = this.activeBall();
      this.launchedThisBall = false;
      this.combo = 0;
      ball.vx = 0;
      ball.vy = 0;
      if (!this.onlineSettledSubmitted && this.onlineReplayThrower === this.onlineMatch.side) {
        this.onlineSettledSubmitted = true;
        this.onlineReleasePending = false;
        getGameSocket().emit('game:input', {
          matchId: this.onlineMatch.matchId,
          action: 'settled',
          payload: { roundNumber: this.onlineRoundNumber(), turnNumber: this.onlineReplayTurnNumber ?? this.onlineTurnNumber() },
        });
        this.updateOnlineStatus('Waiting for next turn...');
      }
      return;
    }

    this.launchedThisBall = false;
    this.combo            = 0;
    this.currentBallIndex += 1;

    if (this.currentBallIndex >= BALL_ROUNDS.length) {
      this.endRound();
      return;
    }

    this.setupBallRound();
    this.drawTargets();
    this.drawBall();
    this.showPowerPanel();
  }

  // ── Power panel ──────────────────────────────────────────────────────────────

  private showPowerPanel(): void {
    if (this.onlineMatch && (!this.running || !this.isLocalOnlineTurn() || this.launchedThisBall || this.onlineReleasePending)) {
      this.powerSidePanel?.hide();
      return;
    }
    const layout = this.resolveLayout();

    if (!this.powerSidePanel) {
      this.powerSidePanel = new PowerSidePanel(
        this,
        (type) => { this.activePower = type; },
        DEPTH_HUD,
      );
    }

    const p = this.currentPlayerIndex();
    if (!layout.leftPanel) {
      // No room to dock — collapse into an edge drop-down instead of vanishing.
      this.powerSidePanel.showCollapsible('left', this.playerPowers[p] ?? FALLBACK_POWERS, this.activePower, this.powerUsed[p] ?? this.powerUsed[0]);
      return;
    }

    this.powerSidePanel.show(layout.leftPanel, this.playerPowers[p] ?? FALLBACK_POWERS, this.activePower, this.powerUsed[p] ?? this.powerUsed[0]);
  }

  // ── HUD ──────────────────────────────────────────────────────────────────────

  private buildHud(): void {
    this.hudObjects = buildReturnButton(this, 'HubScene', () => this.markOnlineAway());
    this.ballText   = this.add.text(this.scale.width / 2, 16, this.formatBallText(), {
      fontSize: '26px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(DEPTH_HUD);
  }

  private resolveArena(): ArenaPixels {
    return arenaToScreen(ARENA_01, this.scale.width, this.scale.height);
  }

  private resolveLayout(): KameKnockLayout {
    const { width, height } = this.scale;
    if (width < SIDE_PANEL_MIN_CANVAS_W || height < SIDE_PANEL_MIN_CANVAS_H) return {};

    const arena      = this.arena ?? this.resolveArena();
    const leftFreeW  = arena.cx - arena.rx - SIDE_PANEL_PAD * 2;
    const rightFreeW = width - (arena.cx + arena.rx) - SIDE_PANEL_PAD * 2;
    const leftPanelW  = Math.floor(Math.min(SIDE_PANEL_MAX_W, leftFreeW));
    const rightPanelW = Math.floor(Math.min(SIDE_PANEL_MAX_W, rightFreeW));
    const panelH      = height - SIDE_PANEL_TOP - SIDE_PANEL_PAD;

    const leftPanel  = leftPanelW  >= SIDE_PANEL_MIN_W
      ? { x: SIDE_PANEL_PAD, y: SIDE_PANEL_TOP, width: leftPanelW,  height: panelH }
      : undefined;
    const rightPanel = rightPanelW >= SIDE_PANEL_MIN_W
      ? { x: width - SIDE_PANEL_PAD - rightPanelW, y: SIDE_PANEL_TOP, width: rightPanelW, height: panelH }
      : undefined;
    if (!leftPanel && !rightPanel) return {};
    return { leftPanel, rightPanel };
  }

  private updateSidePanels(): void {
    const layout = this.resolveLayout();
    this.scoreLogPanel ??= new SidePanel(this, DEPTH_HUD);

    const content = {
      title: 'SCORE LOG',
      rows: this.buildScoreLogRows(),
      footerRows: this.buildScoreStatusRows(),
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
    if (!config) return '';
    const p = this.currentPlayerIndex();
    if (this.onlineMatch?.snapshot?.gameId === 'kame-knock') {
      const scoreLine = this.onlineMatch.snapshot.score.map((score, index) => `P${index + 1} ${score}`).join('  ');
      return `ROUND ${this.currentBallIndex + 1}/${BALL_ROUNDS.length}  P${p + 1} TURN  ${scoreLine}`;
    }
    return `BALL ${this.currentBallIndex + 1}/${BALL_ROUNDS.length}  P${p + 1}  ${config.breakableTargets} BREAK`;
  }

  private resetBall(): void {
    this.ball.x  = this.arena.cx;
    this.ball.y  = this.arena.cy;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.r  = BALL_SRC_R * this.arena.scale;
  }

  private activeBall(): BallState {
    if (!this.onlineMatch?.snapshot || this.onlineMatch.snapshot.gameId !== 'kame-knock') return this.ball;
    const side = this.launchedThisBall
      ? this.onlineReplayThrower ?? this.visibleBallSide
      : this.onlineMatch.snapshot.currentTurn;
    return this.ballForOnlineSide(side);
  }

  private ballForOnlineSide(side: number): BallState {
    if (side === this.onlineMatch?.side) return this.ball;
    let ball = this.onlineBalls.get(side);
    if (!ball) {
      ball = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R * this.arena.scale };
      this.onlineBalls.set(side, ball);
    }
    return ball;
  }

  private syncOnlineBalls(snapshot: KameKnockSnapshot): void {
    if (!this.onlineMatch) return;
    const next = new Map<number, BallState>();
    const players = [...snapshot.players].sort((a, b) => a.side - b.side);
    players.forEach((player, index) => {
      const ball = player.side === this.onlineMatch?.side
        ? this.ball
        : this.onlineBalls.get(player.side) ?? { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R * this.arena.scale };
      if (!this.launchedThisBall || !this.isBallMoving(ball)) this.resetOnlineBall(ball, index, players.length);
      next.set(player.side, ball);
    });
    this.onlineBalls = next;
  }

  private resetBallForPlayer(playerSide: number): void {
    if (!this.onlineMatch?.snapshot || this.onlineMatch.snapshot.gameId !== 'kame-knock') {
      this.resetBall();
      return;
    }

    const players = [...this.onlineMatch.snapshot.players].sort((a, b) => a.side - b.side);
    const index = Math.max(0, players.findIndex((player) => player.side === playerSide));
    this.resetOnlineBall(this.ballForOnlineSide(playerSide), index, players.length || 1);
  }

  private resetOnlineBall(ball: BallState, index: number, total: number): void {
    void index;
    void total;
    ball.x = this.arena.cx;
    ball.y = this.arena.cy;
    ball.vx = 0;
    ball.vy = 0;
    ball.r = BALL_SRC_R * this.arena.scale;
  }

  private isBallMoving(ball: BallState): boolean {
    return Math.hypot(ball.vx, ball.vy) > 2;
  }

  private drawBall(): void {
    this.ballGfx.clear();
    if (!this.onlineMatch?.snapshot || this.onlineMatch.snapshot.gameId !== 'kame-knock') {
      drawShellBall(this.ballGfx, this.ball);
      return;
    }

    const side = this.launchedThisBall
      ? this.onlineReplayThrower ?? this.visibleBallSide
      : this.onlineMatch.snapshot.currentTurn;
    const ball = this.ballForOnlineSide(side);
    drawShellBall(this.ballGfx, ball);
    const colour = PLAYER_COLOURS[side % PLAYER_COLOURS.length] ?? THEME.gold;
    this.ballGfx.lineStyle(Math.max(2, ball.r * 0.14), colour, 0.95);
    this.ballGfx.strokeCircle(ball.x, ball.y, ball.r * 1.08);
  }

  private drawBackground(): void {
    const { width, height } = this.scale;
    this.bgGfx.clear();
    this.bgGfx.fillStyle(THEME.background, 1);
    this.bgGfx.fillRect(0, 0, width, height);

    const gridStep = Math.max(28, Math.round(70 * this.arena.scale));
    this.bgGfx.lineStyle(1, THEME.greenMuted, 0.45);
    for (let x = 0; x < width;  x += gridStep) this.bgGfx.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += gridStep) this.bgGfx.lineBetween(0, y, width, y);

    drawSumoRing(this.bgGfx, this.arena);
  }

  private drawTargets(): void {
    this.targetGfx.clear();
    for (const target of this.targets) this.drawTarget(target);
  }

  private drawTarget(target: TimedTarget): void {
    const pos    = timedTargetPosition(target, this.arena);
    const radius = timedTargetRadius(target, this.arena);
    const pulse  = 0.88 + Math.sin(target.ageMs * 0.006) * 0.12;
    const alpha  = target.breakable ? 1 : 0.92;
    this.drawTargetBody(this.targetGfx, pos.x, pos.y, radius, target.kind, target.breakable, pulse, alpha);
  }

  private drawTargetBody(
    g: Phaser.GameObjects.Graphics,
    x: number, y: number, radius: number,
    kind: TimedTargetKind, breakable: boolean, pulse: number, alpha: number,
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

  private popBounce(x: number, y: number): void {
    const text = this.add.text(x, y, 'BOUNCE', {
      fontSize: '16px', color: '#9aa4b8', fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_FX);
    this.tweens.add({
      targets: text, y: y - 34, alpha: 0, duration: 420, ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  private popScore(x: number, y: number, points: number, combo: number, perfect: boolean): void {
    const label = perfect ? `PERFECT +${points}` : `+${points}  x${combo}`;
    const text  = this.add.text(x, y, label, {
      fontSize: perfect ? '24px' : '20px',
      color: perfect ? THEME.textGold : THEME.text,
      fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_FX);
    this.tweens.add({
      targets: text, y: y - 48, alpha: 0, duration: 700, ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  private showEndScreen(): void {
    this.clearOverlayHitZones();
    const { width, height } = this.scale;
    const panelW = 460, panelH = 280;
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
    x: number, y: number, label: string, onClick: () => void,
  ): void {
    const buttonW = 180, buttonH = 42;
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
    zone.on('pointerup', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      zone.disableInteractive();
      onClick();
    });
    this.overlayHitZones.push(zone);
  }

  private clearOverlayHitZones(): void {
    for (const zone of this.overlayHitZones) zone.destroy();
    this.overlayHitZones = [];
  }

  protected relayout(): void {
    const oldArena = this.arena;
    this.arena     = this.resolveArena();
    const velocityScale = this.arena.scale / oldArena.scale;

    this.slingshot?.cancel();
    if (this.slingshot) {
      this.slingshot.maxDrag     = MAX_DRAG_SRC * this.arena.scale;
      this.slingshot.launchSpeed = LAUNCH_SPEED_SRC * this.arena.scale;
    }

    const resizeBall = (ball: BallState): void => {
      const relX = (ball.x - oldArena.cx) / oldArena.rx;
      const relY = (ball.y - oldArena.cy) / oldArena.ry;
      ball.x  = this.arena.cx + relX * this.arena.rx;
      ball.y  = this.arena.cy + relY * this.arena.ry;
      ball.r  = BALL_SRC_R * this.arena.scale;
      ball.vx *= velocityScale;
      ball.vy *= velocityScale;
    };
    if (this.onlineMatch?.snapshot?.gameId === 'kame-knock' && this.onlineBalls.size > 0) {
      for (const ball of new Set(this.onlineBalls.values())) resizeBall(ball);
    } else {
      resizeBall(this.ball);
    }

    this.drawBackground();
    this.drawTargets();
    this.drawBall();

    this.hudObjects.forEach((object) => object.destroy());
    this.hudObjects = buildReturnButton(this, 'HubScene', () => this.markOnlineAway());
    this.ballText?.setPosition(this.scale.width / 2, 16);
    this.onlineStatusText?.setPosition(this.scale.width / 2, 48);
    this.countdownText?.setPosition(this.scale.width / 2, this.scale.height / 2);

    this.updateSidePanels();
    // Re-run the full layout decision so the panel switches between docked and
    // collapsed drop-down as the viewport crosses the fit threshold on zoom.
    if (this.powerSidePanel?.isVisible()) this.showPowerPanel();
    this.syncSlingshotForTurn();

    if (this.overlay) {
      this.overlay.destroy(true);
      const onlineSnapshot = this.onlineMatch?.snapshot?.gameId === 'kame-knock' ? this.onlineMatch.snapshot : null;
      if (onlineSnapshot?.phase === 'finished' || onlineSnapshot?.phase === 'abandoned') this.showOnlineEndScreen(onlineSnapshot);
      else this.showEndScreen();
    }
  }

  // ── Icon helpers (used in info rows - kept for reference, info panel removed) ─
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
}
