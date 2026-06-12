/**
 * HubScene.ts — Shell Smash Dojo Hub
 *
 * Renders the Japanese dojo courtyard as a letterboxed full-screen background,
 * with interactive hotspot zones overlaid on each shrine building.
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
 * Asset required: src/assets/hub-background.png  (copy your 1080×1080 art)
 */

import Phaser from 'phaser';
import { api, MiniGameDefinition } from './api';
import { THEME } from './theme';

// Place your 1080×1080 dojo art at:
//   srcs/requirements/frontend/src/public/assets/hub-background.png
// Vite copies everything in public/ to dist/ verbatim, so the URL works in dev and prod.
const HUB_BG = '/assets/hub-background.png';

// ── Source image reference dimensions ─────────────────────────────────────────
// All hotspot fractions are relative to this size. Change if your art differs.
const SRC_W = 1080;
const SRC_H = 1080;

// ── Shrine hotspot definitions ─────────────────────────────────────────────────
interface HotspotDef {
  id: string;   // must match MiniGameDefinition.id returned by /api/minigames
  name: string;
  cx: number;   // centre-x as fraction of SRC_W  [0 = left,  1 = right]
  cy: number;   // centre-y as fraction of SRC_H  [0 = top,   1 = bottom]
  hw: number;   // half-width  as fraction of SRC_W
  hh: number;   // half-height as fraction of SRC_H
}

const HOTSPOTS: HotspotDef[] = [
  // ─── top ────────────────────────────────────────────────────────────────────
  { id: 'shell-smash-arena', name: 'Shell Smash Arena', cx: 0.491, cy: 0.148, hw: 0.095, hh: 0.054 },
  // ─── middle row ─────────────────────────────────────────────────────────────
  { id: 'river-rush',        name: 'River Rush',        cx: 0.155, cy: 0.292, hw: 0.095, hh: 0.044 },
  { id: 'bamboo-bash',       name: 'Bamboo Bash',       cx: 0.838, cy: 0.284, hw: 0.095, hh: 0.044 },
  // ─── lower row ──────────────────────────────────────────────────────────────
  { id: 'oni-dodge',         name: 'Oni Dodge',         cx: 0.148, cy: 0.534, hw: 0.095, hh: 0.042 },
  { id: 'sakura-sweep',      name: 'Sakura Sweep',      cx: 0.851, cy: 0.536, hw: 0.095, hh: 0.042 },
  // ─── bottom ─────────────────────────────────────────────────────────────────
  { id: 'bell-clash',        name: 'Bell Clash',        cx: 0.273, cy: 0.708, hw: 0.132, hh: 0.060 },
  { id: 'shell-cards',       name: 'Shell Cards',       cx: 0.718, cy: 0.720, hw: 0.144, hh: 0.053 },
];

// ─────────────────────────────────────────────────────────────────────────────

export class HubScene extends Phaser.Scene {
  // API data — preserved from original scene
  private user: any = null;
  private minigames: MiniGameDefinition[] = [];

  // Active "Coming Soon" overlay — only one open at a time
  private modal: Phaser.GameObjects.Container | null = null;

  // Shared glow layer: drawn above bg, cleared on pointerout
  private glowGfx!: Phaser.GameObjects.Graphics;

  // Letterbox transform — computed once in create(), reused for every hotspot
  private bgOffX  = 0;
  private bgOffY  = 0;
  private bgScale = 1;

  constructor() {
    super({ key: 'HubScene' });
  }

  // ── Phaser: preload ──────────────────────────────────────────────────────────

  preload() {
    this.load.image('hub-bg', HUB_BG);
  }

  // ── Phaser: create ───────────────────────────────────────────────────────────

  async create() {
    const { width, height } = this.scale;

    // 1. Letterbox: fit image inside canvas, preserve aspect ratio
    const sx = width  / SRC_W;
    const sy = height / SRC_H;
    this.bgScale = Math.min(sx, sy);
    this.bgOffX  = (width  - SRC_W * this.bgScale) / 2;
    this.bgOffY  = (height - SRC_H * this.bgScale) / 2;

    // 2. Black fill so letterbox bars are solid (not transparent)
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000);

    // 3. Background image centred inside the letterbox frame
    const bgCX = this.bgOffX + (SRC_W * this.bgScale) / 2;
    const bgCY = this.bgOffY + (SRC_H * this.bgScale) / 2;
    this.add.image(bgCX, bgCY, 'hub-bg').setScale(this.bgScale);

