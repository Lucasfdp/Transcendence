/**
 * HubScene.ts — Shell Smash Dojo Hub
 *
 * ┌─ HOW TO TUNE HOTSPOT POSITIONS ──────────────────────────────────────────┐
 * │  Each entry in HOTSPOTS uses:                                            │
 * │   cx / cy  — zone centre as a 0–1 fraction of the SOURCE image (1080²)  │
 * │   hw / hh  — half-width / half-height as 0–1 fractions of the source    │
 * │  Run the game, hover each zone and watch the gold outline — adjust       │
 * │  until it sits squarely on the building label. Values are auto-scaled    │
 * │  to any canvas size via the letterbox transform.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Background image is optional:
 *   srcs/requirements/frontend/src/public/assets/hub-background.png
 *   If the file is missing or fails to load, the procedural Japanese night
 *   sky renders instead — the game is always fully playable either way.
 *
 * ── Resize support ────────────────────────────────────────────────────────────
 * Phaser is configured with Scale.RESIZE (see main.ts), so this.scale.width /
 * height track the live canvas size and a 'resize' event fires on every change.
 * handleResize() is debounced at RESIZE_DEBOUNCE_MS ms, then applyResize() does
 * a full teardown + redraw of every re-drawable layer:
 *
 *   bgLayer      — procedural sky, moon, trees, mist, path, petals
 *   hotspotLayer — zone rectangles + optional no-bg labels
 *   hudLayer     — HUD bar, avatar, XP, name text, profile hit zone
 *   promptLayer  — login title text + Torii button (unauthenticated path)
 *   lbLayer      — leaderboard panel (async, generation-guarded)
 *
 * Stable objects that are NOT in any layer (repositioned, not recreated):
 *   bgImage       — hub-background.png overlay (setPosition + setScale)
 *   glowGfx       — hotspot hover glow (auto-redrawn per hover event)
 *   profilePanel  — Container; position clamped to viewport on resize
 *   modal         — dismissed + re-opened at new centre coords
 *
 * The listener is removed in shutdown() (called on scene stop/transition) and
 * the in-flight debounce timer is cancelled at the same time, preventing leaks
 * across HMR hot-reloads (the game itself is destroyed by main.ts's
 * import.meta.hot.dispose handler before a new module evaluation begins).
 */

import Phaser from 'phaser';
import { api, MiniGameDefinition } from './api';
import { THEME } from './theme';
import { ProfilePanel } from './ProfilePanel';

const HUB_BG = '/assets/hub-background.png';

// ── Source image reference dimensions ─────────────────────────────────────────
const SRC_W = 1080;
const SRC_H = 1080;

// ── Explicit depth constants (z-order preserved across resize redraws) ─────────
const DEPTH_BG    =   0;   // procedural background graphics
const DEPTH_IMAGE =   1;   // hub-bg photo overlay
const DEPTH_HS    =   5;   // hotspot zone labels (above bg, below glow)
const DEPTH_GLOW  =  10;   // hotspot hover glow
const DEPTH_HUD   =  20;   // HUD bar + leaderboard
const DEPTH_MODAL = 200;   // modal overlay (above profile panel at 100)

// ── Resize debounce ────────────────────────────────────────────────────────────
const RESIZE_DEBOUNCE_MS = 100;

// ── Shrine hotspot definitions ─────────────────────────────────────────────────
interface HotspotDef {
  id: string;
  name: string;
  cx: number;  // centre-x as fraction of SRC_W
  cy: number;  // centre-y as fraction of SRC_H
  hw: number;  // half-width  as fraction of SRC_W
  hh: number;  // half-height as fraction of SRC_H
}

const HOTSPOTS: HotspotDef[] = [
  { id: 'shell-smash-arena', name: 'Shell Smash Arena', cx: 0.491, cy: 0.148, hw: 0.095, hh: 0.054 },
  { id: 'river-rush',        name: 'River Rush',        cx: 0.155, cy: 0.292, hw: 0.095, hh: 0.044 },
  { id: 'bamboo-bash',       name: 'Bamboo Bash',       cx: 0.838, cy: 0.284, hw: 0.095, hh: 0.044 },
  { id: 'oni-dodge',         name: 'Oni Dodge',         cx: 0.148, cy: 0.534, hw: 0.095, hh: 0.042 },
  { id: 'sakura-sweep',      name: 'Sakura Sweep',      cx: 0.851, cy: 0.536, hw: 0.095, hh: 0.042 },
  { id: 'bell-clash',        name: 'Bell Clash',        cx: 0.273, cy: 0.708, hw: 0.132, hh: 0.060 },
  { id: 'shell-cards',       name: 'Shell Cards',       cx: 0.718, cy: 0.720, hw: 0.144, hh: 0.053 },
];

// Cherry blossom petal colours (rotated randomly per petal)
const PETAL_COLOURS = [0xFFB7C5, 0xFFC8D3, 0xFFD9E2, 0xFF8FAD, 0xFFE4EC, 0xffffff];

