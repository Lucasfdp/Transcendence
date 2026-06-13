import Phaser from 'phaser';
import { drawArena01, arenaPixels } from './arenas/arena01';
import { THEME } from '../hub/theme';

// ── Physics constants ──────────────────────────────────────────────────────────
const BALL_R_FRAC   = 0.022;   // ball radius as fraction of min(canvas w, h)
const MAX_DRAG_FRAC = 0.20;    // max slingshot pull as fraction of min(canvas w, h)
const LAUNCH_SPEED  = 1100;    // px/s at full drag
const FRICTION_BASE = 0.985;   // per-frame multiplier at 60 fps (frame-rate compensated)
const BOUNCE_DAMP   = 0.80;    // speed loss per ellipse-wall bounce
const MIN_SPEED     = 6;       // px/s — ball stops below this

export class ArenaScene extends Phaser.Scene {
  private arenaGfx!: Phaser.GameObjects.Graphics;
  private ballGfx!:  Phaser.GameObjects.Graphics;
  private aimGfx!:   Phaser.GameObjects.Graphics;

  private ball      = { x: 0, y: 0, vx: 0, vy: 0 };
  private origin    = { x: 0, y: 0 };
  private dragPt    = { x: 0, y: 0 };
  private dragging  = false;

  private ballR   = 20;
  private maxDrag = 180;

  constructor() { super({ key: 'ArenaScene' }); }

  create(): void {
    this.recalcSizes();
    this.resetBall();

    this.arenaGfx = this.add.graphics().setDepth(0);
    this.aimGfx   = this.add.graphics().setDepth(1);
    this.ballGfx  = this.add.graphics().setDepth(2);

    this.drawBackground();
    this.drawBall();
    this.buildReturnButton();

    this.input.on('pointerdown', this.onDown,   this);
    this.input.on('pointermove', this.onMove,   this);
    this.input.on('pointerup',   this.onUp,     this);
    this.scale.on('resize',      this.onResize, this);
  }

  shutdown(): void {
    this.scale.off('resize', this.onResize, this);
  }

  // ── Sizes ──────────────────────────────────────────────────────────────────

  private recalcSizes(): void {
    const m  = Math.min(this.scale.width, this.scale.height);
    this.ballR   = m * BALL_R_FRAC;
    this.maxDrag = m * MAX_DRAG_FRAC;
  }

  private resetBall(): void {
    this.ball = { x: this.scale.width / 2, y: this.scale.height / 2, vx: 0, vy: 0 };
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  private drawBackground(): void {
    const { width, height } = this.scale;
    this.arenaGfx.clear();

    // Bamboo-forest backdrop
    this.arenaGfx.fillStyle(0x0a1208, 1);
    this.arenaGfx.fillRect(0, 0, width, height);

    // Faint tatami grid
    const step = Math.round(Math.min(width, height) * 0.065);
    this.arenaGfx.lineStyle(1, 0x152410, 0.55);
    for (let x = 0; x < width;  x += step) this.arenaGfx.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += step) this.arenaGfx.lineBetween(0, y, width, y);

    drawArena01(this.arenaGfx, width, height);
  }

  private drawBall(): void {
    const { x, y } = this.ball;
    const r = this.ballR;
    this.ballGfx.clear();

    // Drop shadow
    this.ballGfx.fillStyle(0x000000, 0.22);
    this.ballGfx.fillEllipse(x + r * 0.3, y + r * 0.5, r * 2.4, r * 0.9);

    // Shell body
    this.ballGfx.fillStyle(0x2a7fd4, 1);
    this.ballGfx.fillCircle(x, y, r);

    // Dark shell-plate segments
    this.ballGfx.fillStyle(0x1a5fa8, 1);
    this.ballGfx.fillCircle(x + r * 0.25, y - r * 0.12, r * 0.38);
    this.ballGfx.fillCircle(x - r * 0.22, y + r * 0.28, r * 0.30);
    this.ballGfx.fillCircle(x + r * 0.08, y + r * 0.52, r * 0.22);

    // Specular highlight
    this.ballGfx.fillStyle(0xffffff, 0.55);
    this.ballGfx.fillCircle(x - r * 0.28, y - r * 0.30, r * 0.22);
  }