    // 4. Glow graphics layer — sits above bg, below HUD
    this.glowGfx = this.add.graphics();

    // 5. Fetch API data (preserved from original HubScene)
    try { this.minigames = await api.getMiniGames(); } catch { this.minigames = []; }
    try { this.user      = await api.getMe();        } catch { this.user = null; }

    // 6. Clickable shrine hotspots
    this.buildHotspots();

    // 7. HUD — last so it renders above everything
    if (this.user) {
      this.drawHUD();
    } else {
      this.drawLoginPrompt();
    }
  }

  // ── Coordinate helper ────────────────────────────────────────────────────────

  /** Convert a hotspot definition to a pixel rectangle in screen space. */
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

  private buildHotspots() {
    HOTSPOTS.forEach((hs) => {
      const minigame  = this.minigames.find((m) => m.id === hs.id);
      const available = minigame?.status === 'available';
      const r         = this.toScreen(hs);

      // Invisible interactive zone (no visual of its own)
      const zone = this.add
        .zone(r.cx, r.cy, r.w, r.h)
        .setInteractive({ useHandCursor: true });

      // ── Hover in: draw glow
      zone.on('pointerover', () => {
        this.glowGfx.clear();
        if (available) {
          // Gold shimmer for playable shrines
          this.glowGfx.fillStyle(THEME.gold, 0.18);
          this.glowGfx.fillRect(r.x, r.y, r.w, r.h);
          this.glowGfx.lineStyle(2.5, THEME.gold, 0.90);
          this.glowGfx.strokeRect(r.x, r.y, r.w, r.h);
          this.glowGfx.fillStyle(0xffffff, 0.05);
          this.glowGfx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
        } else {
          // Muted grey outline for locked shrines
          this.glowGfx.fillStyle(0xffffff, 0.07);
          this.glowGfx.fillRect(r.x, r.y, r.w, r.h);
          this.glowGfx.lineStyle(1.5, 0xaaaaaa, 0.55);
          this.glowGfx.strokeRect(r.x, r.y, r.w, r.h);
        }
      });

      // ── Hover out: clear glow
      zone.on('pointerout', () => this.glowGfx.clear());

      // ── Click
      zone.on('pointerup', () => {
        if (available && this.scene.manager.getScene('ShellSmashArenaScene')) {
          // Navigate to game only once the scene is registered
          this.scene.start('ShellSmashArenaScene');
        } else {
          // Game scene not built yet — show modal for all shrines including arena
          const desc = available
            ? (minigame?.description ?? '') + '\n\n⚔️  Arena is being built — check back soon!'
            : (minigame?.description ?? '');
          this.showModal(hs.name, desc);
        }
      });
    });
  }

  // ── Coming Soon modal ────────────────────────────────────────────────────────

  private showModal(title: string, description: string) {
    // Tear down any open modal first
    this.dismissModal();

    const { width, height } = this.scale;
    const container = this.add.container(0, 0);
    this.modal = container;

    const panelW = Math.min(440, width * 0.85);
    const panelH = description ? 252 : 210;
    const px     = width  / 2;
    const py     = height / 2;

    // Full-screen backdrop — click anywhere to dismiss
    const backdrop = this.add
      .rectangle(px, py, width, height, 0x000000, 0.72)
      .setInteractive();
    backdrop.on('pointerup', () => this.dismissModal());

    // Panel background + borders
    const panelGfx = this.add.graphics();
    panelGfx.fillStyle(THEME.background, 0.96);
    panelGfx.fillRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 10);
    panelGfx.lineStyle(2, THEME.gold, 1);
    panelGfx.strokeRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 10);
    // Inner accent border
    panelGfx.lineStyle(1, THEME.gold, 0.22);
    panelGfx.strokeRoundedRect(px - panelW / 2 + 5, py - panelH / 2 + 5, panelW - 10, panelH - 10, 7);

    // Decorative torii icon
    const icon = this.add.text(px, py - panelH / 2 + 38, '⛩', {
      fontSize: '28px',
    }).setOrigin(0.5);

    // Shrine name
    const nameText = this.add.text(px, py - panelH / 2 + 80, title.toUpperCase(), {
      fontSize: '19px',
      color: THEME.textGold,
      fontFamily: THEME.font,
      fontStyle: 'bold',
      align: 'center',
    }).setOrigin(0.5);

    // Gold divider line
    const divider = this.add.graphics();
    divider.lineStyle(1, THEME.gold, 0.32);
    divider.lineBetween(
      px - panelW / 2 + 32, py - panelH / 2 + 104,
      px + panelW / 2 - 32, py - panelH / 2 + 104,
    );

    // "Coming Soon" text
    const soonText = this.add.text(px, py - panelH / 2 + 128, 'Coming Soon', {
      fontSize: '15px',
      color: THEME.text,
      fontFamily: THEME.font,
      fontStyle: 'italic',
    }).setOrigin(0.5);

    // Optional description
    const children: Phaser.GameObjects.GameObject[] = [backdrop, panelGfx, icon, nameText, divider, soonText];

    if (description) {
      const descText = this.add.text(px, py - panelH / 2 + 162, description, {
        fontSize: '12px',
        color: THEME.textMutedHex,
        fontFamily: THEME.font,
        align: 'center',
        wordWrap: { width: panelW - 48 },
      }).setOrigin(0.5);
      children.push(descText);
    }

    // Close button (✕)
    const closeBtn = this.add.text(
      px + panelW / 2 - 18,
      py - panelH / 2 + 16,
      '✕',
      { fontSize: '15px', color: THEME.textMutedHex, fontFamily: THEME.font },
    ).setOrigin(0.5).setInteractive({ useHandCursor: true });

    closeBtn.on('pointerup',   () => this.dismissModal());
    closeBtn.on('pointerover', () => closeBtn.setColor(THEME.text));
    closeBtn.on('pointerout',  () => closeBtn.setColor(THEME.textMutedHex));
    children.push(closeBtn);

    container.add(children);

    // Fade in
    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 140, ease: 'Power2' });
  }

  private dismissModal() {
    if (!this.modal) return;
    const target = this.modal;
    this.modal = null;
    this.tweens.add({
      targets: target,
      alpha: 0,
      duration: 100,
      ease: 'Power1',
      onComplete: () => target.destroy(),
    });
  }

  // ── HUD overlay ──────────────────────────────────────────────────────────────

  private drawHUD() {
    const { width } = this.scale;
    const PAD   = 16;
    const BAR_H = 56;

    // Semi-transparent top bar
    const bar = this.add.graphics();
    bar.fillStyle(THEME.background, 0.80);
    bar.fillRect(0, 0, width, BAR_H);
    bar.lineStyle(1, THEME.gold, 0.35);
    bar.lineBetween(0, BAR_H, width, BAR_H);

    // Avatar placeholder (circle silhouette)
    bar.fillStyle(THEME.gold, 1);
    bar.fillCircle(PAD + 20, BAR_H / 2, 20);
    bar.fillStyle(THEME.background, 1);
    bar.fillCircle(PAD + 20, BAR_H / 2, 17);
    bar.fillStyle(THEME.gold, 0.55);
    bar.fillCircle(PAD + 20, BAR_H / 2 - 4, 7);     // head
    bar.fillEllipse(PAD + 20, BAR_H / 2 + 10, 14, 8); // body

    // Player name
    const displayName = this.user.turtleName ?? this.user.username;
    this.add.text(PAD + 48, 8, displayName, {
      fontSize: '15px', color: THEME.textGold,
      fontFamily: THEME.font, fontStyle: 'bold',
    });

    // Level / shell skin
    this.add.text(PAD + 48, 27, `Lvl ${this.user.level}  ·  Shell: ${this.user.shellSkin ?? 'kanagawa'}`, {
      fontSize: '11px', color: THEME.text, fontFamily: THEME.font,
    });

    // XP progress bar
    const xpMax = this.user.level * 1000;
    const xpPct = Math.min(this.user.xp / xpMax, 1);
    const barX  = PAD + 48;
    const barY  = 43;
    const barW  = 130;
    bar.fillStyle(0x3a2e20, 1);
    bar.fillRect(barX, barY, barW, 5);
    bar.fillStyle(THEME.gold, 1);
    bar.fillRect(barX, barY, barW * xpPct, 5);
    this.add.text(barX + barW + 6, barY - 1, `${this.user.xp} / ${xpMax} XP`, {
      fontSize: '9px', color: THEME.textMutedHex, fontFamily: THEME.font,
    });

    // Leaderboard (async, bottom-right panel)
    this.renderLeaderboard();
  }

  // ── Login prompt (unauthenticated) ───────────────────────────────────────────

  private drawLoginPrompt() {
    const { width, height } = this.scale;

    // Gradient vignette so text is readable over the art
    const vignette = this.add.graphics();
    vignette.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.75, 0.75);
    vignette.fillRect(0, height * 0.55, width, height * 0.45);

    this.add.text(width / 2, height * 0.67, 'SHELL SMASH', {
      fontSize: '52px', color: THEME.textGold,
      fontFamily: THEME.font, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.67 + 56, 'Sumo Turtle Arena', {
      fontSize: '18px', color: THEME.text, fontFamily: THEME.font,
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);

    // TODO: swap devLogin() for loginUrl() redirect once 42 OAuth keys are set
    this.drawToriiButton(width / 2, height * 0.67 + 116, 240, 56, 'Enter the Dojo', async () => {
      await api.devLogin('KameMaster');
      this.scene.restart();
    });
  }

  // ── Torii-gate button (preserved from original HubScene) ─────────────────────

  private drawToriiButton(
    x: number, y: number, w: number, h: number,
    label: string, onClick: () => void,
  ) {
    const g = this.add.graphics();

    const paint = (hovered: boolean) => {
      g.clear();
      g.fillStyle(hovered ? THEME.gold : THEME.red, 0.92);
      g.fillRect(x - w / 2, y - h / 2, w, h);
      g.fillStyle(hovered ? THEME.red : THEME.gold, 1);
      g.fillRect(x - w / 2 - 10, y - h / 2 - 8, w + 20, 8); // lintel
      g.fillRect(x - w / 2 - 6,  y - h / 2,      8,     h);  // left post
      g.fillRect(x + w / 2 - 2,  y - h / 2,      8,     h);  // right post
    };

    paint(false);

    const hitArea = this.add.rectangle(x, y, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });

    const text = this.add.text(x, y, label, {
      fontSize: '18px', color: '#ffffff',
      fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5);

    hitArea.on('pointerup',   () => onClick());
    hitArea.on('pointerover', () => { paint(true);  text.setColor('#1a1410'); });
    hitArea.on('pointerout',  () => { paint(false); text.setColor('#ffffff'); });

    return { graphics: g, hitArea, text };
  }

  // ── Leaderboard (bottom-right panel, preserved from original HubScene) ────────

  private renderLeaderboard() {
    const { width, height } = this.scale;
    const PAD = 16;

    api.getAllUsers().then((users: any[]) => {
      if (!users?.length) return;

      const sorted  = users.sort((a, b) => b.xp - a.xp).slice(0, 5);
      const rowH    = 22;
      const panelW  = 232;
      const panelH  = 32 + sorted.length * rowH + 10;
      const panelX  = width  - PAD;
      const panelY  = height - PAD - panelH;

      const bg = this.add.graphics();
      bg.fillStyle(THEME.background, 0.80);
      bg.fillRoundedRect(panelX - panelW, panelY, panelW, panelH, 8);
      bg.lineStyle(1, THEME.gold, 0.30);
      bg.strokeRoundedRect(panelX - panelW, panelY, panelW, panelH, 8);

      this.add.text(panelX - panelW / 2, panelY + 10, 'DOJO RANKINGS', {
        fontSize: '10px', color: THEME.textGold,
        fontFamily: THEME.font, fontStyle: 'bold',
      }).setOrigin(0.5, 0);

      sorted.forEach((u, i) => {
        const nameStr = (u.turtleName || u.username).substring(0, 14);
        const colour  = i === 0 ? THEME.textGold : THEME.text;
        const rowY    = panelY + 30 + i * rowH;

        this.add.text(panelX - panelW + 12, rowY, `${i + 1}.  ${nameStr}`, {
          fontSize: '11px', color: colour, fontFamily: THEME.font,
        });
        this.add.text(panelX - 12, rowY, `${u.xp} XP`, {
          fontSize: '11px', color: colour, fontFamily: THEME.font,
        }).setOrigin(1, 0);
      });
    }).catch(() => { /* leaderboard is non-critical */ });
  }
}