// ─────────────────────────────────────────────────────────────────────────────

export class HubScene extends Phaser.Scene {
  private user: any            = null;
  private minigames: MiniGameDefinition[] = [];
  private modal: Phaser.GameObjects.Container | null = null;
  private glowGfx!: Phaser.GameObjects.Graphics;

  // Set true when the background image loads — skip the procedural bg if so
  private bgImageLoaded = false;

  // Stable background image — repositioned (not recreated) on resize
  private bgImage: Phaser.GameObjects.Image | null = null;

  // Continuously running petal emitter — one at a time, replaced on each hover
  private activeEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  // Profile overlay
  private profilePanel: ProfilePanel | null = null;

  // Letterbox transform
  private bgOffX  = 0;
  private bgOffY  = 0;
  private bgScale = 1;

  // ── Drawable layers (destroyed + redrawn on resize) ──────────────────────────
  private bgLayer:      Phaser.GameObjects.GameObject[] = [];
  private hudLayer:     Phaser.GameObjects.GameObject[] = [];
  private promptLayer:  Phaser.GameObjects.GameObject[] = [];
  private hotspotLayer: Phaser.GameObjects.GameObject[] = [];
  private lbLayer:      Phaser.GameObjects.GameObject[] = [];

  // ── Resize debounce ───────────────────────────────────────────────────────────
  private resizeTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  // ── Modal state — stored so the modal can be recentred on resize ──────────────
  private modalTitle: string | null = null;
  private modalDesc:  string        = '';

  // ── Leaderboard async generation guard ────────────────────────────────────────
  // Incremented on every renderLeaderboard() call; the async callback bails out
  // if its captured generation no longer matches the current one.
  private lbGeneration = 0;

  constructor() { super({ key: 'HubScene' }); }

  shutdown(): void {
    // Cancel any pending debounce and remove the resize listener so it cannot
    // fire after the scene has been torn down (important for HMR hot-reloads).
    if (this.resizeTimer !== null) {
      globalThis.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.scale.off('resize', this.handleResize, this);

    this.profilePanel?.destroy();
    this.profilePanel = null;
  }

  // ── preload ──────────────────────────────────────────────────────────────────

  preload(): void {
    // Attempt to load background art (gracefully degraded if missing)
    this.load.image('hub-bg', HUB_BG);
    this.load.on('filecomplete-image-hub-bg', () => { this.bgImageLoaded = true; });

    // Generate a petal texture programmatically — no asset file required
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xFFB7C5, 1);
    g.fillEllipse(10, 6, 20, 12);   // outer petal shape
    g.fillStyle(0xFFE4EC, 0.75);
    g.fillEllipse(10, 5,  12,  7);  // lighter centre highlight
    g.generateTexture('petal', 20, 12);
    g.destroy();
  }

  // ── create ───────────────────────────────────────────────────────────────────

  async create(): Promise<void> {
    const { width, height } = this.scale;

    // Letterbox: fit image inside canvas, preserve aspect ratio
    const sx = width  / SRC_W;
    const sy = height / SRC_H;
    this.bgScale = Math.min(sx, sy);
    this.bgOffX  = (width  - SRC_W * this.bgScale) / 2;
    this.bgOffY  = (height - SRC_H * this.bgScale) / 2;

    // Always draw the procedural background first
    this.drawBackground();

    // If the art loaded, overlay it on top of the procedural scene
    if (this.bgImageLoaded) {
      const bgCX = this.bgOffX + (SRC_W * this.bgScale) / 2;
      const bgCY = this.bgOffY + (SRC_H * this.bgScale) / 2;
      this.bgImage = this.add
        .image(bgCX, bgCY, 'hub-bg')
        .setScale(this.bgScale)
        .setDepth(DEPTH_IMAGE);
    }

    // Glow graphics layer — stable object, sits above bg, below HUD
    this.glowGfx = this.add.graphics().setDepth(DEPTH_GLOW);

    // Fetch API data
    try { this.minigames = await api.getMiniGames(); } catch { this.minigames = []; }
    try { this.user      = await api.getMe();        } catch { this.user = null; }

    this.buildHotspots();

    if (this.user) {
      this.drawHUD();
    } else {
      this.drawLoginPrompt();
    }

    // Register resize listener after the initial layout is complete so an
    // immediate resize event (fired synchronously by some browsers on creation)
    // doesn't run applyResize() before create() has finished.
    this.scale.on('resize', this.handleResize, this);
  }

  // ── Resize handler ────────────────────────────────────────────────────────────

  private handleResize(): void {
    if (this.resizeTimer !== null) globalThis.clearTimeout(this.resizeTimer);
    this.resizeTimer = globalThis.setTimeout(() => {
      this.resizeTimer = null;
      this.applyResize();
    }, RESIZE_DEBOUNCE_MS);
  }

