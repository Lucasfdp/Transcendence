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
import { getGameSocket, type BambooBashSnapshot, type BambooBashThrowEvent, type GameSnapshot, type OnlineMatchContext } from '../../network/gameSocket';

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

interface LocalParticipant {
  ball: BallState;
  slingshot: Slingshot;
  score: number;
  powers: PowerType[];
  powerUsed: Set<PowerType>;
  activePower: PowerType;
  ballWasMoving: boolean;
}

export class BambooBashScene extends ResponsiveScene {
  private bgGfx!:     Phaser.GameObjects.Graphics;
  private bambooGfx!: Phaser.GameObjects.Graphics;
  private ballGfx!:   Phaser.GameObjects.Graphics;

  private arena!: ArenaPixels;
  private ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
  private slingshot!: Slingshot;
  private localParticipants: LocalParticipant[] = [];
  private activeLocalParticipantIndex = 0;
  private hudObjects: Phaser.GameObjects.GameObject[] = [];

  private bamboos: Bamboo[] = [];
  private spawnAccMs   = 0;
  private spawnFreezeMs = 0; // FREEZE power: pauses spawn accumulation when > 0

  private score = 0;
  private totalScore = 0;
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

  private onlineMatch: OnlineMatchContext | null = null;
  private lastOnlineSeq = -1;
  private onlineRoundSubmitted = false;
  private onlineStatusText?: Phaser.GameObjects.Text;
  private onlineRoundNumber = 1;
  private onlineTotalRounds = 3;
  private onlineScores: number[] = [];
  private onlineBalls = new Map<number, BallState>();
  private pendingOnlineBambooHits = new Set<number>();
  private onlineBambooSyncAccMs = 0;

  private readonly handleOnlineState = (snapshot: GameSnapshot): void => {
    if (snapshot.gameId === 'bamboo-bash') this.applyOnlineSnapshot(snapshot);
  };

  private readonly handleOnlineThrow = (event: BambooBashThrowEvent): void => {
    this.playOnlineThrow(event);
  };

  constructor() { super({ key: 'BambooBashScene' }); }

  create(): void {
    const registryOnlineMatch = (this.registry.get('onlineMatch') as OnlineMatchContext | undefined) ?? null;
    this.onlineMatch = registryOnlineMatch?.snapshot?.gameId === 'bamboo-bash' ? registryOnlineMatch : null;
    this.lastOnlineSeq = -1;
    this.onlineRoundSubmitted = false;
    this.onlineRoundNumber = 1;
    this.onlineTotalRounds = 3;
    this.onlineScores = [];
    this.onlineBalls.clear();
    this.pendingOnlineBambooHits.clear();
    this.onlineBambooSyncAccMs = 0;
    this.activeLocalParticipantIndex = 0;

    const initialOnlineSnapshot = this.onlineMatch?.snapshot?.gameId === 'bamboo-bash'
      ? this.onlineMatch.snapshot
      : null;

    // Reset per-round state (scenes are reused across restarts)
    this.localParticipants.forEach((participant) => participant.slingshot.destroy());
    this.localParticipants = [];
    this.bamboos       = [];
    this.spawnAccMs    = 0;
    this.spawnFreezeMs = 0;
    this.score         = 0;
    this.totalScore    = initialOnlineSnapshot?.score[this.onlineMatch?.side ?? 0] ?? 0;
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
    const sel = this.registry.get('shellSelection') as
      { player0?: string[]; player1?: string[] } | undefined;
    const buildPool = (picks: string[] | undefined): PowerType[] => {
      const specials = (picks ?? [])
        .map((s) => s as PowerType)
        .filter((s) => (Object.values(PowerType) as string[]).includes(s) && s !== PowerType.NONE);
      const pool = [PowerType.NONE, ...new Set(specials)];
      return pool.length > 1 ? pool : [PowerType.NONE, ...GAME_POWERS['bamboo-bash']];
    };
    this.playerPowers = buildPool(sel?.player0);

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

    if (!this.onlineMatch) {
      const pools = [buildPool(sel?.player0), buildPool(sel?.player1)];
      this.localParticipants = pools.map((powers, index) => {
        const ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R * this.arena.scale };
        this.resetLocalBall(ball, index);
        const slingshot = new Slingshot(this, ball, {
          maxDrag: MAX_DRAG_SRC * this.arena.scale,
          launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
          depth: 2,
        }, () => this.onLocalLaunch(index));
        return {
          ball,
          slingshot,
          score: 0,
          powers,
          powerUsed: new Set<PowerType>(),
          activePower: PowerType.NONE,
          ballWasMoving: false,
        };
      });
      this.slingshot.destroy();
    }

