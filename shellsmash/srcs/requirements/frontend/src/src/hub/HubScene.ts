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
 *   hudLayer     — HUD bar, avatar, XP, name text, guest banner, DEV badge
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
import { Achievement, api, Cosmetic, MiniGameDefinition, User } from './api';
import { shellSkinAccentColor } from '../shared/cosmetics';
import { THEME } from '../shared/theme';
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
  { id: 'kame-knock',        name: 'Kame Knock',        cx: 0.491, cy: 0.148, hw: 0.095, hh: 0.054 },
  { id: 'river-rush',        name: 'River Rush',        cx: 0.155, cy: 0.292, hw: 0.095, hh: 0.044 },
  { id: 'bamboo-bash',       name: 'Bamboo Bash',       cx: 0.838, cy: 0.284, hw: 0.095, hh: 0.044 },
  { id: 'oni-dodge',         name: 'Oni Dodge',         cx: 0.148, cy: 0.534, hw: 0.095, hh: 0.042 },
  { id: 'sakura-sweep',      name: 'Sakura Sweep',      cx: 0.851, cy: 0.536, hw: 0.095, hh: 0.042 },
  { id: 'bell-clash',        name: 'Bell Clash',        cx: 0.273, cy: 0.708, hw: 0.132, hh: 0.060 },
  { id: 'temple-curling',    name: 'Temple Curling',    cx: 0.718, cy: 0.720, hw: 0.144, hh: 0.053 },
];

// Cherry blossom petal colours (rotated randomly per petal)
const PETAL_COLOURS = [0xFFB7C5, 0xFFC8D3, 0xFFD9E2, 0xFF8FAD, 0xFFE4EC, 0xffffff];

// ─────────────────────────────────────────────────────────────────────────────

export class HubScene extends Phaser.Scene {
  private user: User | null    = null;
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
  private hotspotLayer: Phaser.GameObjects.GameObject[] = [];
  private extrasLayer:  Phaser.GameObjects.GameObject[] = [];
  private lbLayer:      Phaser.GameObjects.GameObject[] = [];