  private applyResize(): void {
    const { width, height } = this.scale;

    // 1. Recalculate letterbox transform
    const sx = width  / SRC_W;
    const sy = height / SRC_H;
    this.bgScale = Math.min(sx, sy);
    this.bgOffX  = (width  - SRC_W * this.bgScale) / 2;
    this.bgOffY  = (height - SRC_H * this.bgScale) / 2;

    // 2. Reposition stable background image (no recreate — avoids texture reload)
    if (this.bgImage?.active) {
      const bgCX = this.bgOffX + (SRC_W * this.bgScale) / 2;
      const bgCY = this.bgOffY + (SRC_H * this.bgScale) / 2;
      this.bgImage.setPosition(bgCX, bgCY).setScale(this.bgScale);
    }

    // 3. Redraw procedural background at new dimensions
    this.clearLayer(this.bgLayer);
    this.drawBackground();

    // 4. glowGfx is stable — clear it so a stale highlight isn't left over
    this.glowGfx.clear();

    // 5. Rebuild hotspot zones with recalculated hit areas
    this.clearLayer(this.hotspotLayer);
    this.buildHotspots();

    // 6. Redraw the authenticated HUD or the unauthenticated login prompt
    if (this.user) {
      this.clearLayer(this.hudLayer);
      this.drawHUD();
      // renderLeaderboard() clears lbLayer internally and re-fetches
    } else {
      this.clearLayer(this.promptLayer);
      this.drawLoginPrompt();
    }

    // 7. Recentre any open modal at the new screen centre
    if (this.modal && this.modalTitle !== null) {
      const title = this.modalTitle;
      const desc  = this.modalDesc;
      this.dismissModal();
      this.showModal(title, desc);
    }

    // 8. Clamp the ProfilePanel so it doesn't overflow on narrow viewports
    if (this.profilePanel) {
      const BAR_H    = 56;
      const PAD      = 16;
      const PW       = 320;   // ProfilePanel fixed width
      const clampedX = Math.max(0, Math.min(PAD, width - PW - 4));
      this.profilePanel.setPosition(clampedX, BAR_H + 8);
    }
  }

  /**
   * Return a CSS font-size string scaled to the current canvas size.
   *
   * bgScale = Math.min(width, height) / SRC (1080), so the value is 1.0 at a
   * 1080-unit viewport, 0.5 when the user has zoomed to 200 %, and 2.0 on a
   * 2160p display.  Multiplying every hardcoded px value by bgScale keeps text
   * proportional to the letterboxed image and to the viewport at all times.
   *
   * minPx prevents text from becoming unreadably tiny on extreme viewports.
   *
   * The scale is capped at 1.0 so UI chrome never grows *larger* than the
   * original design sizes on displays wider/taller than 1080 px.  Scaling
   * only goes downward (for small viewports / high browser zoom levels).
   */
  private scaledFont(basePx: number, minPx = 7): string {
    const s = Math.min(this.bgScale, 1.0);
    return `${Math.max(minPx, Math.round(basePx * s))}px`;
  }

  /** Destroy every object in a layer array and empty it. */
  private clearLayer(layer: Phaser.GameObjects.GameObject[]): void {
    for (const obj of layer) {
      if (obj?.active) obj.destroy();
    }
    layer.length = 0;
  }

  // ── Procedural Japanese night-sky background ──────────────────────────────────