  private drawAim(): void {
    this.aimGfx.clear();
    if (!this.dragging) return;

    const ox    = this.origin.x;
    const oy    = this.origin.y;
    const dx    = this.dragPt.x - ox;
    const dy    = this.dragPt.y - oy;
    const len   = Math.sqrt(dx * dx + dy * dy);
    if (len < 2) return;

    const power = len / this.maxDrag;  // 0..1

    // Rubber band: ball origin → drag point (gold)
    this.aimGfx.lineStyle(3, THEME.gold, 0.85);
    this.aimGfx.lineBetween(ox, oy, this.dragPt.x, this.dragPt.y);

    // Launch-direction preview (dashed, fades with distance)
    const lx = ox - dx;
    const ly = oy - dy;
    const segments = 7;
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 0.5) / segments;
      const alpha = (0.15 + power * 0.55) * (1 - t0);
      this.aimGfx.lineStyle(2, 0xffffff, alpha);
      this.aimGfx.lineBetween(
        ox + (lx - ox) * t0, oy + (ly - oy) * t0,
        ox + (lx - ox) * t1, oy + (ly - oy) * t1,
      );
    }

    // Power ring around ball (red tint at high power)
    const ringColour = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x44ff88),
      Phaser.Display.Color.ValueToColor(0xff4444),
      100, Math.round(power * 100),
    );
    const ringHex = Phaser.Display.Color.GetColor(ringColour.r, ringColour.g, ringColour.b);
    this.aimGfx.lineStyle(2, ringHex, 0.75);
    this.aimGfx.strokeCircle(ox, oy, this.ballR * 1.6);
  }

  // ── Return button (built once; depth keeps it above everything) ────────────

  private buildReturnButton(): void {
    const PAD = 14;
    const BW  = 172;
    const BH  = 44;
    const bx  = this.scale.width - PAD - BW;
    const by  = PAD;

    const g = this.add.graphics().setDepth(20);
    g.fillStyle(0x0a1208, 0.92);
    g.fillRoundedRect(bx, by, BW, BH, 8);
    g.lineStyle(1.5, THEME.gold, 0.8);
    g.strokeRoundedRect(bx, by, BW, BH, 8);

    this.add.text(bx + BW / 2, by + BH / 2, '← Return to Hub', {
      fontSize: '15px',
      color: THEME.textGold,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(21);

    this.add
      .zone(bx + BW / 2, by + BH / 2, BW, BH)
      .setInteractive({ useHandCursor: true })
      .setDepth(22)
      .on('pointerup', () => this.scene.start('HubScene'));
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  private onDown(ptr: Phaser.Input.Pointer): void {
    if (Math.abs(this.ball.vx) > 0.1 || Math.abs(this.ball.vy) > 0.1) return;

    const dx = ptr.x - this.ball.x;
    const dy = ptr.y - this.ball.y;
    if (Math.sqrt(dx * dx + dy * dy) > this.ballR * 3.5) return;

    this.dragging  = true;
    this.origin.x  = this.ball.x;
    this.origin.y  = this.ball.y;
    this.dragPt.x  = ptr.x;
    this.dragPt.y  = ptr.y;
  }

  private onMove(ptr: Phaser.Input.Pointer): void {
    if (!this.dragging) return;

    let dx = ptr.x - this.origin.x;
    let dy = ptr.y - this.origin.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > this.maxDrag) { dx = (dx / len) * this.maxDrag; dy = (dy / len) * this.maxDrag; }

    this.dragPt.x = this.origin.x + dx;
    this.dragPt.y = this.origin.y + dy;
    this.drawAim();
  }

  private onUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.aimGfx.clear();

    const dx  = this.dragPt.x - this.origin.x;
    const dy  = this.dragPt.y - this.origin.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) return;

    const power  = len / this.maxDrag;
    this.ball.vx = -(dx / len) * power * LAUNCH_SPEED;
    this.ball.vy = -(dy / len) * power * LAUNCH_SPEED;
  }

  // ── Update loop ────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    if (Math.abs(this.ball.vx) < 0.1 && Math.abs(this.ball.vy) < 0.1) return;

    const dt = delta / 1000;
    const { width, height } = this.scale;
    const { cx, cy, rx, ry } = arenaPixels(width, height);

    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;

    // Ellipse boundary: (x-cx)²/rx² + (y-cy)²/ry² >= 1 → outside
    const ex = (this.ball.x - cx) / rx;
    const ey = (this.ball.y - cy) / ry;
    const distSq = ex * ex + ey * ey;

    if (distSq >= 1) {
      // Project ball back onto ellipse surface
      const inv = 1 / Math.sqrt(distSq);
      this.ball.x = cx + (this.ball.x - cx) * inv;
      this.ball.y = cy + (this.ball.y - cy) * inv;

      // Outward unit normal = normalised gradient of ((x-cx)/rx)² + ((y-cy)/ry)²
      const nRawX = (this.ball.x - cx) / (rx * rx);
      const nRawY = (this.ball.y - cy) / (ry * ry);
      const nLen  = Math.sqrt(nRawX * nRawX + nRawY * nRawY);
      const nx    = nRawX / nLen;
      const ny    = nRawY / nLen;

      // Reflect velocity then dampen
      const dot    = this.ball.vx * nx + this.ball.vy * ny;
      this.ball.vx = (this.ball.vx - 2 * dot * nx) * BOUNCE_DAMP;
      this.ball.vy = (this.ball.vy - 2 * dot * ny) * BOUNCE_DAMP;
    }

    // Frame-rate-independent friction
    const f = Math.pow(FRICTION_BASE, delta / 16.67);
    this.ball.vx *= f;
    this.ball.vy *= f;

    const speed = Math.sqrt(this.ball.vx * this.ball.vx + this.ball.vy * this.ball.vy);
    if (speed < MIN_SPEED) { this.ball.vx = 0; this.ball.vy = 0; }

    this.drawBall();
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  private onResize(): void {
    this.recalcSizes();
    this.drawBackground();
    this.drawBall();
  }
}