  // ── Resize debounce ───────────────────────────────────────────────────────────
  private resizeTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  // ── Modal state — stored so the modal can be recentred on resize ──────────────
  private modalTitle: string | null = null;
  private modalDesc:  string        = '';
  private modalKind:  'default' | 'achievements' | 'customization' | null = null;

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = this.make.graphics({ x: 0, y: 0 } as any, false);
    g.fillStyle(0xFFB7C5, 1);
    g.fillEllipse(10, 6, 20, 12);   // outer petal shape
    g.fillStyle(0xFFE4EC, 0.75);
    g.fillEllipse(10, 5,  12,  7);  // lighter centre highlight
    g.generateTexture('petal', 20, 12);
    g.destroy();
  }

  // ── create ───────────────────────────────────────────────────────────────────

  async create(): Promise<void> {
    // Wire up the shutdown lifecycle so stale per-run state is cleared when the
    // scene is stopped (e.g. on scene.start('BambooBashScene')).
    // Phaser does NOT call shutdown() automatically — it only fires if registered
    // here. Without this, this.profilePanel keeps the old (Phaser-destroyed)
    // Container reference across scene restarts, causing toggle() to silently
    // no-op on a dead object.
    this.events.once('shutdown', this.shutdown, this);

    const { width, height } = this.scale;

    // Contain (letterbox): scale the square image so the WHOLE of it fits on
    // screen. This guarantees every shrine hotspot stays inside the viewport at
    // any aspect ratio (cover-and-crop pushed the top shrines off-screen on
    // 16:9). The margins are filled by the procedural background drawn first.
    this.bgScale = Math.min(width / SRC_W, height / SRC_H);
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

    // HubScene is only reachable after authentication.
    // If getMe() failed (session expired / cookie cleared), return to landing.
    if (!this.user) {
      this.scene.start('LandingScene');
      return;
    }

    // Share user data with game scenes via the global registry so they can
    // check isGuest before submitting progression results.
    this.registry.set('user', this.user);

    this.buildHotspots();
    this.drawExtrasSection();
    this.drawHUD();

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

    // 1. Recalculate contain (letterbox) transform — keeps every hotspot on screen
    this.bgScale = Math.min(width / SRC_W, height / SRC_H);
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

    // 5. Rebuild hotspot zones with recalculated hit areas.
    this.clearLayer(this.hotspotLayer);
    this.clearLayer(this.extrasLayer);

    // 6. Redraw the authenticated HUD (user is always set in HubScene).
    if (this.user) {
      this.buildHotspots();
      this.drawExtrasSection();
      this.clearLayer(this.hudLayer);
      this.drawHUD();
      // renderLeaderboard() clears lbLayer internally and re-fetches
    }

    // 7. Recentre any open modal at the new screen centre
    if (this.modal && this.modalTitle !== null) {
      const title = this.modalTitle;
      const desc  = this.modalDesc;
      const kind  = this.modalKind;
      this.dismissModal();
      if (kind === 'achievements') void this.showAchievementsModal();
      else if (kind === 'customization') void this.showCustomizationModal();
      else this.showModal(title, desc);
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
    // Soft moonlight cone pointing downward
    gfx.fillGradientStyle(0xFFF5D6, 0xFFF5D6, 0x14083A, 0x14083A, 0.04, 0.04, 0, 0);
    gfx.fillTriangle(
      moonX, moonY + moonR,
      moonX - width * 0.22, height * 0.75,
      moonX + width * 0.22, height * 0.75,
    );

    // ── Mountain silhouettes (distant peaks, behind trees) ───────────────────────
    const mtGfx = this.add.graphics().setDepth(DEPTH_BG);
    track(mtGfx);
    // Far range — darker, taller
    mtGfx.fillStyle(0x0e0e22, 0.38);
    mtGfx.fillTriangle(
      0,           height * 0.72,
      width * 0.28, height * 0.34,
      width * 0.55, height * 0.72,
    );
    mtGfx.fillTriangle(
      width * 0.42, height * 0.72,
      width * 0.70, height * 0.42,
      width,        height * 0.72,
    );
    // Near range — slightly lighter, overlapping
    mtGfx.fillStyle(0x12122a, 0.32);
    mtGfx.fillTriangle(
      0,            height * 0.72,
      width * 0.18, height * 0.50,
      width * 0.38, height * 0.72,
    );
    mtGfx.fillTriangle(
      width * 0.60, height * 0.72,
      width * 0.82, height * 0.46,
      width,        height * 0.72,
    );

    // ── Mist / fog at ground level ───────────────────────────────────────────────
    const mistGfx = this.add.graphics().setDepth(DEPTH_BG);
    track(mistGfx);
    mistGfx.fillGradientStyle(0x1A0D3A, 0x1A0D3A, 0x1A0D3A, 0x1A0D3A, 0, 0, 0.28, 0.28);
    mistGfx.fillRect(0, height * 0.60, width, height * 0.12);

    // ── Stone path — tapering trapezoid widening toward viewer ───────────────────
    const pathGfx = this.add.graphics().setDepth(DEPTH_BG);
    track(pathGfx);
    // Trapezoid: narrow at top (~65% down), wide at bottom edge
    const pathTopW  = width * 0.10;
    const pathBotW  = width * 0.40;
    const pathTopY  = height * 0.65;
    const pathBotY  = height;
    const cx        = width / 2;
    pathGfx.fillStyle(0x2a2218, 0.88);
    pathGfx.fillPoints([
      { x: cx - pathTopW / 2, y: pathTopY },
      { x: cx + pathTopW / 2, y: pathTopY },
      { x: cx + pathBotW / 2, y: pathBotY },
      { x: cx - pathBotW / 2, y: pathBotY },
    ] as Phaser.Types.Math.Vector2Like[], true);
    // Stone joint lines — converge toward vanishing point
    pathGfx.lineStyle(1, 0x0A0806, 0.45);
    const rows = 7;
    for (let row = 0; row <= rows; row++) {
      const t  = row / rows;
      const py = pathTopY + (pathBotY - pathTopY) * t;
      const hw = pathTopW / 2 + (pathBotW / 2 - pathTopW / 2) * t;
      pathGfx.lineBetween(cx - hw, py, cx + hw, py);
    }
    // Centre spine
    pathGfx.lineBetween(cx, pathTopY, cx, pathBotY);

    // ── Hanging stone lanterns ───────────────────────────────────────────────────
    const lanternGfx = this.add.graphics().setDepth(DEPTH_BG);
    track(lanternGfx);
    const lanternPositions = [0.18, 0.38, 0.62, 0.82];
    lanternPositions.forEach((xFrac) => {
      const lx  = width  * xFrac;
      const ly  = height * 0.30;  // body centre
      const lw  = Math.min(width, height) * 0.022;  // half-width of body
      const lh  = Math.min(width, height) * 0.040;  // half-height of body

      // Rope from canvas top to lantern top
      lanternGfx.lineStyle(1, 0x3a2e1a, 0.70);
      lanternGfx.lineBetween(lx, 0, lx, ly - lh);

      // Lantern body — warm amber oval
      lanternGfx.fillStyle(0x8b4513, 0.85);
      lanternGfx.fillEllipse(lx, ly, lw * 2, lh * 2);

      // Inner glow fill
      lanternGfx.fillStyle(0xff8c00, 0.30);
      lanternGfx.fillEllipse(lx, ly, lw * 1.4, lh * 1.4);

      // Top and bottom caps
      lanternGfx.fillStyle(0x5a2e10, 0.90);
      lanternGfx.fillRect(lx - lw * 0.7, ly - lh - 3, lw * 1.4, 5);
      lanternGfx.fillRect(lx - lw * 0.7, ly + lh - 2, lw * 1.4, 5);

      // Point light for warm glow (cast downward)
      const light = this.add.pointlight(lx, ly + lh * 0.5, 0xff6600, 60, 0.40, 0.06);
      track(light);
    });

    // ── Cherry blossom trees (left + right) ──────────────────────────────────────
    // Cover-and-crop letterbox fills the whole canvas, so no bounds guard needed.
    this.drawBlossamTree(width * 0.06, height * 0.72, height * 0.38, true);
    this.drawBlossamTree(width * 0.94, height * 0.72, height * 0.38, false);

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

  /** Draw a small zone icon at (ix, iy) into gfx. Icon fits within 18×18. */
  private drawZoneIcon(gfx: Phaser.GameObjects.Graphics, id: string, ix: number, iy: number, s: number): void {
    // s = scale factor (bgScale capped at 1)
    const u = Math.max(0.5, s);  // avoid sub-pixel invisibility
    gfx.lineStyle(1.5 * u, 0xd4a843, 0.85);
    gfx.fillStyle(0xd4a843, 0.80);

    switch (id) {
      case 'kame-knock': {
        // Torii arch: two upright posts + two crossbars
        const pw = 6 * u, ph = 10 * u;
        gfx.fillRect(ix,          iy + 3 * u, 2 * u, ph);
        gfx.fillRect(ix + pw,     iy + 3 * u, 2 * u, ph);
        gfx.fillRect(ix - u,      iy,          pw + 4 * u, 2 * u);
        gfx.fillRect(ix,          iy + 4 * u,  pw + 2 * u, 1.5 * u);
        break;
      }
      case 'river-rush': {
        // Two arc-shaped wave strokes
        gfx.lineStyle(2 * u, 0x7ec8e3, 0.90);
        gfx.beginPath();
        gfx.arc(ix + 4 * u, iy + 6 * u, 5 * u, Math.PI, 0, false);
        gfx.strokePath();
        gfx.beginPath();
        gfx.arc(ix + 4 * u, iy + 12 * u, 5 * u, Math.PI, 0, false);
        gfx.strokePath();
        break;
      }
      case 'bamboo-bash': {
        // Three vertical bamboo stalks with joint nodes
        gfx.lineStyle(2 * u, 0x6ab04c, 0.90);
        [-4, 0, 4].forEach((dx) => {
          const bx = ix + 4 * u + dx * u;
          gfx.lineBetween(bx, iy, bx, iy + 14 * u);
          gfx.fillStyle(0x4a8a2c, 0.70);
          gfx.fillRect(bx - u, iy + 4 * u, 2 * u, 2 * u);
          gfx.fillRect(bx - u, iy + 9 * u, 2 * u, 2 * u);
        });
        break;
      }
      case 'oni-dodge': {
        // Horned circle: head + two small horn triangles
        gfx.lineStyle(1.5 * u, 0xd4a843, 0.85);
        gfx.strokeCircle(ix + 5 * u, iy + 8 * u, 5 * u);
        gfx.fillStyle(0xd4a843, 0.80);
        gfx.fillTriangle(ix + 2 * u, iy + 4 * u, ix, iy, ix + 4 * u, iy + 4 * u);
        gfx.fillTriangle(ix + 7 * u, iy + 4 * u, ix + 6 * u, iy, ix + 10 * u, iy + 4 * u);
        break;
      }
      case 'sakura-sweep': {
        // 5-petal flower, radially arranged
        const petals = 5;
        const pr = 4 * u, cr = 1.5 * u;
        const fx = ix + 5 * u, fy = iy + 7 * u;
        for (let p = 0; p < petals; p++) {
          const angle = (p / petals) * Math.PI * 2 - Math.PI / 2;
          const px = fx + Math.cos(angle) * pr;
          const py = fy + Math.sin(angle) * pr;
          gfx.fillStyle(0xFFB7C5, 0.85);
          gfx.fillEllipse(px, py, 4 * u, 3 * u);
        }
        gfx.fillStyle(0xFFE4EC, 1);
        gfx.fillCircle(fx, fy, cr);
        break;
      }
      case 'bell-clash': {
        // Rounded trapezoid bell body + curved top dome
        gfx.lineStyle(1.5 * u, 0xd4a843, 0.85);
        gfx.beginPath();
        gfx.arc(ix + 5 * u, iy + 5 * u, 5 * u, Math.PI, 0, false);
        gfx.strokePath();
        gfx.fillStyle(0xd4a843, 0.25);
        gfx.fillRect(ix, iy + 5 * u, 10 * u, 8 * u);
        gfx.lineStyle(1.5 * u, 0xd4a843, 0.85);
        gfx.lineBetween(ix, iy + 5 * u, ix, iy + 13 * u);
        gfx.lineBetween(ix + 10 * u, iy + 5 * u, ix + 10 * u, iy + 13 * u);
        gfx.lineBetween(ix - u, iy + 13 * u, ix + 11 * u, iy + 13 * u);
        break;
      }
      case 'temple-curling': {
        // Curling sheet marker with a small stone.
        gfx.lineStyle(1.5 * u, 0xd4a843, 0.85);
        gfx.strokeRoundedRect(ix, iy + 1 * u, 10 * u, 14 * u, 2 * u);
        gfx.lineStyle(1 * u, 0xd4a843, 0.35);
        gfx.lineBetween(ix + 2 * u, iy + 4 * u, ix + 8 * u, iy + 4 * u);
        gfx.lineBetween(ix + 2 * u, iy + 12 * u, ix + 8 * u, iy + 12 * u);
        gfx.fillStyle(0xd4a843, 0.70);
        gfx.fillCircle(ix + 5 * u, iy + 8 * u, 2 * u);
        break;
      }
    }
  }

  private buildHotspots(): void {
    const s = Math.min(this.bgScale, 1.0);

    HOTSPOTS.forEach((hs) => {
      const minigame  = this.minigames.find((m) => m.id === hs.id);
      const available = minigame?.status === 'available' || hs.id === 'temple-curling';
      const r         = this.toScreen(hs);
      const glowColour = available ? THEME.gold : THEME.red;

      // ── Shrine-marker frame ──────────────────────────────────────────────────
      const frameBg = this.add.graphics().setDepth(DEPTH_HS);
      this.hotspotLayer.push(frameBg);

      // Dark lacquered wood fill
      frameBg.fillStyle(0x1a1005, 0.85);
      frameBg.fillRoundedRect(r.x, r.y, r.w, r.h, 6);
      // Gold outer border
      frameBg.lineStyle(2, THEME.gold, available ? 0.80 : 0.30);
      frameBg.strokeRoundedRect(r.x, r.y, r.w, r.h, 6);
      // Inner accent border (3 px inset)
      frameBg.lineStyle(1, THEME.gold, 0.15);
      frameBg.strokeRoundedRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 4);

      // ── Zone icon (top-left, 18×18 area) ────────────────────────────────────
      const iconGfx = this.add.graphics().setDepth(DEPTH_HS);
      this.hotspotLayer.push(iconGfx);
      this.drawZoneIcon(iconGfx, hs.id, r.x + 6, r.y + 4, s);

      // ── Label text (centred in the frame) ────────────────────────────────────
      const rawName   = hs.name;
      const labelText = this.add.text(r.cx, r.cy, rawName.split(' ').join('\n'), {
        fontSize:    this.scaledFont(22),
        color:       available ? THEME.textGold : THEME.textMutedHex,
        fontFamily:  THEME.font,
        fontStyle:   'bold',
        align:       'center',
        lineSpacing: 2,
      }).setOrigin(0.5).setDepth(DEPTH_HS);
      this.hotspotLayer.push(labelText);

      // ── Locked overlay (coming-soon) ─────────────────────────────────────────
      if (!available) {
        const lockGfx = this.add.graphics().setDepth(DEPTH_HS);
        this.hotspotLayer.push(lockGfx);
        // Translucent red wash
        lockGfx.fillStyle(0x330000, 0.60);
        lockGfx.fillRoundedRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 5);
        // Padlock icon centred
        const lx = r.cx, ly = r.cy + r.h * 0.05;
        const bw = 8 * s, bh = 7 * s, br = 5 * s;
        lockGfx.fillStyle(0xd4a843, 0.55);
        lockGfx.fillRoundedRect(lx - bw / 2, ly, bw, bh, 2);
        lockGfx.lineStyle(2 * s, 0xd4a843, 0.55);
        lockGfx.beginPath();
        lockGfx.arc(lx, ly, br, Math.PI, 0, false);
        lockGfx.strokePath();
      }

      // ── Interactive zone ──────────────────────────────────────────────────────
      const zone = this.add
        .zone(r.cx, r.cy, r.w, r.h)
        .setInteractive({ useHandCursor: true })
        .setDepth(DEPTH_HS);
      this.hotspotLayer.push(zone);

      // Hover in: white border + radial glow + petals
      zone.on('pointerover', () => {
        this.glowGfx.clear();
        // White border on hover
        this.glowGfx.lineStyle(2, 0xffffff, 0.90);
        this.glowGfx.strokeRoundedRect(r.x, r.y, r.w, r.h, 6);
        // Radial-style glow — concentric filled rects fading outward (24px beyond zone)
        const pad = 24;
        const steps = 6;
        for (let i = steps; i >= 1; i--) {
          const p   = pad * (i / steps);
          const a   = 0.04 * (i / steps);
          this.glowGfx.fillStyle(glowColour, a);
          this.glowGfx.fillRoundedRect(r.x - p, r.y - p, r.w + p * 2, r.h + p * 2, 6 + p * 0.5);
        }
        // Inner highlight sheen
        this.glowGfx.fillStyle(0xffffff, 0.04);
        this.glowGfx.fillRoundedRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 4);
        this.startPetals(r.cx, r.cy, r.w, r.h);
      });

      // Hover out: clear glow + stop petals
      zone.on('pointerout', () => {
        this.glowGfx.clear();
        this.stopPetals();
      });

      // Click
      zone.on('pointerup', () => {
        if (hs.id === 'kame-knock') {
          this.scene.stop('KameKnockScene');
          this.scene.start('KameKnockScene');
          return;
        }
        if (hs.id === 'bamboo-bash') {
          this.scene.start('BambooBashScene');
          return;
        }
        if (hs.id === 'temple-curling') {
          this.scene.start('ShellCurlScene');
          return;
        }
        if (hs.id === 'bell-clash') {
          this.scene.start('BellClashScene');
          return;
        }
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

  private drawExtrasSection(): void {
    const { width, height } = this.scale;
    const PAD = 16;
    const panelW = Math.min(260, width - PAD * 2);
    const panelH = 202;
    const bottomReserve = this.user?.isGuest ? 52 : 16;
    const panelX = PAD;
    const panelY = Math.max(72, height - bottomReserve - panelH);

    const bg = this.add.graphics().setDepth(DEPTH_HUD);
    this.extrasLayer.push(bg);
    bg.fillStyle(THEME.background, 0.82);
    bg.fillRoundedRect(panelX, panelY, panelW, panelH, 10);
    bg.lineStyle(1, THEME.gold, 0.34);
    bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 10);
    bg.lineStyle(1, THEME.gold, 0.12);
    bg.strokeRoundedRect(panelX + 5, panelY + 5, panelW - 10, panelH - 10, 7);

    const title = this.add.text(panelX + panelW / 2, panelY + 13, 'DOJO EXTRAS', {
      fontSize: this.scaledFont(10),
      color: THEME.textGold,
      fontFamily: THEME.font,
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0.5, 0).setDepth(DEPTH_HUD);
    this.extrasLayer.push(title);

    this.drawExtrasButton(
      panelX + 16,
      panelY + 42,
      panelW - 32,
      38,
      'shell-cards',
      'Shell Cards',
      'A new card challenge is being prepared for the dojo.',
    );

    this.drawExtrasButton(
      panelX + 16,
      panelY + 92,
      panelW - 32,
      38,
      'achievements',
      'Achievements',
      'Track your dojo milestones and unlocked rewards.',
    );

    this.drawExtrasButton(
      panelX + 16,
      panelY + 142,
      panelW - 32,
      38,
      'customization',
      'Customization',
      'Shell and turtle customization.',
    );
  }

  private drawExtrasButton(x: number, y: number, w: number, h: number, id: string, label: string, description: string): void {
    const btnGfx = this.add.graphics().setDepth(DEPTH_HUD);
    this.extrasLayer.push(btnGfx);

    const paint = (hovered: boolean): void => {
      btnGfx.clear();
      btnGfx.fillStyle(0x1a1005, hovered ? 0.96 : 0.84);
      btnGfx.fillRoundedRect(x, y, w, h, 7);
      btnGfx.lineStyle(1.5, THEME.gold, hovered ? 0.90 : 0.46);
      btnGfx.strokeRoundedRect(x, y, w, h, 7);
      btnGfx.fillStyle(THEME.gold, hovered ? 0.18 : 0.10);
      btnGfx.fillRoundedRect(x + 4, y + 4, 28, h - 8, 5);
    };
    paint(false);

    const icon = id === 'shell-cards' ? 'CARD' : id === 'achievements' ? 'MEDAL' : 'STYLE';
    const iconText = this.add.text(x + 18, y + h / 2, icon, {
      fontSize: this.scaledFont(7),
      color: THEME.textGold,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_HUD);
    this.extrasLayer.push(iconText);

    const labelText = this.add.text(x + 44, y + h / 2, label, {
      fontSize: this.scaledFont(13),
      color: THEME.text,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(DEPTH_HUD);
    this.extrasLayer.push(labelText);

    const zone = this.add
      .zone(x + w / 2, y + h / 2, w, h)
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTH_HUD);
    this.extrasLayer.push(zone);

    zone.on('pointerover', () => {
      paint(true);
      labelText.setColor(THEME.textGold);
    });
    zone.on('pointerout', () => {
      paint(false);
      labelText.setColor(THEME.text);
    });
    zone.on('pointerup', () => {
      if (id === 'achievements') void this.showAchievementsModal();
      else if (id === 'customization') void this.showCustomizationModal();
      else this.showModal(label, description);
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
    }).setDepth(50);
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
    this.modalKind  = 'default';

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

  private async showAchievementsModal(): Promise<void> {
    this.dismissModal();
    this.modalTitle = 'Achievements';
    this.modalDesc  = '';
    this.modalKind  = 'achievements';
    this.renderAchievementsModal(null, null);

    try {
      const achievements = await api.getAchievements();
      if (this.modalKind === 'achievements') this.renderAchievementsModal(achievements, null);
    } catch {
      if (this.modalKind === 'achievements') {
        this.renderAchievementsModal(null, 'Could not load achievements. Try again later.');
      }
    }
  }

  private renderAchievementsModal(achievements: Achievement[] | null, error: string | null): void {
    const { width, height } = this.scale;
    const panelW = Math.min(760, width * 0.90);
    const panelH = Math.min(560, height * 0.86);
    const px = width / 2;
    const py = height / 2;

    this.modal?.destroy(true);
    const container = this.add.container(0, 0).setDepth(DEPTH_MODAL);
    this.modal = container;

    const backdrop = this.add.rectangle(px, py, width, height, 0x000000, 0.72).setInteractive();
    backdrop.on('pointerup', () => this.dismissModal());

    const panelBlocker = this.add.rectangle(px, py, panelW, panelH, 0x000000, 0).setInteractive();
    panelBlocker.on('pointerdown', (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => event.stopPropagation());
    panelBlocker.on('pointerup', (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => event.stopPropagation());

    const panelGfx = this.add.graphics();
    panelGfx.fillStyle(THEME.background, 0.97);
    panelGfx.fillRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 12);
    panelGfx.lineStyle(2, THEME.gold, 1);
    panelGfx.strokeRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 12);
    panelGfx.lineStyle(1, THEME.gold, 0.20);
    panelGfx.strokeRoundedRect(px - panelW / 2 + 6, py - panelH / 2 + 6, panelW - 12, panelH - 12, 8);

    const title = this.add.text(px, py - panelH / 2 + 26, 'ACHIEVEMENTS', {
      fontSize: this.scaledFont(22),
      color: THEME.textGold,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    const subtitle = this.add.text(px, py - panelH / 2 + 58, 'Dojo milestones unlocked by playing Shell Smash.', {
      fontSize: this.scaledFont(12),
      color: THEME.textMutedHex,
      fontFamily: THEME.font,
    }).setOrigin(0.5, 0);

    const children: Phaser.GameObjects.GameObject[] = [backdrop, panelBlocker, panelGfx, title, subtitle];
    let top = py - panelH / 2 + 96;

    if (error) {
      children.push(this.add.text(px, top + 80, error, {
        fontSize: this.scaledFont(14),
        color: THEME.textMutedHex,
        fontFamily: THEME.font,
      }).setOrigin(0.5));
    } else if (!achievements) {
      children.push(this.add.text(px, top + 80, 'Loading achievements...', {
        fontSize: this.scaledFont(14),
        color: THEME.textMutedHex,
        fontFamily: THEME.font,
      }).setOrigin(0.5));
    } else {
      const unlockedCount = achievements.filter((achievement) => achievement.unlocked).length;
      const totalCount = Math.max(achievements.length, 1);
      const ratio = unlockedCount / totalCount;
      const summaryW = Math.min(panelW - 96, 360);
      const summaryX = px - summaryW / 2;
      const summaryY = py - panelH / 2 + 82;
      const summaryBar = this.add.graphics();
      summaryBar.fillStyle(0x050403, 0.70);
      summaryBar.fillRoundedRect(summaryX, summaryY, summaryW, 7, 4);
      summaryBar.fillStyle(THEME.gold, 0.90);
      summaryBar.fillRoundedRect(summaryX, summaryY, summaryW * ratio, 7, 4);
      summaryBar.lineStyle(1, THEME.gold, 0.36);
      summaryBar.strokeRoundedRect(summaryX, summaryY, summaryW, 7, 4);
      const summaryLabel = this.add.text(px, summaryY + 12, `${unlockedCount}/${achievements.length} unlocked`, {
        fontSize: this.scaledFont(10),
        color: THEME.textMutedHex,
        fontFamily: THEME.font,
      }).setOrigin(0.5, 0);
      children.push(summaryBar, summaryLabel);
      top += 18;

      const cardGap = 12;
      const cols = panelW < 560 ? 1 : 2;
      const cardW = (panelW - 48 - cardGap * (cols - 1)) / cols;
      const cardH = 118;
      achievements.forEach((achievement, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const x = px - panelW / 2 + 24 + col * (cardW + cardGap);
        const y = top + row * (cardH + cardGap);
        children.push(...this.drawAchievementCard(x, y, cardW, cardH, achievement));
      });
    }

    const closeBtn = this.add.text(px + panelW / 2 - 20, py - panelH / 2 + 18, 'X', {
      fontSize: this.scaledFont(15),
      color: THEME.textMutedHex,
      fontFamily: THEME.font,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerup', () => this.dismissModal());
    closeBtn.on('pointerover', () => closeBtn.setColor(THEME.text));
    closeBtn.on('pointerout', () => closeBtn.setColor(THEME.textMutedHex));
    children.push(closeBtn);

    container.add(children);
    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 140, ease: 'Power2' });
  }

  private drawAchievementCard(x: number, y: number, w: number, h: number, achievement: Achievement): Phaser.GameObjects.GameObject[] {
    const unlocked = achievement.unlocked;
    const card = this.add.graphics();
    card.fillStyle(unlocked ? 0x1a1005 : 0x0b0806, unlocked ? 0.94 : 0.76);
    card.fillRoundedRect(x, y, w, h, 9);
    card.lineStyle(1.5, unlocked ? THEME.gold : 0x6d5940, unlocked ? 0.84 : 0.38);
    card.strokeRoundedRect(x, y, w, h, 9);

    const badge = this.add.text(x + 18, y + 18, unlocked ? 'MEDAL' : 'LOCK', {
      fontSize: this.scaledFont(8),
      color: unlocked ? THEME.textGold : THEME.textMutedHex,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const title = this.add.text(x + 42, y + 13, achievement.title, {
      fontSize: this.scaledFont(15),
      color: unlocked ? THEME.textGold : THEME.text,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    });
    const desc = this.add.text(x + 18, y + 40, unlocked ? achievement.unlockDescription : achievement.description, {
      fontSize: this.scaledFont(11),
      color: unlocked ? THEME.text : THEME.textMutedHex,
      fontFamily: THEME.font,
      wordWrap: { width: w - 36 },
    });
    const footerText = unlocked
      ? `Unlocked${achievement.unlockedAt ? ` · ${new Date(achievement.unlockedAt).toLocaleDateString()}` : ''}`
      : 'Locked';
    const footer = this.add.text(x + 18, y + h - 24, footerText, {
      fontSize: this.scaledFont(10),
      color: unlocked ? THEME.textGold : THEME.textMutedHex,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    });

    const progress = this.getAchievementProgress(achievement);
    const barX = x + 18;
    const barY = y + h - 12;
    const barW = w - 36;
    const barH = 5;
    const progressBar = this.add.graphics();
    progressBar.fillStyle(0x050403, 0.72);
    progressBar.fillRoundedRect(barX, barY, barW, barH, 3);
    if (progress.ratio > 0) {
      progressBar.fillStyle(unlocked ? THEME.gold : 0x7d6748, unlocked ? 0.95 : 0.70);
      progressBar.fillRoundedRect(barX, barY, barW * progress.ratio, barH, 3);
    }
    progressBar.lineStyle(1, unlocked ? THEME.gold : 0x6d5940, unlocked ? 0.34 : 0.24);
    progressBar.strokeRoundedRect(barX, barY, barW, barH, 3);
    const progressText = this.add.text(x + w - 18, y + h - 27, progress.label, {
      fontSize: this.scaledFont(9),
      color: unlocked ? THEME.textGold : THEME.textMutedHex,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setOrigin(1, 0);
    const rewardText = achievement.rewardCosmeticId ? this.add.text(x + 18, y + h - 40, 'Reward: skin', {
      fontSize: this.scaledFont(9),
      color: THEME.textGold,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }) : null;

    return rewardText
      ? [card, badge, title, desc, footer, rewardText, progressBar, progressText]
      : [card, badge, title, desc, footer, progressBar, progressText];
  }

  private getAchievementProgress(achievement: Achievement): { ratio: number; label: string } {
    if (achievement.unlocked) return { ratio: 1, label: 'Complete' };
    const target = Math.max(achievement.progressTarget, 1);
    const current = Math.max(0, Math.min(achievement.progressCurrent, target));
    return {
      ratio: current / target,
      label: `${current}/${target}`,
    };
  }

  private async showCustomizationModal(): Promise<void> {
    this.dismissModal();
    this.modalTitle = 'Customization';
    this.modalDesc = '';
    this.modalKind = 'customization';
    this.renderCustomizationModal(null, null);

    try {
      const cosmetics = await api.getCustomization();
      if (this.modalKind === 'customization') this.renderCustomizationModal(cosmetics, null);
    } catch {
      if (this.modalKind === 'customization') {
        this.renderCustomizationModal(null, 'Could not load customization. Try again later.');
      }
    }
  }

  private renderCustomizationModal(cosmetics: Cosmetic[] | null, error: string | null): void {
    const { width, height } = this.scale;
    const panelW = Math.min(740, width * 0.90);
    const panelH = Math.min(540, height * 0.86);
    const px = width / 2;
    const py = height / 2;

    this.modal?.destroy(true);
    const container = this.add.container(0, 0).setDepth(DEPTH_MODAL);
    this.modal = container;

    const backdrop = this.add.rectangle(px, py, width, height, 0x000000, 0.72).setInteractive();
    backdrop.on('pointerup', () => this.dismissModal());

    const panelBlocker = this.add.rectangle(px, py, panelW, panelH, 0x000000, 0).setInteractive();
    panelBlocker.on('pointerdown', (_pointer, _localX, _localY, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    panelBlocker.on('pointerup', (_pointer, _localX, _localY, event: Phaser.Types.Input.EventData) => event.stopPropagation());

    const panelGfx = this.add.graphics();
    panelGfx.fillStyle(THEME.background, 0.97);
    panelGfx.fillRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 12);
    panelGfx.lineStyle(2, THEME.gold, 1);
    panelGfx.strokeRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 12);
    panelGfx.lineStyle(1, THEME.gold, 0.20);
    panelGfx.strokeRoundedRect(px - panelW / 2 + 6, py - panelH / 2 + 6, panelW - 12, panelH - 12, 8);

    const title = this.add.text(px, py - panelH / 2 + 26, 'CUSTOMIZATION', {
      fontSize: this.scaledFont(22),
      color: THEME.textGold,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    const subtitle = this.add.text(px, py - panelH / 2 + 58, 'Unlock and equip shell skins for your turtle.', {
      fontSize: this.scaledFont(12),
      color: THEME.textMutedHex,
      fontFamily: THEME.font,
    }).setOrigin(0.5, 0);

    const children: Phaser.GameObjects.GameObject[] = [backdrop, panelBlocker, panelGfx, title, subtitle];
    const top = py - panelH / 2 + 96;

    if (error) {
      children.push(this.add.text(px, top + 80, error, {
        fontSize: this.scaledFont(14),
        color: THEME.textMutedHex,
        fontFamily: THEME.font,
      }).setOrigin(0.5));
    } else if (!cosmetics) {
      children.push(this.add.text(px, top + 80, 'Loading shell skins...', {
        fontSize: this.scaledFont(14),
        color: THEME.textMutedHex,
        fontFamily: THEME.font,
      }).setOrigin(0.5));
    } else {
      const cardGap = 12;
      const cols = panelW < 560 ? 1 : 2;
      const cardW = (panelW - 48 - cardGap * (cols - 1)) / cols;
      const cardH = 126;
      cosmetics.forEach((cosmetic, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const x = px - panelW / 2 + 24 + col * (cardW + cardGap);
        const y = top + row * (cardH + cardGap);
        children.push(...this.drawCosmeticCard(x, y, cardW, cardH, cosmetic));
      });
    }

    const closeBtn = this.add.text(px + panelW / 2 - 20, py - panelH / 2 + 18, 'X', {
      fontSize: this.scaledFont(15),
      color: THEME.textMutedHex,
      fontFamily: THEME.font,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerup', () => this.dismissModal());
    closeBtn.on('pointerover', () => closeBtn.setColor(THEME.text));
    closeBtn.on('pointerout', () => closeBtn.setColor(THEME.textMutedHex));
    children.push(closeBtn);

    container.add(children);
    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 140, ease: 'Power2' });
  }

  private drawCosmeticCard(x: number, y: number, w: number, h: number, cosmetic: Cosmetic): Phaser.GameObjects.GameObject[] {
    const enabled = cosmetic.owned || cosmetic.lockedReason === 'purchasable';
    const card = this.add.graphics();
    card.fillStyle(cosmetic.equipped ? 0x1a1005 : 0x0b0806, cosmetic.owned ? 0.94 : 0.76);
    card.fillRoundedRect(x, y, w, h, 9);
    card.lineStyle(1.5, cosmetic.equipped ? THEME.gold : 0x6d5940, cosmetic.equipped ? 0.94 : 0.40);
    card.strokeRoundedRect(x, y, w, h, 9);

    const preview = this.add.graphics();
    const accent = cosmetic.accentColor ?? shellSkinAccentColor(cosmetic.id);
    preview.fillStyle(accent, cosmetic.owned ? 0.95 : 0.42);
    preview.fillEllipse(x + 36, y + 36, 46, 30);
    preview.lineStyle(2, THEME.gold, cosmetic.equipped ? 0.9 : 0.35);
    preview.strokeEllipse(x + 36, y + 36, 46, 30);
    preview.lineStyle(1, 0x000000, 0.35);
    preview.lineBetween(x + 18, y + 36, x + 54, y + 36);
    preview.lineBetween(x + 36, y + 22, x + 36, y + 50);

    const title = this.add.text(x + 72, y + 14, cosmetic.name, {
      fontSize: this.scaledFont(15),
      color: cosmetic.equipped ? THEME.textGold : THEME.text,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    });
    const desc = this.add.text(x + 72, y + 38, cosmetic.description, {
      fontSize: this.scaledFont(10),
      color: THEME.textMutedHex,
      fontFamily: THEME.font,
      wordWrap: { width: w - 92 },
    });

    const status = cosmetic.equipped
      ? 'Equipped'
      : cosmetic.owned
        ? 'Click to equip'
        : cosmetic.lockedReason === 'achievement-locked'
          ? 'Locked by achievement'
          : cosmetic.lockedReason === 'not enough coins'
            ? `${cosmetic.price} coins needed`
            : `Buy for ${cosmetic.price} coins`;
    const statusText = this.add.text(x + 18, y + h - 24, status, {
      fontSize: this.scaledFont(10),
      color: enabled ? THEME.textGold : THEME.textMutedHex,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    });

    const objects: Phaser.GameObjects.GameObject[] = [card, preview, title, desc, statusText];
    if (enabled && !cosmetic.equipped) {
      const zone = this.add.zone(x + w / 2, y + h / 2, w, h).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => void this.handleCosmeticAction(cosmetic));
      objects.push(zone);
    }
    return objects;
  }

  private async handleCosmeticAction(cosmetic: Cosmetic): Promise<void> {
    try {
      const cosmetics = cosmetic.owned
        ? await api.equipCosmetic(cosmetic.id)
        : await api.buyCosmetic(cosmetic.id);
      const equipped = cosmetics.find((item) => item.equipped);
      if (this.user && equipped) this.user.shellSkin = equipped.id;
      if (!cosmetic.owned) {
        try { this.user = await api.getMe(); } catch { /* keep local user if refresh fails */ }
      }
      if (this.user) {
        this.registry.set('user', this.user);
        this.clearLayer(this.hudLayer);
        this.drawHUD();
        if (this.profilePanel) {
          this.profilePanel.destroy();
          this.profilePanel = null;
        }
      }
      if (this.modalKind === 'customization') this.renderCustomizationModal(cosmetics, null);
    } catch {
      if (this.modalKind === 'customization') this.renderCustomizationModal(null, 'Could not update shell skin.');
    }
  }

  private dismissModal(): void {
    this.modalTitle = null;
    this.modalDesc  = '';
    this.modalKind  = null;

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
    // Type guard — drawHUD() is only called after a null check in create() /
    // applyResize(), but TypeScript cannot track that across method boundaries.
    if (!this.user) return;

    const { width } = this.scale;
    const PAD    = 16;
    const BAR_H  = 56;
    const AVT_CX = PAD + 20;   // avatar circle centre x
    const AVT_CY = BAR_H / 2;  // avatar circle centre y
    const AVT_R  = 17;         // inner radius
    const RING_R = 21;         // outer XP-arc radius

    // ── Bar background ────────────────────────────────────────────────────────
    const bar = this.add.graphics().setDepth(DEPTH_HUD);
    this.hudLayer.push(bar);
    bar.fillStyle(THEME.background, 0.80);
    bar.fillRect(0, 0, width, BAR_H);
    bar.lineStyle(1, THEME.gold, 0.35);
    bar.lineBetween(0, BAR_H, width, BAR_H);

    // ── Avatar circle + turtle silhouette ─────────────────────────────────────
    bar.fillStyle(THEME.background, 1); bar.fillCircle(AVT_CX, AVT_CY, RING_R);
    bar.fillStyle(THEME.gold, 0.55);
    bar.fillCircle(AVT_CX, AVT_CY - 4, 7);
    bar.fillEllipse(AVT_CX, AVT_CY + 10, 14, 8);

    // ── XP arc ring around avatar ─────────────────────────────────────────────
    // Track (full ring, dim)
    bar.lineStyle(3, THEME.gold, 0.18);
    bar.beginPath();
    bar.arc(AVT_CX, AVT_CY, RING_R, 0, Math.PI * 2);
    bar.strokePath();
    // Fill arc (gold, from top, clockwise to xpFraction)
    const xpMax    = this.user.level * 1000;
    const xpFrac   = Math.min(this.user.xp / xpMax, 1);
    if (xpFrac > 0) {
      const startA = -Math.PI / 2;
      const endA   = startA + Math.PI * 2 * xpFrac;
      bar.lineStyle(3, THEME.gold, 1);
      bar.beginPath();
      bar.arc(AVT_CX, AVT_CY, RING_R, startA, endA, false);
      bar.strokePath();
    }

    // ── Hover glow layer (above bar, below text labels) ───────────────────────
    const PROFILE_HIT_W = 220;
    const hoverGfx = this.add.graphics().setDepth(DEPTH_HUD);
    this.hudLayer.push(hoverGfx);
    const paintHover = (on: boolean): void => {
      hoverGfx.clear();
      if (!on) return;
      hoverGfx.fillStyle(THEME.gold, 0.22);
      hoverGfx.fillCircle(AVT_CX, AVT_CY, RING_R + 4);
      hoverGfx.fillStyle(THEME.gold, 0.05);
      hoverGfx.fillRect(0, 0, PROFILE_HIT_W, BAR_H);
    };

    // ── Text labels ───────────────────────────────────────────────────────────
    const displayName = this.user.turtleName ?? this.user.username;
    const nameLabel = this.add.text(PAD + 48, 10, displayName, {
      fontSize: this.scaledFont(15), color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setDepth(DEPTH_HUD);
    this.hudLayer.push(nameLabel);

    const levelLabel = this.add.text(PAD + 48, 31, `Lvl ${this.user.level}  ·  Shell: ${this.user.shellSkin ?? 'kanagawa'}`, {
      fontSize: this.scaledFont(11), color: THEME.text, fontFamily: THEME.font,
    }).setDepth(DEPTH_HUD);
    this.hudLayer.push(levelLabel);

    // ── Coins display ─────────────────────────────────────────────────────────
    const coinsLabel = this.add.text(PAD + 48, 44, `⬡ ${this.user.coins ?? 0}`, {
      fontSize: this.scaledFont(10), color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setDepth(DEPTH_HUD);
    this.hudLayer.push(coinsLabel);

    // ── DEV badge (visible only for dev accounts) ─────────────────────────────
    if (this.user.isDevAccount) {
      const devBadge = this.add.text(nameLabel.getRightCenter().x + 8, 10, 'DEV', {
        fontSize:        this.scaledFont(9),
        color:           '#ffffff',
        fontFamily:      THEME.font,
        fontStyle:       'bold',
        backgroundColor: '#8b0000',
        padding:         { x: 4, y: 2 },
      }).setDepth(DEPTH_HUD);
      this.hudLayer.push(devBadge);
    }

    // ── Guest banner (persistent bottom strip) ────────────────────────────────
    if (this.user.isGuest) {
      this.drawGuestBanner();
    }

    // ── One-shot pulse tween on the avatar ring ────────────────────────────────
    // Wrap bar in a Container so the tween can scale it without affecting width
    const avatarRingGfx = this.add.graphics().setDepth(DEPTH_HUD);
    this.hudLayer.push(avatarRingGfx);
    avatarRingGfx.lineStyle(3, THEME.gold, 0.55);
    avatarRingGfx.strokeCircle(AVT_CX, AVT_CY, RING_R);
    this.tweens.add({
      targets:   avatarRingGfx,
      scaleX:    1.08,
      scaleY:    1.08,
      alpha:     0,
      duration:  500,
      ease:      'Sine.easeOut',
      onComplete: () => { if (avatarRingGfx?.active) avatarRingGfx.destroy(); },
    });

    this.renderLeaderboard();

    // ── Logout button (top-right of HUD bar) ──────────────────────────────────
    this.drawLogoutButton(width, BAR_H, PAD);

    // ── Profile trigger ────────────────────────────────────────────────────────
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

  // ── Logout button ────────────────────────────────────────────────────────────

  private drawLogoutButton(barWidth: number, barHeight: number, pad: number): void {
    const label  = 'Logout';
    const btnX   = barWidth - pad;
    const btnY   = barHeight / 2;

    const txt = this.add.text(btnX, btnY, label, {
      fontSize:  this.scaledFont(12),
      color:     THEME.textMutedHex,
      fontFamily: THEME.font,
    }).setOrigin(1, 0.5).setDepth(DEPTH_HUD).setInteractive({ useHandCursor: true });
    this.hudLayer.push(txt);

    // Separator line to the left of the button
    const sepGfx = this.add.graphics().setDepth(DEPTH_HUD);
    this.hudLayer.push(sepGfx);
    sepGfx.lineStyle(1, THEME.gold, 0.20);
    sepGfx.lineBetween(btnX - txt.width - 12, 10, btnX - txt.width - 12, barHeight - 10);

    txt.on('pointerover', () => txt.setColor(THEME.textGold));
    txt.on('pointerout',  () => txt.setColor(THEME.textMutedHex));
    txt.on('pointerup', () => void this.doLogout());
  }

  private async doLogout(): Promise<void> {
    try {
      await api.getCsrfToken();   // refresh token before the DELETE
      await api.logout();
    } catch (err) {
      // Even if the server call fails (expired session, network hiccup),
      // redirect to landing — the cookie will be cleared on next load.
      console.warn('[HubScene] Logout request failed (continuing anyway):', err);
    }
    this.scene.start('LandingScene');
  }

  // ── Guest banner ──────────────────────────────────────────────────────────────

  /**
   * Persistent bottom strip shown while playing as a guest.
   * Clicking "Log in" redirects to the 42 OAuth flow.
   */
  private drawGuestBanner(): void {
    const { width, height } = this.scale;
    const BANNER_H = 36;
    const bannerY  = height - BANNER_H;

    const bg = this.add.graphics().setDepth(DEPTH_HUD);
    this.hudLayer.push(bg);
    bg.fillStyle(0x1a0a00, 0.90);
    bg.fillRect(0, bannerY, width, BANNER_H);
    bg.lineStyle(1, THEME.gold, 0.35);
    bg.lineBetween(0, bannerY, width, bannerY);

    const msg = this.add.text(width / 2, bannerY + BANNER_H / 2,
      'Playing as Guest — progress is not saved.',
      {
        fontSize: this.scaledFont(12), color: THEME.text, fontFamily: THEME.font,
      },
    ).setOrigin(0.5).setDepth(DEPTH_HUD);
    this.hudLayer.push(msg);

    const loginLink = this.add.text(msg.getRightCenter().x + 12, bannerY + BANNER_H / 2,
      'Log in to save', {
        fontSize: this.scaledFont(12), color: THEME.textGold,
        fontFamily: THEME.font, fontStyle: 'bold',
      },
    ).setOrigin(0, 0.5).setDepth(DEPTH_HUD).setInteractive({ useHandCursor: true });
    loginLink.on('pointerover', () => loginLink.setStyle({ textDecoration: 'underline' }));
    loginLink.on('pointerout',  () => loginLink.setStyle({ textDecoration: '' }));
    loginLink.on('pointerup',   () => { window.location.href = api.loginUrl(); });
    this.hudLayer.push(loginLink);
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