  private drawBackground(): void {
    const { width, height } = this.scale;

    // Helper: register objects in bgLayer so they can be cleared on resize
    const track = (...objs: Phaser.GameObjects.GameObject[]): void => {
      this.bgLayer.push(...objs);
    };

    // ── Sky gradient (three bands) ──────────────────────────────────────────────
    const gfx = this.add.graphics().setDepth(DEPTH_BG);
    track(gfx);
    // Top: deep midnight navy
    gfx.fillGradientStyle(0x080620, 0x080620, 0x14083A, 0x14083A, 1);
    gfx.fillRect(0, 0, width, height * 0.55);
    // Mid: deep indigo → mauve
    gfx.fillGradientStyle(0x14083A, 0x14083A, 0x2A1050, 0x2A1050, 1);
    gfx.fillRect(0, height * 0.35, width, height * 0.30);
    // Ground area: dark earthen
    gfx.fillGradientStyle(0x100C06, 0x100C06, 0x080604, 0x080604, 1);
    gfx.fillRect(0, height * 0.62, width, height * 0.38);

    // ── Stars ───────────────────────────────────────────────────────────────────
    const starCount = Math.floor((width * height) / 6000);
    for (let i = 0; i < starCount; i++) {
      const sx = Phaser.Math.Between(0, width);
      const sy = Phaser.Math.Between(0, height * 0.58);
      const sr = Phaser.Math.FloatBetween(0.4, 1.4);
      const sa = Phaser.Math.FloatBetween(0.3, 0.9);
      gfx.fillStyle(0xffffff, sa);
      gfx.fillCircle(sx, sy, sr);
    }

    // ── Moon ────────────────────────────────────────────────────────────────────
    const moonX = width * 0.74;
    const moonY = height * 0.18;
    const moonR = Math.min(width, height) * 0.075;
    // Outer glow rings
    gfx.fillStyle(0xFFF5D6, 0.04); gfx.fillCircle(moonX, moonY, moonR * 2.8);
    gfx.fillStyle(0xFFF5D6, 0.07); gfx.fillCircle(moonX, moonY, moonR * 1.9);
    gfx.fillStyle(0xFFF5D6, 0.13); gfx.fillCircle(moonX, moonY, moonR * 1.35);
    // Moon face
    gfx.fillStyle(0xFFF5D6, 0.96); gfx.fillCircle(moonX, moonY, moonR);

    // ── Mist / fog at ground level ───────────────────────────────────────────────
    const mistGfx = this.add.graphics().setDepth(DEPTH_BG);
    track(mistGfx);
    mistGfx.fillGradientStyle(0x1A0D3A, 0x1A0D3A, 0x1A0D3A, 0x1A0D3A, 0, 0, 0.28, 0.28);
    mistGfx.fillRect(0, height * 0.60, width, height * 0.12);

    // ── Stone path (centre lane) ─────────────────────────────────────────────────
    const pathGfx = this.add.graphics().setDepth(DEPTH_BG);
    track(pathGfx);
    const pathW = width * 0.22;
    pathGfx.fillStyle(0x1E1A12, 0.85);
    pathGfx.fillRect(width / 2 - pathW / 2, height * 0.68, pathW, height * 0.32);
    // Stone joint lines
    pathGfx.lineStyle(1, 0x0A0806, 0.5);
    for (let row = 0; row < 6; row++) {
      const py = height * 0.68 + row * (height * 0.06);
      pathGfx.lineBetween(width / 2 - pathW / 2, py, width / 2 + pathW / 2, py);
    }
    pathGfx.lineBetween(width / 2, height * 0.68, width / 2, height);

    // ── Cherry blossom trees (left + right) ──────────────────────────────────────
    // Guard: only draw a tree if its trunk x falls within the letterboxed image
    // area.  At very wide aspect ratios the image is inset by bgOffX and trees
    // positioned at width*0.06 / 0.94 would land in the black letterbox bars.
    const imgLeft  = this.bgOffX;
    const imgRight = this.bgOffX + SRC_W * this.bgScale;
    const leftTreeX  = width * 0.06;
    const rightTreeX = width * 0.94;

    if (leftTreeX >= imgLeft) {
      this.drawBlossamTree(leftTreeX,  height * 0.72, height * 0.38, true);
    }
    if (rightTreeX <= imgRight) {
      this.drawBlossamTree(rightTreeX, height * 0.72, height * 0.38, false);
    }

    // ── Ambient floating petals (static scene decoration) ────────────────────────
    const petalGfx = this.add.graphics().setDepth(DEPTH_BG);
    track(petalGfx);
    for (let i = 0; i < 28; i++) {
      const px = Phaser.Math.Between(0, width);
      const py = Phaser.Math.Between(height * 0.15, height * 0.85);
      const pw = Phaser.Math.Between(5, 11);
      const ph = Phaser.Math.Between(3, 7);
      const pc = Phaser.Math.RND.pick(PETAL_COLOURS);
      const pa = Phaser.Math.FloatBetween(0.2, 0.55);
      petalGfx.fillStyle(pc, pa);
      petalGfx.fillEllipse(px, py, pw, ph);
    }
  }

  /** Draw a simple cherry blossom tree silhouette. Pushes graphics into bgLayer. */
  private drawBlossamTree(x: number, baseY: number, height: number, leansRight: boolean): void {
    const lean  = leansRight ? 1 : -1;
    const tGfx  = this.add.graphics().setDepth(DEPTH_BG);
    const bGfx  = this.add.graphics().setDepth(DEPTH_BG); // blossoms above trunk
    this.bgLayer.push(tGfx, bGfx);

    // Trunk
    tGfx.lineStyle(5, 0x0D0800, 0.95);
    tGfx.lineBetween(x, baseY, x + lean * 20, baseY - height * 0.45);
    tGfx.lineStyle(3.5, 0x0D0800, 0.95);
    tGfx.lineBetween(x + lean * 20, baseY - height * 0.45, x + lean * 35, baseY - height * 0.75);

    // Main branches
    const branchData = [
      { sx: 0.40, ex: 0.70, dx: lean * 70 },
      { sx: 0.45, ex: 0.65, dx: lean * -40 },
      { sx: 0.65, ex: 0.88, dx: lean * 55 },
      { sx: 0.70, ex: 0.85, dx: lean * -30 },
      { sx: 0.80, ex: 1.00, dx: lean * 40 },
    ];
    branchData.forEach(({ sx, ex, dx }) => {
      const startX = x + lean * Phaser.Math.Linear(0, 40, sx);
      const startY = baseY - height * sx;
      const endX   = startX + dx;
      const endY   = baseY - height * ex;
      tGfx.lineStyle(2, 0x0D0800, 0.85);
      tGfx.lineBetween(startX, startY, endX, endY);

      // Blossom clusters at branch tips
      const clusterCount = Phaser.Math.Between(3, 7);
      for (let i = 0; i < clusterCount; i++) {
        const bx = endX + Phaser.Math.Between(-18, 18);
        const by = endY + Phaser.Math.Between(-10, 10);
        const colour = Phaser.Math.RND.pick(PETAL_COLOURS);
        bGfx.fillStyle(colour, Phaser.Math.FloatBetween(0.55, 0.85));
        bGfx.fillCircle(bx, by, Phaser.Math.Between(4, 9));
      }
    });
  }

