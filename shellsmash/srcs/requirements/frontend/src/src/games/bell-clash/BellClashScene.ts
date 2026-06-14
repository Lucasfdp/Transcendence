/**
 * BellClashScene — three-shot bell-ringing angle challenge.
 *
 * The shared slingshot and arena-wall ball physics are reused, while the central
 * bell collision and per-shot angular score zones stay local to this minigame.
 */

import Phaser from 'phaser';
import { ARENA_01 } from '../../shared/arenas/arena01';
import { ArenaPixels, arenaToScreen, drawSumoRing } from '../../shared/arenas/arena';
import { BallState, BALL_SRC_R, drawShellBall, isBallMoving, stepBall } from '../../shared/mechanics/ball';
import { Slingshot } from '../../shared/mechanics/slingshot';
import { buildReturnButton } from '../../shared/mechanics/hud';
import { THEME } from '../../shared/theme';

type ZoneKind = 'red' | 'yellow' | 'green';

interface ScoreZone {
  kind: ZoneKind;
  start: number;
  end: number;
}

const SHOTS_TOTAL = 3;
const MAX_DRAG_SRC = 380;
const LAUNCH_SPEED_SRC = 2_360;
const BELL_RADIUS_SRC = 150;
const SPAWN_GAP_SRC = 118;
const BASE_HIT_SCORE = 100;
const ZONE_SPAN = Math.PI * 2 * 0.15;
const BELL_BOUNCE_DAMP = 0.88;
const HIT_COOLDOWN_MS = 180;

const DEPTH_BG = 0;
const DEPTH_ZONES = 1;
const DEPTH_BELL = 2;
const DEPTH_AIM = 3;
const DEPTH_BALL = 4;
const DEPTH_FX = 5;
const DEPTH_HUD = 20;
const DEPTH_OVERLAY = 30;

const ZONE_DEFS: Record<ZoneKind, { color: number; label: string; multiplier: number }> = {
  red: { color: THEME.red, label: 'RED', multiplier: 0.5 },
  yellow: { color: THEME.gold, label: 'YELLOW', multiplier: 1.5 },
  green: { color: 0x4aa564, label: 'GREEN', multiplier: 2 },
};

const TWO_PI = Math.PI * 2;

export class BellClashScene extends Phaser.Scene {
  private bgGfx!: Phaser.GameObjects.Graphics;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private bellGfx!: Phaser.GameObjects.Graphics;
  private ballGfx!: Phaser.GameObjects.Graphics;

  private arena!: ArenaPixels;
  private ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
  private slingshot: Slingshot | null = null;
  private hudObjects: Phaser.GameObjects.GameObject[] = [];
  private overlay?: Phaser.GameObjects.Container;
  private overlayHitZones: Phaser.GameObjects.Zone[] = [];

  private zones: ScoreZone[] = [];
  private currentShot = 0;
  private launchedThisShot = false;
  private score = 0;
  private running = true;
  private hitCooldownMs = 0;
  private bellPulseMs = 0;
  private spawnAngle = 0;

  private scoreText: Phaser.GameObjects.Text | null = null;
  private shotText: Phaser.GameObjects.Text | null = null;
  private lastHitText: Phaser.GameObjects.Text | null = null;

  constructor() { super({ key: 'BellClashScene' }); }

  create(): void {
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanupSceneResources, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanupSceneResources, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupSceneResources, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanupSceneResources, this);

    this.zones = [];
    this.currentShot = 0;
    this.launchedThisShot = false;
    this.score = 0;
    this.running = true;
    this.hitCooldownMs = 0;
    this.bellPulseMs = 0;
    this.overlay = undefined;
    this.scoreText = null;
    this.shotText = null;
    this.lastHitText = null;

    this.arena = arenaToScreen(ARENA_01, this.scale.width, this.scale.height);
    this.setupShot();

    this.bgGfx = this.add.graphics().setDepth(DEPTH_BG);
    this.zoneGfx = this.add.graphics().setDepth(DEPTH_ZONES);
    this.bellGfx = this.add.graphics().setDepth(DEPTH_BELL);
    this.ballGfx = this.add.graphics().setDepth(DEPTH_BALL);

    this.slingshot = new Slingshot(this, this.ball, {
      maxDrag: MAX_DRAG_SRC * this.arena.scale,
      launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
      depth: DEPTH_AIM,
    }, () => this.onLaunch());
    this.slingshot.attach();