    if (!this.onlineMatch) {
      for (let i = 0; i < START_BAMBOO; i++) this.spawnBamboo();
    }

    this.drawBackground();
    this.drawBamboos();
    this.drawBalls();
    this.buildHud();
    if (this.onlineMatch) this.createOnlineStatusText();
    this.updateSidePanels();
    this.showPowerPanel();

    this.enableResponsive();   // relayout on resize/zoom (see ResponsiveScene)

    if (initialOnlineSnapshot) this.applyOnlineSnapshot(initialOnlineSnapshot, true);
    if (this.onlineMatch) this.initOnlineMatch();

    const shouldStartRound = !initialOnlineSnapshot
      || (initialOnlineSnapshot.phase === 'active' && initialOnlineSnapshot.roundScores[this.onlineMatch?.side ?? 0] === null);
    if (!this.onlineMatch || shouldStartRound) this.startCountdown();
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
    this.syncOnlineTimeLeft();
    if (this.timeLeftMs <= 0) { this.endRound(); return; }
    if (this.localParticipants.length > 0) {
      this.syncLocalSlingshots();
    } else {
      this.slingshot.attach();
    }
    this.running = true;
  }

  protected onShutdown(): void {
    this.slingshot.destroy();
    this.localParticipants.forEach((participant) => participant.slingshot.destroy());
    this.localParticipants = [];
    this.overlay?.destroy(true);
    this.powerSidePanel?.destroy();
    this.powerSidePanel = null;
    this.countdownText?.destroy();
    this.destroySidePanels();
    if (this.onlineMatch) {
      const socket = getGameSocket();
      socket.off('game:state', this.handleOnlineState);
      socket.off('game:end', this.handleOnlineState);
      socket.off('game:bamboo-throw', this.handleOnlineThrow);
    }
  }

  update(_time: number, delta: number): void {
    if (!this.running) return;

    // Countdown. Online rounds use the server-provided deadline so simultaneous
    // games end together even if clients loaded the scene at slightly different times.
    if (!this.syncOnlineTimeLeft()) this.timeLeftMs = Math.max(0, this.timeLeftMs - delta);
    this.timerText.setText(this.formatTime());
    if (this.timeLeftMs <= 0) { this.endRound(); return; }

    // Grow existing bamboo (paused while FREEZE is active)
    this.spawnFreezeMs = Math.max(0, this.spawnFreezeMs - delta);
    for (const b of this.bamboos) stepBamboo(b, delta);

    // Spawn new bamboo on cadence while there's room (pause during freeze).
    // Online spawns are owned by the backend and arrive through snapshots.
    if (!this.onlineMatch && this.spawnFreezeMs <= 0) {
      this.spawnAccMs += delta;
      if (this.spawnAccMs >= SPAWN_EVERY_MS) {
        this.spawnAccMs = 0;
        if (this.bamboos.length < MAX_BAMBOO) this.spawnBamboo();
      }
    }

    if (this.localParticipants.length > 0) {
      this.updateLocalParticipants(delta);
      this.drawBamboos();
      this.drawBalls();
      return;
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
      if (this.onlineMatch) this.slingshot.attach();
      this.showPowerPanel();
    }
    this.ballWasMoving = moving;

    if (this.onlineMatch) this.updateOnlineRemoteBalls(delta);
    if (this.onlineMatch) this.syncOnlineBamboos(delta);

    this.drawBamboos();
    this.drawBalls();
  }

  // ── Launch handler ────────────────────────────────────────────────────────────

  /**
   * Called by Slingshot after it sets ball.vx / ball.vy.
   * INVARIANT: applyBallPower is called exactly once per shot, AFTER the
   * slingshot has set velocity and AFTER resetBall reset the radius.
   */
  private onLaunch(): void {
    if (this.onlineMatch) {
      const sourceVx = this.ball.vx / this.arena.scale;
      const sourceVy = this.ball.vy / this.arena.scale;
      const power = this.activePower;
      this.ball.vx = 0;
      this.ball.vy = 0;
      if (power !== PowerType.NONE) this.powerUsed.add(power);
      this.activePower = PowerType.NONE;
      this.powerSidePanel?.hide();
      this.slingshot.destroy();
      this.slingshot = new Slingshot(this, this.ball, {
        maxDrag: MAX_DRAG_SRC * this.arena.scale,
        launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
        depth: 2,
      }, () => this.onLaunch());
      this.updateOnlineStatus('Launching...');
      getGameSocket().emit('game:input', {
        matchId: this.onlineMatch.matchId,
        action: 'release',
        payload: { roundNumber: this.onlineRoundNumber, vx: sourceVx, vy: sourceVy, power },
      });
      return;
    }

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

  private onLocalLaunch(index: number): void {
    const participant = this.localParticipants[index];
    if (!participant) return;

    participant.ball.r = BALL_SRC_R * this.arena.scale;
    applyBallPower(participant.activePower, participant.ball, this.arena);

    if (participant.activePower !== PowerType.NONE) {
      participant.powerUsed.add(participant.activePower);
    }

    participant.activePower = PowerType.NONE;
    this.powerSidePanel?.hide();
  }

  // ── Stop-flag resolvers ───────────────────────────────────────────────────────

  private resolveStopBomb(): void {
    const blastR = BOMB_RADIUS_SRC * this.arena.scale;
    const bx = this.ball.x;
    const by = this.ball.y;
    if (this.onlineMatch) {
      for (const b of this.bamboos) {
        const pos = bambooPos(b, this.arena);
        if (Math.hypot(pos.x - bx, pos.y - by) < blastR) this.reportOnlineBambooHit(b);
      }
      return;
    }
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
    if (this.onlineMatch) {
      for (const b of this.bamboos) {
        const pos = bambooPos(b, this.arena);
        if (Math.hypot(pos.x - bx, pos.y - by) < repelR) this.reportOnlineBambooHit(b);
      }
      return;
    }
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

      if (this.onlineMatch) {
        this.reportOnlineBambooHit(b);
        continue;
      }

      const points = STAGE_POINTS[b.stage] ?? 0;
      this.score += points;
      this.updateHudText();

      const p = bambooPos(b, this.arena);
      this.popScore(p.x, p.y, points);
      this.addScoreEvent(`Stage ${b.stage} bamboo`, `+${points}`);
      this.bamboos.splice(i, 1);
    }
  }

  private reportOnlineBambooHit(bamboo: Bamboo): void {
    if (!this.onlineMatch || !('id' in bamboo) || typeof bamboo.id !== 'number') return;
    if (this.pendingOnlineBambooHits.has(bamboo.id)) return;
    this.pendingOnlineBambooHits.add(bamboo.id);
    getGameSocket().emit('game:input', {
      matchId: this.onlineMatch.matchId,
      action: 'bamboo:hit',
      payload: { roundNumber: this.onlineRoundNumber, bambooId: bamboo.id },
    });
  }

  private endRound(): void {
    this.running = false;
    this.timerText.setText(this.formatTime());
    this.slingshot.cancel();
    for (const participant of this.localParticipants) {
      participant.slingshot.cancel();
      participant.ball.vx = 0;
      participant.ball.vy = 0;
    }
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.powerSidePanel?.hide();
    this.updateSidePanels();
    if (this.onlineMatch) {
      this.slingshot.destroy();
      this.submitOnlineRoundScore();
      return;
    }
    this.submitResult();
    this.showEndScreen();
  }

  private initOnlineMatch(): void {
    const socket = getGameSocket();
    socket.off('game:state', this.handleOnlineState);
    socket.off('game:end', this.handleOnlineState);
    socket.off('game:bamboo-throw', this.handleOnlineThrow);
    socket.on('game:state', this.handleOnlineState);
    socket.on('game:end', this.handleOnlineState);
    socket.on('game:bamboo-throw', this.handleOnlineThrow);
    this.updateOnlineStatus('Connected to Bamboo Bash match.');
  }

  private submitOnlineRoundScore(): void {
    if (!this.onlineMatch || this.onlineRoundSubmitted) return;
    this.onlineRoundSubmitted = true;
    this.updateOnlineStatus('Waiting for opponents...');
    getGameSocket().emit('game:input', {
      matchId: this.onlineMatch.matchId,
      action: 'round:score',
      payload: { roundNumber: this.onlineRoundNumber, score: this.score },
    });
  }

  private applyOnlineSnapshot(snapshot: BambooBashSnapshot, initial = false): void {
    if (!this.onlineMatch || snapshot.matchId !== this.onlineMatch.matchId || snapshot.seq <= this.lastOnlineSeq) return;
    this.lastOnlineSeq = snapshot.seq;
    this.onlineMatch.snapshot = snapshot;
    this.onlineRoundNumber = snapshot.roundNumber;
    this.onlineTotalRounds = snapshot.totalRounds;
    this.onlineScores = snapshot.score;
    this.score = snapshot.liveRoundScores[this.onlineMatch.side] ?? this.score;
    this.bamboos = snapshot.bamboos.map((bamboo) => ({ ...bamboo }));
    const liveBambooIds = new Set(snapshot.bamboos.map((bamboo) => bamboo.id));
    for (const pendingId of [...this.pendingOnlineBambooHits]) {
      if (!liveBambooIds.has(pendingId)) this.pendingOnlineBambooHits.delete(pendingId);
    }
    this.drawBamboos();
    this.syncOnlineBalls(snapshot);
    this.drawBalls();
    this.totalScore = snapshot.score[this.onlineMatch.side] ?? this.totalScore;
    this.syncOnlineTimeLeft(snapshot);
    this.updateHudText();
    this.updateSidePanels();

    if (snapshot.phase === 'finished' || snapshot.phase === 'abandoned') {
      this.showOnlineEndScreen(snapshot);
      return;
    }

    if (snapshot.phase !== 'active') {
      this.updateOnlineStatus('Waiting for opponents...');
      return;
    }

    const localSubmitted = snapshot.roundScores[this.onlineMatch.side] !== null;
    if (localSubmitted) {
      this.updateOnlineStatus('Waiting for opponents...');
      return;
    }

    if (!initial && (this.onlineRoundSubmitted || !this.running)) this.startOnlineRound(snapshot);
    else this.updateOnlineStatus(`Round ${snapshot.roundNumber}/${snapshot.totalRounds}`);
  }

  private startOnlineRound(snapshot: BambooBashSnapshot): void {
    this.overlay?.destroy(true);
    this.overlay = undefined;
    this.bamboos = [];
    this.spawnAccMs = 0;
    this.spawnFreezeMs = 0;
    this.score = 0;
    this.timeLeftMs = this.onlineRemainingMs(snapshot);
    this.running = false;
    this.onlineRoundSubmitted = false;
    this.ballWasMoving = false;
    this.powerUsed = new Set(); // Online Bamboo Bash gives each 30s round a fresh power pool.
    this.activePower = PowerType.NONE;
    this.onlineBambooSyncAccMs = 0;
    this.resetBall();
    this.resetOnlineBalls(snapshot);
    this.slingshot.destroy();
    this.slingshot = new Slingshot(this, this.ball, {
      maxDrag: MAX_DRAG_SRC * this.arena.scale,
      launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
      depth: 2,
    }, () => this.onLaunch());
    this.bamboos = snapshot.bamboos.map((bamboo) => ({ ...bamboo }));
    this.pendingOnlineBambooHits.clear();
    this.drawBamboos();
    this.drawBalls();
    this.updateHudText();
    this.updateSidePanels();
    this.showPowerPanel();
    this.updateOnlineStatus(`Round ${snapshot.roundNumber}/${snapshot.totalRounds}`);
    this.startCountdown();
  }

  private createOnlineStatusText(): void {
    this.onlineStatusText = this.add.text(this.scale.width / 2, 48, '', {
      fontSize: '13px', color: '#d4a843', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(DEPTH_HUD + 2);
  }

  private updateOnlineStatus(message: string): void {
    this.onlineStatusText?.setText(message);
  }

  private playOnlineThrow(event: BambooBashThrowEvent): void {
    if (!this.onlineMatch || event.matchId !== this.onlineMatch.matchId || event.roundNumber !== this.onlineRoundNumber) return;
    const ball = this.onlineBalls.get(event.side);
    if (!ball) return;

    ball.r = BALL_SRC_R * this.arena.scale;
    ball.vx = event.vx * this.arena.scale;
    ball.vy = event.vy * this.arena.scale;
    const power = (Object.values(PowerType) as string[]).includes(event.power) ? event.power as PowerType : PowerType.NONE;
    applyBallPower(power, ball, this.arena);

    if (event.side === this.onlineMatch.side) {
      this.ballWasMoving = true;
      this.updateOnlineStatus('Your throw...');
    } else {
      this.updateOnlineStatus(`P${event.side + 1} throw...`);
    }
    this.drawBalls();
  }

  private syncOnlineTimeLeft(snapshot?: BambooBashSnapshot): boolean {
    const onlineSnapshot = snapshot ?? (this.onlineMatch?.snapshot?.gameId === 'bamboo-bash' ? this.onlineMatch.snapshot : null);
    if (!onlineSnapshot?.roundEndsAt) return false;
    this.timeLeftMs = this.onlineRemainingMs(onlineSnapshot);
    return true;
  }

  private onlineRemainingMs(snapshot: BambooBashSnapshot): number {
    return Math.max(0, (snapshot.roundEndsAt ?? Date.now()) - Date.now());
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

    const rows = this.localParticipants.length > 0
      ? this.localParticipants.map((participant, index) => ({ name: `Player ${index + 1}`, score: participant.score }))
      : [{ name: 'You', score: this.score }];
    let nameText: Phaser.GameObjects.Text | null = null;
    rows.forEach((row, index) => {
      const rowY = -H / 2 + 120 + index * 32;
      const createdNameText = this.add.text(-W / 2 + 40, rowY, row.name, {
      fontSize: '20px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      const scoreText = this.add.text(W / 2 - 40, rowY, String(row.score), {
      fontSize: '20px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
      }).setOrigin(1, 0.5);
      if (index === 0) nameText = createdNameText;
      c.add(createdNameText);
      c.add(scoreText);
    });

    api.getMe()
      .then((me: { displayName?: string; username?: string }) => {
        if (this.overlay !== c || !nameText) return;
        nameText.setText(me.displayName || me.username || 'You');
      })
      .catch(() => { /* keep the "You" fallback */ });

    this.addOverlayButton(c, -110, H / 2 - 50, 'PLAY AGAIN', () => this.scene.restart());
    this.addOverlayButton(c,  110, H / 2 - 50, 'RETURN', () => this.scene.start('HubScene'));
  }

  private showOnlineEndScreen(snapshot: BambooBashSnapshot): void {
    this.running = false;
    this.slingshot.cancel();
    this.powerSidePanel?.hide();
    this.overlay?.destroy(true);

    const { width, height } = this.scale;
    const c = this.add.container(width / 2, height / 2).setDepth(DEPTH_OVERLAY);
    this.overlay = c;

    const W = 520, H = 340;
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.74);
    bg.fillRoundedRect(-W / 2, -H / 2, W, H, 14);
    bg.lineStyle(2, THEME.gold, 0.85);
    bg.strokeRoundedRect(-W / 2, -H / 2, W, H, 14);
    c.add(bg);

    const title = snapshot.winnerSide === null
      ? 'DRAW'
      : snapshot.winnerSide === this.onlineMatch?.side ? 'YOU WIN!' : 'YOU LOSE';
    c.add(this.add.text(0, -H / 2 + 38, title, {
      fontSize: '30px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5));

    c.add(this.add.text(0, -H / 2 + 78, 'FINAL SCORES', {
      fontSize: '14px', color: THEME.text, fontFamily: THEME.font,
    }).setOrigin(0.5));

    const rows = snapshot.players.map((player) => ({
      name: player.side === this.onlineMatch?.side ? `${player.username} (You)` : player.username,
      score: snapshot.score[player.side] ?? 0,
      side: player.side,
    }));

    rows.forEach((row, index) => {
      const y = -H / 2 + 120 + index * 30;
      const color = row.side === snapshot.winnerSide ? THEME.textGold : THEME.text;
      c.add(this.add.text(-W / 2 + 48, y, row.name, {
        fontSize: '18px', color, fontFamily: THEME.font, fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      c.add(this.add.text(W / 2 - 48, y, String(row.score), {
        fontSize: '18px', color, fontFamily: THEME.font, fontStyle: 'bold',
      }).setOrigin(1, 0.5));
    });

    this.addOverlayButton(c, 0, H / 2 - 50, 'RETURN', () => {
      this.registry.remove('onlineMatch');
      this.scene.start('HubScene');
    });
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

  private updateHudText(): void {
    if (this.onlineMatch) {
      this.scoreText?.setText(`ROUND ${this.onlineRoundNumber}/${this.onlineTotalRounds}  SCORE ${this.score}  TOTAL ${this.totalScore}`);
    } else if (this.localParticipants.length > 0) {
      const scoreLine = this.localParticipants.map((participant, index) => `P${index + 1} ${participant.score}`).join('   ');
      this.scoreText?.setText(`${scoreLine}   TURN P${this.activeLocalParticipantIndex + 1}`);
    } else {
      this.scoreText?.setText(`SCORE  ${this.score}`);
    }
    this.timerText?.setText(this.formatTime());
  }

  // ── Rendering helpers ───────────────────────────────────────────────────────

  private drawBamboos(): void {
    this.bambooGfx.clear();
    for (const b of this.bamboos) drawBamboo(this.bambooGfx, b, this.arena);
  }

  private drawBalls(): void {
    this.ballGfx.clear();
    if (this.onlineBalls.size > 0) {
      for (const [side, ball] of [...this.onlineBalls.entries()].sort(([a], [b]) => a - b)) {
        const colour = side === this.onlineMatch?.side ? THEME.gold : THEME.red;
        drawShellBall(this.ballGfx, ball, false);
        this.ballGfx.lineStyle(Math.max(2, ball.r * 0.14), colour, 0.95);
        this.ballGfx.strokeCircle(ball.x, ball.y, ball.r * 1.08);
      }
      return;
    }

    if (this.localParticipants.length <= 0) {
      drawShellBall(this.ballGfx, this.ball, false);
      return;
    }

    this.localParticipants.forEach((participant, index) => {
      const colour = index === 0 ? THEME.gold : THEME.red;
      drawShellBall(this.ballGfx, participant.ball, false);
      this.ballGfx.lineStyle(Math.max(2, participant.ball.r * 0.14), colour, 0.95);
      this.ballGfx.strokeCircle(participant.ball.x, participant.ball.y, participant.ball.r * 1.08);
    });
  }

  private resetBall(): void {
    this.ball.x  = this.arena.cx;
    this.ball.y  = this.arena.cy;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.r  = BALL_SRC_R * this.arena.scale;
  }

  private syncOnlineBalls(snapshot: BambooBashSnapshot): void {
    if (!this.onlineMatch) return;
    const next = new Map<number, BallState>();
    const players = [...snapshot.players].sort((a, b) => a.side - b.side);
    players.forEach((player, index) => {
      const existing = player.side === this.onlineMatch?.side
        ? this.ball
        : this.onlineBalls.get(player.side) ?? { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R * this.arena.scale };
      if (!isBallMoving(existing)) this.resetOnlineBall(existing, index, players.length);
      next.set(player.side, existing);
    });
    this.onlineBalls = next;
  }

  private resetOnlineBalls(snapshot: BambooBashSnapshot): void {
    const players = [...snapshot.players].sort((a, b) => a.side - b.side);
    players.forEach((player, index) => {
      const ball = player.side === this.onlineMatch?.side
        ? this.ball
        : this.onlineBalls.get(player.side) ?? { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R * this.arena.scale };
      this.resetOnlineBall(ball, index, players.length);
      this.onlineBalls.set(player.side, ball);
    });
  }

  private resetOnlineBall(ball: BallState, index: number, total: number): void {
    if (total === 2) {
      ball.x = this.arena.cx + (index === 0 ? -0.22 : 0.22) * this.arena.rx;
      ball.y = this.arena.cy;
    } else {
      const angle = -Math.PI / 2 + (index / Math.max(1, total)) * Math.PI * 2;
      ball.x = this.arena.cx + Math.cos(angle) * this.arena.rx * 0.24;
      ball.y = this.arena.cy + Math.sin(angle) * this.arena.ry * 0.24;
    }
    ball.vx = 0;
    ball.vy = 0;
    ball.r = BALL_SRC_R * this.arena.scale;
  }

  private resetLocalBall(ball: BallState, index: number): void {
    ball.x  = this.arena.cx + (index === 0 ? -0.22 : 0.22) * this.arena.rx;
    ball.y  = this.arena.cy;
    ball.vx = 0;
    ball.vy = 0;
    ball.r  = BALL_SRC_R * this.arena.scale;
  }

  private updateLocalParticipants(delta: number): void {
    const moving = this.localParticipants.map((participant) => {
      const isMoving = stepBall(participant.ball, delta, this.arena);
      const ext = participant.ball as BallExtState;
      if (isMoving && ext.frictionOverride !== undefined) {
        const factor = Math.pow(ext.frictionOverride / BALL_FRICTION_BASE, delta / 16.67);
        participant.ball.vx *= factor;
        participant.ball.vy *= factor;
      }
      return isMoving;
    });

    this.resolveLocalBallCollisions();

    const anyWasMoving = this.localParticipants.some((participant) => participant.ballWasMoving);
    this.localParticipants.forEach((participant, index) => {
      const ext = participant.ball as BallExtState;
      if (moving[index]) {
        this.checkLocalBambooHits(participant, index);
      } else {
        if (ext.phantomHidden) ext.phantomHidden = false;
        if (ext.bombPending) {
          this.resolveLocalStopBomb(participant.ball);
          ext.bombPending = false;
        }
        if (ext.repelPending) {
          this.resolveLocalStopRepel(participant.ball);
          ext.repelPending = false;
        }
        if (ext.freezePending) {
          this.spawnFreezeMs = FREEZE_DURATION_MS;
          ext.freezePending = false;
        }
      }

      participant.ballWasMoving = moving[index];
    });

    const active = this.localParticipants[this.activeLocalParticipantIndex];
    const allStopped = moving.every((isMoving) => !isMoving);
    if (active && allStopped && anyWasMoving && this.running) {
      this.activeLocalParticipantIndex = (this.activeLocalParticipantIndex + 1) % this.localParticipants.length;
      this.syncLocalSlingshots();
      this.showPowerPanel();
      this.updateHudText();
    }
  }

  private updateOnlineRemoteBalls(delta: number): void {
    if (!this.onlineMatch) return;
    for (const [side, ball] of this.onlineBalls.entries()) {
      if (side === this.onlineMatch.side) continue;
      const moving = stepBall(ball, delta, this.arena);
      const ext = ball as BallExtState;
      if (moving && ext.frictionOverride !== undefined) {
        const factor = Math.pow(ext.frictionOverride / BALL_FRICTION_BASE, delta / 16.67);
        ball.vx *= factor;
        ball.vy *= factor;
      }
      if (!moving) {
        ext.phantomHidden = false;
        ext.bombPending = false;
        ext.repelPending = false;
        ext.freezePending = false;
      }
    }
  }

  private syncOnlineBamboos(delta: number): void {
    if (!this.onlineMatch || this.onlineRoundSubmitted) return;
    this.onlineBambooSyncAccMs += delta;
    if (this.onlineBambooSyncAccMs < 1000) return;
    this.onlineBambooSyncAccMs = 0;
    getGameSocket().emit('game:input', {
      matchId: this.onlineMatch.matchId,
      action: 'bamboo:sync',
      payload: { roundNumber: this.onlineRoundNumber },
    });
  }

  private syncLocalSlingshots(): void {
    this.localParticipants.forEach((participant, index) => {
      if (index === this.activeLocalParticipantIndex && !isBallMoving(participant.ball)) {
        participant.slingshot.attach();
      } else {
        participant.slingshot.destroy();
      }
    });
  }

  private resolveLocalBallCollisions(): void {
    for (let i = 0; i < this.localParticipants.length; i++) {
      for (let j = i + 1; j < this.localParticipants.length; j++) {
        const a = this.localParticipants[i].ball;
        const b = this.localParticipants[j].ball;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(0.001, Math.hypot(dx, dy));
        const minDist = a.r + b.r;
        if (dist >= minDist) continue;

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = (minDist - dist) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const speed = rvx * nx + rvy * ny;
        if (speed > 0) continue;
        a.vx += speed * nx;
        a.vy += speed * ny;
        b.vx -= speed * nx;
        b.vy -= speed * ny;
      }
    }
  }

  private checkLocalBambooHits(participant: LocalParticipant, participantIndex: number): void {
    const ext = participant.ball as BallExtState;
    for (let i = this.bamboos.length - 1; i >= 0; i--) {
      const b = this.bamboos[i];
      if (!hitsBamboo(b, this.arena, participant.ball.x, participant.ball.y, participant.ball.r)) continue;
      if (ext.ghostUsed === false) {
        ext.ghostUsed = true;
        continue;
      }
      const points = STAGE_POINTS[b.stage] ?? 0;
      participant.score += points;
      const p = bambooPos(b, this.arena);
      this.popScore(p.x, p.y, points);
      this.addScoreEvent(`P${participantIndex + 1} stage ${b.stage} bamboo`, `+${points}`);
      this.bamboos.splice(i, 1);
    }
    this.score = this.localParticipants[0]?.score ?? this.score;
    this.updateHudText();
  }

  private resolveLocalStopBomb(ball: BallState): void {
    const blastR = BOMB_RADIUS_SRC * this.arena.scale;
    this.bamboos = this.bamboos.filter(b => {
      const pos = bambooPos(b, this.arena);
      return Math.hypot(pos.x - ball.x, pos.y - ball.y) >= blastR;
    });
  }

  private resolveLocalStopRepel(ball: BallState): void {
    const repelR = REPEL_RADIUS_SRC * this.arena.scale;
    this.bamboos = this.bamboos.filter(b => {
      const pos = bambooPos(b, this.arena);
      return Math.hypot(pos.x - ball.x, pos.y - ball.y) >= repelR;
    });
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

    for (const [side, ball] of this.onlineBalls.entries()) {
      if (ball === this.ball) continue;
      const relX = (ball.x - oldArena.cx) / oldArena.rx;
      const relY = (ball.y - oldArena.cy) / oldArena.ry;
      ball.x = this.arena.cx + relX * this.arena.rx;
      ball.y = this.arena.cy + relY * this.arena.ry;
      ball.r = BALL_SRC_R * this.arena.scale;
      if (isBallMoving(ball)) {
        const vScale = this.arena.scale / oldArena.scale;
        ball.vx *= vScale;
        ball.vy *= vScale;
      } else if (this.onlineMatch?.snapshot?.gameId === 'bamboo-bash') {
        const players = [...this.onlineMatch.snapshot.players].sort((a, b) => a.side - b.side);
        const index = players.findIndex((player) => player.side === side);
        if (index >= 0) this.resetOnlineBall(ball, index, players.length);
      }
    }

    this.localParticipants.forEach((participant, index) => {
      participant.slingshot.cancel();
      participant.slingshot.maxDrag = MAX_DRAG_SRC * this.arena.scale;
      participant.slingshot.launchSpeed = LAUNCH_SPEED_SRC * this.arena.scale;
      if (oldArena) {
        const pRelX = (participant.ball.x - oldArena.cx) / oldArena.rx;
        const pRelY = (participant.ball.y - oldArena.cy) / oldArena.ry;
        participant.ball.x = this.arena.cx + pRelX * this.arena.rx;
        participant.ball.y = this.arena.cy + pRelY * this.arena.ry;
      } else {
        this.resetLocalBall(participant.ball, index);
      }
      participant.ball.r = BALL_SRC_R * this.arena.scale;
    });

    this.drawBackground();
    this.drawBamboos();
    this.drawBalls();

    this.hudObjects.forEach((o) => o.destroy());
    this.hudObjects = buildReturnButton(this);
    this.scoreText.setPosition(16, 16);
    this.timerText.setPosition(this.scale.width / 2, 16);
    this.onlineStatusText?.setPosition(this.scale.width / 2, 48);
    this.overlay?.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.countdownText?.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.updateSidePanels();
    // Re-show power panel if ball is currently stopped (player can still aim)
    const activeLocal = this.localParticipants[this.activeLocalParticipantIndex];
    if (this.running && activeLocal && !isBallMoving(activeLocal.ball)) {
      this.syncLocalSlingshots();
      this.showPowerPanel();
    } else if (!activeLocal && !isBallMoving(this.ball) && this.running) {
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
    const localParticipant = this.localParticipants[this.activeLocalParticipantIndex];
    const powers = localParticipant?.powers ?? this.playerPowers;
    const activePower = localParticipant?.activePower ?? this.activePower;
    const powerUsed = localParticipant?.powerUsed ?? this.powerUsed;

    if (!this.powerSidePanel) {
      this.powerSidePanel = new PowerSidePanel(
        this,
        (type) => {
          const activeLocal = this.localParticipants[this.activeLocalParticipantIndex];
          if (activeLocal) activeLocal.activePower = type;
          else this.activePower = type;
        },
        DEPTH_HUD,
      );
    }

    if (!layout.leftPanel) {
      // No room to dock — collapse into an edge drop-down instead of vanishing.
      this.powerSidePanel.showCollapsible('left', powers, activePower, powerUsed);
      return;
    }

    this.powerSidePanel.show(layout.leftPanel, powers, activePower, powerUsed);
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
    if (this.localParticipants.length > 0) {
      return this.localParticipants.map((participant, index) => ({
        label: `P${index + 1} SCORE`,
        value: String(participant.score),
        labelColor: THEME.textGold,
        valueColor: THEME.textGold,
        labelFontSize: '14px',
        valueFontSize: '22px',
      }));
    }

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