  // ── Coordinate helper ────────────────────────────────────────────────────────

  private toScreen(hs: HotspotDef) {
    const bw = SRC_W * this.bgScale;
    const bh = SRC_H * this.bgScale;
    const hw = hs.hw * bw;
    const hh = hs.hh * bh;
    const cx = this.bgOffX + hs.cx * bw;
    const cy = this.bgOffY + hs.cy * bh;
    return { x: cx - hw, y: cy - hh, w: hw * 2, h: hh * 2, cx, cy };
  }

  // ── Hotspots ─────────────────────────────────────────────────────────────────

  private buildHotspots(): void {
    HOTSPOTS.forEach((hs) => {
      const minigame  = this.minigames.find((m) => m.id === hs.id);
      const available = minigame?.status === 'available';
      const r         = this.toScreen(hs);

      // Visible label (helps when no background image is loaded)
      if (!this.bgImageLoaded) {
        const labelBg = this.add.graphics().setDepth(DEPTH_HS);
        labelBg.fillStyle(0x1a1208, 0.65);
        labelBg.fillRoundedRect(r.x, r.y, r.w, r.h, 4);
        labelBg.lineStyle(1, available ? THEME.gold : 0x555555, 0.45);
        labelBg.strokeRoundedRect(r.x, r.y, r.w, r.h, 4);
        this.hotspotLayer.push(labelBg);

        // Shorten "Shell Smash Arena" → "Arena"; put every word on its own line
        const rawName  = hs.id === 'shell-smash-arena' ? 'Arena' : hs.name;
        const labelText = this.add.text(r.cx, r.cy, rawName.split(' ').join('\n'), {
          fontSize: this.scaledFont(24),
          color: available ? THEME.textGold : '#888888',
          fontFamily: THEME.font,
          fontStyle: 'bold',
          align: 'center',
          lineSpacing: 2,
        }).setOrigin(0.5).setDepth(DEPTH_HS);
        this.hotspotLayer.push(labelText);
      }

      // Invisible interactive zone
      const zone = this.add
        .zone(r.cx, r.cy, r.w, r.h)
        .setInteractive({ useHandCursor: true })
        .setDepth(DEPTH_HS);
      this.hotspotLayer.push(zone);

      // Hover in: gold glow + continuous cherry blossom fall
      zone.on('pointerover', () => {
        this.glowGfx.clear();
        if (available) {
          this.glowGfx.fillStyle(THEME.gold, 0.18);
          this.glowGfx.fillRect(r.x, r.y, r.w, r.h);
          this.glowGfx.lineStyle(2.5, THEME.gold, 0.90);
          this.glowGfx.strokeRect(r.x, r.y, r.w, r.h);
          this.glowGfx.fillStyle(0xffffff, 0.05);
          this.glowGfx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
        } else {
          this.glowGfx.fillStyle(0xffffff, 0.07);
          this.glowGfx.fillRect(r.x, r.y, r.w, r.h);
          this.glowGfx.lineStyle(1.5, 0xaaaaaa, 0.55);
          this.glowGfx.strokeRect(r.x, r.y, r.w, r.h);
        }
        this.startPetals(r.cx, r.cy, r.w, r.h);
      });

      // Hover out: clear glow + stop petals
      zone.on('pointerout', () => {
        this.glowGfx.clear();
        this.stopPetals();
      });

      // Click
      zone.on('pointerup', () => {
        if (available && this.scene.manager.getScene('ShellSmashArenaScene')) {
          this.scene.start('ShellSmashArenaScene');
        } else {
          const desc = available
            ? (minigame?.description ?? '') + '\n\n⚔️  Arena is being built — check back soon!'
            : (minigame?.description ?? '');
          this.showModal(hs.name, desc);
        }
      });
    });
  }

  // ── Cherry blossom continuous fall ──────────────────────────────────────────