    this.drawBackground();
    this.drawZones();
    this.drawBell();
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
    this.shotText = null;
    this.lastHitText = null;
  }

  update(_time: number, delta: number): void {
    if (!this.running) return;

    this.hitCooldownMs = Math.max(0, this.hitCooldownMs - delta);
    this.bellPulseMs = Math.max(0, this.bellPulseMs - delta);

    const moving = stepBall(this.ball, delta, this.arena);
    if (moving) this.checkBellHit();
    if (this.launchedThisShot && !moving) this.finishShot();

    this.drawBell();
    drawShellBall(this.ballGfx, this.ball);
  }

  private onLaunch(): void {
    this.launchedThisShot = true;
    this.lastHitText?.setText('LAST HIT  -');
  }

  private setupShot(): void {
    this.launchedThisShot = false;
    this.hitCooldownMs = 0;
    this.bellPulseMs = 0;
    this.spawnAngle = Phaser.Math.FloatBetween(0, TWO_PI);
    this.zones = this.generateZones();
    this.resetBall();

    this.shotText?.setText(this.formatShotText());
    this.lastHitText?.setText('LAST HIT  -');
  }

  private finishShot(): void {
    this.launchedThisShot = false;
    this.currentShot += 1;

    if (this.currentShot >= SHOTS_TOTAL) {
      this.endRound();
      return;
    }

    this.setupShot();
    this.drawZones();
    this.drawBell();
    drawShellBall(this.ballGfx, this.ball);
  }

  private generateZones(): ScoreZone[] {
    const kinds: ZoneKind[] = Phaser.Utils.Array.Shuffle<ZoneKind>(['red', 'yellow', 'green']);
    const zones: ScoreZone[] = [];

    for (const kind of kinds) {
      let start = 0;
      let placed = false;
      for (let attempt = 0; attempt < 500 && !placed; attempt++) {
        start = Phaser.Math.FloatBetween(0, TWO_PI);
        const candidate = { kind, start, end: start + ZONE_SPAN };
        if (!zones.some((zone) => this.zonesOverlap(candidate, zone))) {
          zones.push(candidate);
          placed = true;
        }
      }

      if (!placed) {
        const step = Math.PI / 90;
        for (let i = 0; i < 180 && !placed; i++) {
          start = i * step;
          const candidate = { kind, start, end: start + ZONE_SPAN };
          if (!zones.some((zone) => this.zonesOverlap(candidate, zone))) {
            zones.push(candidate);
            placed = true;
          }
        }
      }
    }

    return zones;
  }

  private zonesOverlap(a: ScoreZone, b: ScoreZone): boolean {
    const aParts = this.unwrapInterval(a.start, a.end);
    const bParts = this.unwrapInterval(b.start, b.end);
    return aParts.some((pa) => bParts.some((pb) => pa.start < pb.end && pb.start < pa.end));
  }

  private unwrapInterval(start: number, end: number): Array<{ start: number; end: number }> {
    const s = this.normalizeAngle(start);
    const e = this.normalizeAngle(end);
    if (end - start >= TWO_PI) return [{ start: 0, end: TWO_PI }];
    if (s < e) return [{ start: s, end: e }];
    return [{ start: s, end: TWO_PI }, { start: 0, end: e }];
  }

  private checkBellHit(): void {
    const dx = this.ball.x - this.arena.cx;
    const dy = this.ball.y - this.arena.cy;
    const dist = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / dist;
    const ny = dy / dist;
    const bellRadius = this.bellRadius();
    const minDist = bellRadius + this.ball.r;

    if (dist >= minDist) return;

    this.ball.x = this.arena.cx + nx * minDist;
    this.ball.y = this.arena.cy + ny * minDist;

    const dot = this.ball.vx * nx + this.ball.vy * ny;
    if (dot >= 0) return;

    this.ball.vx = (this.ball.vx - 2 * dot * nx) * BELL_BOUNCE_DAMP;
    this.ball.vy = (this.ball.vy - 2 * dot * ny) * BELL_BOUNCE_DAMP;

    if (this.hitCooldownMs > 0) return;
    this.hitCooldownMs = HIT_COOLDOWN_MS;
    this.bellPulseMs = 180;
    this.scoreBellHit(Math.atan2(dy, dx));
  }

  private scoreBellHit(angle: number): void {
    const zone = this.zoneAt(angle);
    const def = zone ? ZONE_DEFS[zone.kind] : null;
    const multiplier = def?.multiplier ?? 1;
    const gained = Math.round(BASE_HIT_SCORE * multiplier);
    const label = def?.label ?? 'NEUTRAL';
    const color = def ? `#${def.color.toString(16).padStart(6, '0')}` : THEME.text;

    this.score += gained;
    this.scoreText?.setText(`SCORE  ${this.score}`);
    this.lastHitText?.setText(`LAST HIT  ${label} x${multiplier}`);
    this.popScore(this.ball.x, this.ball.y, `+${gained}  ${label}`, color);
  }

  private zoneAt(angle: number): ScoreZone | null {
    const normalized = this.normalizeAngle(angle);
    return this.zones.find((zone) => this.angleInZone(normalized, zone)) ?? null;
  }

  private angleInZone(angle: number, zone: ScoreZone): boolean {
    return this.unwrapInterval(zone.start, zone.end).some((part) => angle >= part.start && angle <= part.end);
  }

  private normalizeAngle(angle: number): number {
    return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  }

  private endRound(): void {
    this.running = false;
    this.slingshot?.cancel();
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.showEndScreen();
  }

  private buildHud(): void {
    this.hudObjects = buildReturnButton(this);

    this.scoreText = this.add.text(16, 16, `SCORE  ${this.score}`, {
      fontSize: '22px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setDepth(DEPTH_HUD);

    this.lastHitText = this.add.text(16, 44, 'LAST HIT  -', {
      fontSize: '16px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold',
    }).setDepth(DEPTH_HUD);

    this.shotText = this.add.text(this.scale.width / 2, 16, this.formatShotText(), {
      fontSize: '26px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(DEPTH_HUD);
  }

  private formatShotText(): string {
    return `SHOT ${this.currentShot + 1}/${SHOTS_TOTAL}`;
  }

  private resetBall(): void {
    const radius = this.bellRadius() + BALL_SRC_R * this.arena.scale + SPAWN_GAP_SRC * this.arena.scale;
    this.ball.x = this.arena.cx + Math.cos(this.spawnAngle) * radius;
    this.ball.y = this.arena.cy + Math.sin(this.spawnAngle) * radius;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.r = BALL_SRC_R * this.arena.scale;
  }

  private bellRadius(): number {
    return BELL_RADIUS_SRC * this.arena.scale;
  }

  private drawBackground(): void {
    const { width, height } = this.scale;
    this.bgGfx.clear();
    this.bgGfx.fillStyle(0x120c08, 1);
    this.bgGfx.fillRect(0, 0, width, height);

    const ringStep = Math.max(38, Math.round(90 * this.arena.scale));
    this.bgGfx.lineStyle(1, 0x3b2c18, 0.42);
    for (let x = 0; x < width; x += ringStep) this.bgGfx.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += ringStep) this.bgGfx.lineBetween(0, y, width, y);

    drawSumoRing(this.bgGfx, this.arena);
  }

  private drawZones(): void {
    this.zoneGfx.clear();
    for (const zone of this.zones) this.drawZone(zone);
  }

  private drawZone(zone: ScoreZone): void {
    const points = this.zonePolygonPoints(zone.start, zone.end);
    const def = ZONE_DEFS[zone.kind];
    if (points.length < 3) return;

    this.zoneGfx.fillStyle(def.color, 0.28);
    this.zoneGfx.beginPath();
    this.zoneGfx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) this.zoneGfx.lineTo(point.x, point.y);
    this.zoneGfx.closePath();
    this.zoneGfx.fillPath();

    this.zoneGfx.lineStyle(Math.max(1, 2 * this.arena.scale), def.color, 0.55);
    this.zoneGfx.beginPath();
    this.zoneGfx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) this.zoneGfx.lineTo(point.x, point.y);
    this.zoneGfx.closePath();
    this.zoneGfx.strokePath();
  }

  private zonePolygonPoints(start: number, end: number): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    const inner = this.bellRadius() * 0.74;
    const segments = 18;

    for (let i = 0; i <= segments; i++) {
      const angle = start + (end - start) * (i / segments);
      points.push(this.pointOnEllipse(angle, -this.ball.r * 0.3));
    }
    for (let i = segments; i >= 0; i--) {
      const angle = start + (end - start) * (i / segments);
      points.push({
        x: this.arena.cx + Math.cos(angle) * inner,
        y: this.arena.cy + Math.sin(angle) * inner,
      });
    }

    return points;
  }

  private pointOnEllipse(angle: number, inset: number): { x: number; y: number } {
    const rx = Math.max(1, this.arena.rx + inset);
    const ry = Math.max(1, this.arena.ry + inset);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const scale = 1 / Math.sqrt((cos * cos) / (rx * rx) + (sin * sin) / (ry * ry));
    return {
      x: this.arena.cx + cos * scale,
      y: this.arena.cy + sin * scale,
    };
  }

  private drawBell(): void {
    const r = this.bellRadius();
    const pulse = this.bellPulseMs > 0 ? 1 + (this.bellPulseMs / 180) * 0.08 : 1;
    const x = this.arena.cx;
    const y = this.arena.cy;
    const bodyR = r * pulse;
    const lineW = Math.max(3, bodyR * 0.055);

    this.bellGfx.clear();
    this.bellGfx.fillStyle(0x000000, 0.28);
    this.bellGfx.fillEllipse(x + r * 0.18, y + r * 0.48, r * 2.28, r * 0.70);

    // Opaque footprint: hides the radial colour seams under the physical bell.
    this.bellGfx.fillStyle(0x5a3410, 1);
    this.bellGfx.fillCircle(x, y, bodyR * 1.03);
    this.bellGfx.lineStyle(Math.max(4, bodyR * 0.045), 0xf2d47a, 0.40);
    this.bellGfx.strokeCircle(x, y, bodyR * 1.02);

    this.bellGfx.fillStyle(0x8a5516, 1);
    this.traceBellBody(x, y, bodyR, 0.96, 0.76, 0.90, 0.78);
    this.bellGfx.fillPath();

    this.bellGfx.fillStyle(0xd4a843, 1);
    this.traceBellBody(x, y, bodyR, 0.78, 0.61, 0.72, 0.60);
    this.bellGfx.fillPath();

    this.bellGfx.fillStyle(0xf2d47a, 0.68);
    this.bellGfx.fillEllipse(x - bodyR * 0.28, y - bodyR * 0.25, bodyR * 0.42, bodyR * 0.34);
    this.bellGfx.fillStyle(0xb87922, 0.55);
    this.bellGfx.fillEllipse(x + bodyR * 0.36, y + bodyR * 0.08, bodyR * 0.34, bodyR * 0.88);

    this.bellGfx.lineStyle(lineW, 0x6e3f10, 0.96);
    this.traceBellBody(x, y, bodyR, 0.96, 0.76, 0.90, 0.78);
    this.bellGfx.strokePath();

    this.bellGfx.lineStyle(Math.max(3, bodyR * 0.045), 0x5a3410, 0.86);
    this.bellGfx.lineBetween(x - bodyR * 0.78, y + bodyR * 0.44, x + bodyR * 0.78, y + bodyR * 0.44);
    this.bellGfx.lineBetween(x - bodyR * 0.63, y + bodyR * 0.14, x + bodyR * 0.63, y + bodyR * 0.14);

    this.bellGfx.fillStyle(0x5a3410, 1);
    this.bellGfx.fillRoundedRect(x - bodyR * 0.22, y - bodyR * 0.98, bodyR * 0.44, bodyR * 0.23, bodyR * 0.08);
    this.bellGfx.fillStyle(0x3c230c, 1);
    this.bellGfx.fillCircle(x, y + bodyR * 0.18, bodyR * 0.11);
    this.bellGfx.lineStyle(Math.max(2, bodyR * 0.03), 0xf2d47a, 0.70);
    this.bellGfx.strokeCircle(x, y + bodyR * 0.18, bodyR * 0.20);
  }

  private traceBellBody(
    x: number,
    y: number,
    r: number,
    bottomHalfW: number,
    topHalfW: number,
    bottomArcH: number,
    topArcH: number,
  ): void {
    const topY = y - r * 0.38;
    const bottomY = y + r * 0.58;
    const arcSegments = 14;

    this.bellGfx.beginPath();
    this.bellGfx.moveTo(x - r * topHalfW, topY);
    this.bellGfx.lineTo(x - r * bottomHalfW, bottomY);

    for (let i = 1; i <= arcSegments; i++) {
      const t = i / arcSegments;
      const px = x - r * bottomHalfW + r * bottomHalfW * 2 * t;
      const py = bottomY + Math.sin(t * Math.PI) * r * (bottomArcH - 0.58);
      this.bellGfx.lineTo(px, py);
    }

    this.bellGfx.lineTo(x + r * topHalfW, topY);

    for (let i = 1; i <= arcSegments; i++) {
      const t = i / arcSegments;
      const px = x + r * topHalfW - r * topHalfW * 2 * t;
      const py = topY - Math.sin(t * Math.PI) * r * (topArcH - 0.38);
      this.bellGfx.lineTo(px, py);
    }

    this.bellGfx.closePath();
  }

  private popScore(x: number, y: number, label: string, color: string): void {
    const text = this.add.text(x, y, label, {
      fontSize: '22px', color, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_FX);

    this.tweens.add({
      targets: text,
      y: y - 52,
      alpha: 0,
      duration: 720,
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

    const title = this.add.text(0, -panelH / 2 + 42, 'BELL CLASH', {
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
    for (const zone of this.overlayHitZones) zone.destroy();
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
    if (isBallMoving(this.ball)) {
      this.ball.vx *= velocityScale;
      this.ball.vy *= velocityScale;
    }

    this.drawBackground();
    this.drawZones();
    this.drawBell();
    drawShellBall(this.ballGfx, this.ball);

    this.hudObjects.forEach((object) => object.destroy());
    this.hudObjects = buildReturnButton(this);
    this.scoreText?.setPosition(16, 16);
    this.lastHitText?.setPosition(16, 44);
    this.shotText?.setPosition(this.scale.width / 2, 16);
    if (this.overlay) {
      this.overlay.destroy(true);
      this.showEndScreen();
    }
  }
}