  /**
   * Start a continuously falling petal shower over the hovered zone.
   * Any previously running emitter is gracefully stopped first.
   */
  private startPetals(cx: number, cy: number, zoneW: number, zoneH: number): void {
    this.stopPetals();

    // Spawn petals from the top half of the zone so they visibly fall through it
    this.activeEmitter = this.add.particles(cx, cy - zoneH * 0.3, 'petal', {
      x:        { min: -zoneW * 0.55, max: zoneW * 0.55 },
      y:        { min: -zoneH * 0.3,  max: 0 },
      angle:    { min: 75, max: 105 },    // mostly straight down, gentle spread
      speed:    { min: 30, max: 65 },
      gravityY: 18,                       // soft extra pull
      scale:    { start: 0.75, end: 0.2 },
      alpha:    { start: 0.88, end: 0 },
      rotate:   { start: 0, end: 480 },  // each petal tumbles as it falls
      tint:     PETAL_COLOURS,
      lifespan: { min: 1000, max: 1700 },
      frequency: 55,                      // new petal every ~55 ms
      quantity:  1,
      depth:     50,
    });
  }

  /**
   * Stop the current emitter: halt new particles but let existing ones finish.
   */
  private stopPetals(): void {
    if (!this.activeEmitter) return;
    const emitter = this.activeEmitter;
    this.activeEmitter = null;
    emitter.stop();   // no more new particles
    this.time.delayedCall(1800, () => {
      if (emitter?.active) emitter.destroy();
    });
  }

  // ── Coming Soon modal ────────────────────────────────────────────────────────

  private showModal(title: string, description: string): void {
    this.dismissModal();

    // Persist title/desc so applyResize() can reopen the modal at the new centre
    this.modalTitle = title;
    this.modalDesc  = description;

    const { width, height } = this.scale;
    const container = this.add.container(0, 0).setDepth(DEPTH_MODAL);
    this.modal = container;

    const panelW = Math.min(440, width * 0.85);
    const panelH = description ? 252 : 210;
    const px     = width  / 2;
    const py     = height / 2;

    const backdrop = this.add
      .rectangle(px, py, width, height, 0x000000, 0.72)
      .setInteractive();
    backdrop.on('pointerup', () => this.dismissModal());

    const panelGfx = this.add.graphics();
    panelGfx.fillStyle(THEME.background, 0.96);
    panelGfx.fillRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 10);
    panelGfx.lineStyle(2, THEME.gold, 1);
    panelGfx.strokeRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 10);
    panelGfx.lineStyle(1, THEME.gold, 0.22);
    panelGfx.strokeRoundedRect(px - panelW / 2 + 5, py - panelH / 2 + 5, panelW - 10, panelH - 10, 7);

    const icon = this.add.text(px, py - panelH / 2 + 38, '⛩', { fontSize: this.scaledFont(28) }).setOrigin(0.5);

    const nameText = this.add.text(px, py - panelH / 2 + 80, title.toUpperCase(), {
      fontSize: this.scaledFont(19), color: THEME.textGold,
      fontFamily: THEME.font, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5);

    const divider = this.add.graphics();
    divider.lineStyle(1, THEME.gold, 0.32);
    divider.lineBetween(
      px - panelW / 2 + 32, py - panelH / 2 + 104,
      px + panelW / 2 - 32, py - panelH / 2 + 104,
    );

    const soonText = this.add.text(px, py - panelH / 2 + 128, 'Coming Soon', {
      fontSize: this.scaledFont(15), color: THEME.text, fontFamily: THEME.font, fontStyle: 'italic',
    }).setOrigin(0.5);

    const children: Phaser.GameObjects.GameObject[] = [backdrop, panelGfx, icon, nameText, divider, soonText];

    if (description) {
      const descText = this.add.text(px, py - panelH / 2 + 162, description, {
        fontSize: this.scaledFont(12), color: THEME.textMutedHex,
        fontFamily: THEME.font, align: 'center',
        wordWrap: { width: panelW - 48 },
      }).setOrigin(0.5);
      children.push(descText);
    }

    const closeBtn = this.add.text(
      px + panelW / 2 - 18, py - panelH / 2 + 16, '✕',
      { fontSize: this.scaledFont(15), color: THEME.textMutedHex, fontFamily: THEME.font },
    ).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerup',   () => this.dismissModal());
    closeBtn.on('pointerover', () => closeBtn.setColor(THEME.text));
    closeBtn.on('pointerout',  () => closeBtn.setColor(THEME.textMutedHex));
    children.push(closeBtn);

    container.add(children);
    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 140, ease: 'Power2' });
  }

  private dismissModal(): void {
    this.modalTitle = null;
    this.modalDesc  = '';

    if (!this.modal) return;
    const target = this.modal;
    this.modal = null;
    this.tweens.add({
      targets: target, alpha: 0, duration: 100, ease: 'Power1',
      onComplete: () => target.destroy(),
    });
  }

  // ── HUD overlay ──────────────────────────────────────────────────────────────

  private drawHUD(): void {
    const { width } = this.scale;
    const PAD   = 16;
    const BAR_H = 56;

    // ── Bar background ────────────────────────────────────────────────────────
    const bar = this.add.graphics().setDepth(DEPTH_HUD);
    this.hudLayer.push(bar);
    bar.fillStyle(THEME.background, 0.80);
    bar.fillRect(0, 0, width, BAR_H);
    bar.lineStyle(1, THEME.gold, 0.35);
    bar.lineBetween(0, BAR_H, width, BAR_H);

    // Avatar ring + turtle silhouette
    bar.fillStyle(THEME.gold, 1);       bar.fillCircle(PAD + 20, BAR_H / 2, 20);
    bar.fillStyle(THEME.background, 1); bar.fillCircle(PAD + 20, BAR_H / 2, 17);
    bar.fillStyle(THEME.gold, 0.55);
    bar.fillCircle(PAD + 20, BAR_H / 2 - 4, 7);
    bar.fillEllipse(PAD + 20, BAR_H / 2 + 10, 14, 8);

    // XP bar track + fill (drawn on bar so it stays below text)
    const xpMax = this.user.level * 1000;
    const xpPct = Math.min(this.user.xp / xpMax, 1);
    const barX  = PAD + 48;
    const barY  = 43;
    const barW  = 130;
    bar.fillStyle(0x3a2e20, 1); bar.fillRect(barX, barY, barW, 5);
    bar.fillStyle(THEME.gold,  1); bar.fillRect(barX, barY, barW * xpPct, 5);

    // ── Hover glow layer (above bar, below text labels) ───────────────────────
    const PROFILE_HIT_W = 220;
    const hoverGfx = this.add.graphics().setDepth(DEPTH_HUD);
    this.hudLayer.push(hoverGfx);
    const paintHover = (on: boolean): void => {
      hoverGfx.clear();
      if (!on) return;
      // Pulsing ring around avatar
      hoverGfx.fillStyle(THEME.gold, 0.22);
      hoverGfx.fillCircle(PAD + 20, BAR_H / 2, 24);
      // Subtle wash over the whole clickable region
      hoverGfx.fillStyle(THEME.gold, 0.05);
      hoverGfx.fillRect(0, 0, PROFILE_HIT_W, BAR_H);
    };

    // ── Text labels (above hoverGfx so they stay crisp) ──────────────────────
    const displayName = this.user.turtleName ?? this.user.username;
    const nameLabel = this.add.text(PAD + 48, 8, displayName, {
      fontSize: this.scaledFont(15), color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setDepth(DEPTH_HUD);
    this.hudLayer.push(nameLabel);

    const levelLabel = this.add.text(PAD + 48, 27, `Lvl ${this.user.level}  ·  Shell: ${this.user.shellSkin ?? 'kanagawa'}`, {
      fontSize: this.scaledFont(11), color: THEME.text, fontFamily: THEME.font,
    }).setDepth(DEPTH_HUD);
    this.hudLayer.push(levelLabel);

    const xpLabel = this.add.text(barX + barW + 6, barY - 1, `${this.user.xp} / ${xpMax} XP`, {
      fontSize: this.scaledFont(9), color: THEME.textMutedHex, fontFamily: THEME.font,
    }).setDepth(DEPTH_HUD);
    this.hudLayer.push(xpLabel);

    this.renderLeaderboard();

    // ── Profile trigger — clicking the left avatar area opens the profile panel ─
    const profileHit = this.add
      .rectangle(PROFILE_HIT_W / 2, BAR_H / 2, PROFILE_HIT_W, BAR_H, 0x000000, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTH_HUD);
    this.hudLayer.push(profileHit);

    profileHit.on('pointerover', () => paintHover(true));
    profileHit.on('pointerout',  () => paintHover(false));
    profileHit.on('pointerup', () => {
      if (!this.profilePanel) {
        this.profilePanel = new ProfilePanel(this, this.user, PAD, BAR_H + 8);
      }
      this.profilePanel.toggle();
    });
  }

  // ── Login prompt ─────────────────────────────────────────────────────────────

  private drawLoginPrompt(): void {
    const { width, height } = this.scale;

    const vignette = this.add.graphics().setDepth(DEPTH_HUD);
    this.promptLayer.push(vignette);
    vignette.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.75, 0.75);
    vignette.fillRect(0, height * 0.55, width, height * 0.45);

    const titleText = this.add.text(width / 2, height * 0.67, 'SHELL SMASH', {
      fontSize: this.scaledFont(52), color: THEME.textGold,
      fontFamily: THEME.font, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: Math.max(1, Math.round(5 * Math.min(this.bgScale, 1.0))),
    }).setOrigin(0.5).setDepth(DEPTH_HUD);
    this.promptLayer.push(titleText);

    const subtitleText = this.add.text(width / 2, height * 0.67 + 56, 'Sumo Turtle Arena', {
      fontSize: this.scaledFont(18), color: THEME.text, fontFamily: THEME.font,
      stroke: '#000000', strokeThickness: Math.max(1, Math.round(3 * Math.min(this.bgScale, 1.0))),
    }).setOrigin(0.5).setDepth(DEPTH_HUD);
    this.promptLayer.push(subtitleText);

    // TODO(#001): swap devLogin() for loginUrl() redirect once 42 OAuth keys are set
    const btn = this.drawToriiButton(
      width / 2, height * 0.67 + 116, 240, 56,
      'Enter the Dojo',
      async () => {
        try {
          await api.devLogin('KameMaster');
          this.scene.restart();
        } catch (err) {
          console.error('[Enter Dojo] Dev login failed:', err);
        }
      },
    );
    // Track all three Torii-button objects so they're destroyed on resize
    this.promptLayer.push(btn.graphics, btn.hitArea, btn.text);
  }

  // ── Torii-gate button ────────────────────────────────────────────────────────

  private drawToriiButton(
    x: number, y: number, w: number, h: number,
    label: string, onClick: () => void,
  ): { graphics: Phaser.GameObjects.Graphics; hitArea: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text } {
    const g = this.add.graphics().setDepth(DEPTH_HUD);

    const paint = (hovered: boolean): void => {
      g.clear();
      g.fillStyle(hovered ? THEME.gold : THEME.red, 0.92);
      g.fillRect(x - w / 2, y - h / 2, w, h);
      g.fillStyle(hovered ? THEME.red : THEME.gold, 1);
      g.fillRect(x - w / 2 - 10, y - h / 2 - 8, w + 20, 8);
      g.fillRect(x - w / 2 - 6,  y - h / 2,      8,      h);
      g.fillRect(x + w / 2 - 2,  y - h / 2,      8,      h);
    };

    paint(false);

    const hitArea = this.add.rectangle(x, y, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTH_HUD) as Phaser.GameObjects.Rectangle;

    const text = this.add.text(x, y, label, {
      fontSize: this.scaledFont(18), color: '#ffffff',
      fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_HUD);

    hitArea.on('pointerup',   () => void onClick());
    hitArea.on('pointerover', () => {
      paint(true);
      text.setColor('#1a1410');
      this.startPetals(x, y, w, h);
    });
    hitArea.on('pointerout',  () => {
      paint(false);
      text.setColor('#ffffff');
      this.stopPetals();
    });

    return { graphics: g, hitArea, text };
  }

  // ── Leaderboard ──────────────────────────────────────────────────────────────

  private renderLeaderboard(): void {
    const PAD = 16;

    // Increment generation; the async callback captures this value and bails
    // out if a newer renderLeaderboard() call has superseded it.
    const gen = ++this.lbGeneration;

    // Clear any previously drawn leaderboard before fetching fresh data
    this.clearLayer(this.lbLayer);

    api.getAllUsers().then((users: any[]) => {
      if (gen !== this.lbGeneration) return; // superseded by a newer resize
      if (!users?.length) return;

      // Re-read dimensions here — they may have changed since the call was made
      const { width: w, height: h } = this.scale;

      const sorted  = [...users].sort((a, b) => b.xp - a.xp).slice(0, 5);
      const rowH    = 22;
      // Clamp panel width so it doesn't overflow at narrow viewports (< 500 px)
      const panelW  = Math.min(232, w * 0.45);
      const panelH  = 32 + sorted.length * rowH + 10;
      const panelX  = w - PAD;
      const panelY  = h - PAD - panelH;

      const bg = this.add.graphics().setDepth(DEPTH_HUD);
      this.lbLayer.push(bg);
      bg.fillStyle(THEME.background, 0.80);
      bg.fillRoundedRect(panelX - panelW, panelY, panelW, panelH, 8);
      bg.lineStyle(1, THEME.gold, 0.30);
      bg.strokeRoundedRect(panelX - panelW, panelY, panelW, panelH, 8);

      const header = this.add.text(panelX - panelW / 2, panelY + 10, 'DOJO RANKINGS', {
        fontSize: this.scaledFont(10), color: THEME.textGold,
        fontFamily: THEME.font, fontStyle: 'bold',
      }).setOrigin(0.5, 0).setDepth(DEPTH_HUD);
      this.lbLayer.push(header);

      sorted.forEach((u, i) => {
        const nameStr = (u.turtleName || u.username).substring(0, 14);
        const colour  = i === 0 ? THEME.textGold : THEME.text;
        const rowY    = panelY + 30 + i * rowH;

        const nameLabel = this.add.text(panelX - panelW + 12, rowY, `${i + 1}.  ${nameStr}`, {
          fontSize: this.scaledFont(11), color: colour, fontFamily: THEME.font,
        }).setDepth(DEPTH_HUD);
        const xpLabel = this.add.text(panelX - 12, rowY, `${u.xp} XP`, {
          fontSize: this.scaledFont(11), color: colour, fontFamily: THEME.font,
        }).setOrigin(1, 0).setDepth(DEPTH_HUD);
        this.lbLayer.push(nameLabel, xpLabel);
      });
    }).catch(() => { /* leaderboard is non-critical */ });
  }
}
