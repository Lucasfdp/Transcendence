/**
 * ProfilePanel.ts — Shell Smash Dojo Profile Overlay
 *
 * A self-contained Phaser Container that renders the player's full profile
 * panel. All art is drawn with Graphics primitives so the team can swap in
 * real textures later without restructuring the layout.
 *
 * Usage (from HubScene):
 *   this.profilePanel = new ProfilePanel(this, user);
 *   this.profilePanel.toggle();   // open / close
 *   this.profilePanel.destroy();  // on scene shutdown
 *
 * Layout (panel is 320 × 540, anchored 16px from top-left below the HUD):
 *
 *   ┌──────────────────────────────────┐
 *   │  ╔══════════════╗  [level badge] │
 *   │  ║  TURTLE ART  ║               │
 *   │  ╚══════════════╝  [42 badge]   │
 *   │  [──── Rank Belt ────]           │
 *   │  KAMEGORO                       │
 *   │  ⬡  kanagawa (hex icon)         │
 *   │  ─────────────────────────────  │
 *   │  XP ██████████░░░  1250/2000    │
 *   │  ─────────────────────────────  │
 *   │  ┌──────┐  ┌──────┐  ┌──────┐  │
 *   │  │ WINS │  │LOSSES│  │PLAYED│  │
 *   │  └──────┘  └──────┘  └──────┘  │
 *   │  WIN RATE  ██████░░  67%        │
 *   │  [ ✕  Close Profile ]           │
 *   └──────────────────────────────────┘
 */

import Phaser from 'phaser';
import { THEME } from '../shared/theme';
import { PowerType } from '../shared/mechanics/power-system';

// Fixed panel geometry
const PW       = 320;  // panel width
const PH_BASE  = 568;  // panel height without inventory section
const PAD      = 20;   // internal padding

// Inventory section geometry
const INV_ROW_H   = 22;  // height per chip row
const INV_COLS    = 4;   // chips per row
const INV_GAP     = 4;   // gap between chips
const INV_HDR_H   = 38;  // divider + title height

// The 21 special shell types shown in the inventory (no NONE/normal)
const INVENTORY_SHELL_TYPES = Object.values(PowerType).filter((p) => p !== PowerType.NONE);

const INV_ROWS    = Math.ceil(INVENTORY_SHELL_TYPES.length / INV_COLS);
const INV_BODY_H  = INV_ROWS * INV_ROW_H + (INV_ROWS - 1) * INV_GAP;
const INV_SECTION_H = INV_HDR_H + INV_BODY_H + 12;

// Short display labels for each shell type (PowerSidePanel has full names)
const SHELL_SHORT: Partial<Record<PowerType, string>> = {
  [PowerType.HEAVY]:    'Heavy',
  [PowerType.BOMB]:     'Bomb',
  [PowerType.SPLITTER]: 'Split',
  [PowerType.GHOST]:    'Ghost',
  [PowerType.MAGNET]:   'Magnet',
  [PowerType.SPINNING]: 'Spin',
  [PowerType.BOUNCER]:  'Bounce',
  [PowerType.SHIELD]:   'Shield',
  [PowerType.FREEZE]:   'Freeze',
  [PowerType.SLICK]:    'Slick',
  [PowerType.ROCKET]:   'Rocket',
  [PowerType.GIANT]:    'Giant',
  [PowerType.TINY]:     'Tiny',
  [PowerType.BOOMERANG]:'Boomer',
  [PowerType.REPEL]:    'Repel',
  [PowerType.STICKY]:   'Sticky',
  [PowerType.LIGHTNING]:'Bolt',
  [PowerType.VORTEX]:   'Vortex',
  [PowerType.CLONE]:    'Clone',
  [PowerType.RICOCHET]: 'Ricoch',
  [PowerType.PHANTOM]:  'Phantom',
};

const SHELL_COLOUR: Partial<Record<PowerType, number>> = {
  [PowerType.HEAVY]:    0x886633,
  [PowerType.BOMB]:     0xff6600,
  [PowerType.SPLITTER]: 0xffee00,
  [PowerType.GHOST]:    0xaaddff,
  [PowerType.MAGNET]:   0xff44cc,
  [PowerType.SPINNING]: 0x44ffcc,
  [PowerType.BOUNCER]:  0xff8800,
  [PowerType.SHIELD]:   0x44cc44,
  [PowerType.FREEZE]:   0x88ccff,
  [PowerType.SLICK]:    0xccffee,
  [PowerType.ROCKET]:   0xff3333,
  [PowerType.GIANT]:    0xcc66ff,
  [PowerType.TINY]:     0x99eeaa,
  [PowerType.BOOMERANG]:0xffcc00,
  [PowerType.REPEL]:    0xff6688,
  [PowerType.STICKY]:   0xaa8855,
  [PowerType.LIGHTNING]:0xeeff44,
  [PowerType.VORTEX]:   0x6699ff,
  [PowerType.CLONE]:    0x55dddd,
  [PowerType.RICOCHET]: 0xff9944,
  [PowerType.PHANTOM]:  0xbbbbbb,
};

// ── Rank belt mapping ─────────────────────────────────────────────────────────
function getRank(level: number): { label: string; colour: number } {
  if (level >= 30) return { label: 'Grand Kame',   colour: 0x00e5ff };
  if (level >= 20) return { label: 'Gold Shell',   colour: 0xd4a843 };
  if (level >= 10) return { label: 'Silver Fang',  colour: 0xc0c0c0 };
  if (level >= 5)  return { label: 'Bronze Claw',  colour: 0xcd7f32 };
  return              { label: 'Novice Shell', colour: 0x8b7355 };
}

export class ProfilePanel {
  private readonly scene:     Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;

  constructor(
    scene: Phaser.Scene,
    user: any,
    panelX: number,
    panelY: number,
    shellInventory?: Record<string, number>,
  ) {
    this.scene     = scene;
    this.container = scene.add.container(panelX, panelY);
    this.container.setDepth(100); // always on top
    this.build(user, shellInventory);
    this.container.setVisible(false);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  show() {
    const targetX = this.container.x;
    this.container.setX(targetX - 30).setVisible(true).setAlpha(0);
    this.scene.tweens.add({
      targets:  this.container,
      x:        targetX,
      alpha:    1,
      duration: 220,
      ease:     'Power2.easeOut',
    });
  }

  hide() {
    const startX = this.container.x;
    this.scene.tweens.add({
      targets:    this.container,
      x:          startX - 30,
      alpha:      0,
      duration:   160,
      ease:       'Power1.easeIn',
      onComplete: () => {
        this.container.setVisible(false).setX(startX);
      },
    });
  }

  toggle() {
    if (this.container.visible) this.hide(); else this.show();
  }

  isOpen() { return this.container.visible; }

  /**
   * Move the panel anchor.  Called by HubScene.applyResize() to clamp the
   * panel to the viewport when the window is narrower than 400 px.
   */
  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  destroy() { this.container.destroy(); }

  // ── Build ────────────────────────────────────────────────────────────────────

  private build(user: any, shellInventory?: Record<string, number>) {
    const PH = shellInventory ? PH_BASE + INV_SECTION_H : PH_BASE;
    const children: Phaser.GameObjects.GameObject[] = [];

    // ── 1. Panel background ───────────────────────────────────────────────────
    const bg = this.scene.add.graphics();
    // Drop shadow
    bg.fillStyle(0x000000, 0.45);
    bg.fillRoundedRect(4, 4, PW, PH, 12);
    // Panel fill
    bg.fillStyle(THEME.background, 0.97);
    bg.fillRoundedRect(0, 0, PW, PH, 12);
    // Gold outer border
    bg.lineStyle(2, THEME.gold, 0.9);
    bg.strokeRoundedRect(0, 0, PW, PH, 12);
    // Inner accent border
    bg.lineStyle(1, THEME.gold, 0.18);
    bg.strokeRoundedRect(4, 4, PW - 8, PH - 8, 9);
    children.push(bg);

    // ── 2. Turtle avatar frame ────────────────────────────────────────────────
    const avatarCX = PW / 2;
    const avatarCY = 118;
    const frameR   = 62;

    const framGfx = this.scene.add.graphics();
    // Outer glow
    framGfx.fillStyle(THEME.gold, 0.07); framGfx.fillCircle(avatarCX, avatarCY, frameR + 14);
    framGfx.fillStyle(THEME.gold, 0.12); framGfx.fillCircle(avatarCX, avatarCY, frameR + 7);
    // Frame ring
    framGfx.lineStyle(4, THEME.gold, 1);  framGfx.strokeCircle(avatarCX, avatarCY, frameR);
    // Dark inner fill (avatar background)
    framGfx.fillStyle(0x0d0a06, 1);       framGfx.fillCircle(avatarCX, avatarCY, frameR - 2);
    children.push(framGfx);

    // ── 3. Placeholder turtle art ─────────────────────────────────────────────
    children.push(...this.drawTurtlePlaceholder(avatarCX, avatarCY, frameR - 6));

    // ── 4. 42 / platform badge (bottom-right of avatar frame) ─────────────────
    const badgeX = avatarCX + Math.cos(Math.PI * 0.25) * frameR;
    const badgeY = avatarCY + Math.sin(Math.PI * 0.25) * frameR;
    const badgeGfx = this.scene.add.graphics();
    badgeGfx.fillStyle(0x1a0d3a, 1);   badgeGfx.fillCircle(badgeX, badgeY, 18);
    badgeGfx.lineStyle(2, THEME.gold, 0.9); badgeGfx.strokeCircle(badgeX, badgeY, 18);
    const badgeLabel = this.scene.add.text(badgeX, badgeY, '42', {
      fontSize: '11px', color: THEME.textGold,
      fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5);
    children.push(badgeGfx, badgeLabel);

    // ── 5. Rank belt (pill badge above player name) ───────────────────────────
    const rank      = getRank(user.level ?? 1);
    const beltY     = avatarCY + frameR + 12;
    const beltW     = 120;
    const beltH     = 20;
    const beltGfx   = this.scene.add.graphics();
    beltGfx.fillStyle(rank.colour, 0.18);
    beltGfx.fillRoundedRect(PW / 2 - beltW / 2, beltY, beltW, beltH, beltH / 2);
    beltGfx.lineStyle(1, rank.colour, 0.70);
    beltGfx.strokeRoundedRect(PW / 2 - beltW / 2, beltY, beltW, beltH, beltH / 2);
    const beltText = this.scene.add.text(PW / 2, beltY + beltH / 2, rank.label, {
      fontSize:   '10px',
      color:      Phaser.Display.Color.IntegerToColor(rank.colour).rgba,
      fontFamily: THEME.font,
      fontStyle:  'bold',
      align:      'center',
    }).setOrigin(0.5);
    children.push(beltGfx, beltText);

    // ── 6. Player name ────────────────────────────────────────────────────────
    const displayName = (user.turtleName ?? user.username ?? 'Unknown').toUpperCase();
    const nameY       = beltY + beltH + 10;
    const nameText    = this.scene.add.text(PW / 2, nameY, displayName, {
      fontSize:   '20px',
      color:      THEME.textGold,
      fontFamily: THEME.font,
      fontStyle:  'bold',
      align:      'center',
    }).setOrigin(0.5, 0);
    children.push(nameText);

    // ── 7. Level badge (gold circle beside name) ──────────────────────────────
    const nameRight  = PW / 2 + nameText.width / 2 + 10;
    const nameMidY   = nameY + 10;
    const lvlGfx = this.scene.add.graphics();
    lvlGfx.fillStyle(THEME.gold, 1);   lvlGfx.fillCircle(nameRight + 16, nameMidY, 16);
    lvlGfx.fillStyle(THEME.background, 1); lvlGfx.fillCircle(nameRight + 16, nameMidY, 13);
    lvlGfx.lineStyle(1.5, THEME.gold, 0.7); lvlGfx.strokeCircle(nameRight + 16, nameMidY, 16);
    const lvlText = this.scene.add.text(nameRight + 16, nameMidY, `${user.level ?? 1}`, {
      fontSize: '11px', color: THEME.textGold,
      fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5);
    children.push(lvlGfx, lvlText);

    // ── 8. Shell skin subtitle with hex icon ──────────────────────────────────
    const skinName  = user.shellSkin ?? 'kanagawa';
    const skinY     = nameY + 26;
    const hexColour = THEME.gold;
    const hexGfx    = this.scene.add.graphics();
    // Draw a small flat-top hexagon (6 vertices)
    const hexR  = 7;
    const hexCX = PW / 2 - 36;
    const hexCY = skinY + 7;
    hexGfx.fillStyle(hexColour, 0.85);
    hexGfx.lineStyle(1, hexColour, 1);
    const hexPoints: Phaser.Types.Math.Vector2Like[] = [];
    for (let v = 0; v < 6; v++) {
      const a = (Math.PI / 3) * v - Math.PI / 6;
      hexPoints.push({ x: hexCX + Math.cos(a) * hexR, y: hexCY + Math.sin(a) * hexR });
    }
    hexGfx.fillPoints(hexPoints, true);
    hexGfx.strokePoints(hexPoints, true);
    children.push(hexGfx);
    children.push(this.scene.add.text(PW / 2 - 24, skinY, skinName, {
      fontSize: '12px', color: THEME.textMutedHex,
      fontFamily: THEME.font, align: 'left',
    }).setOrigin(0, 0));

    // ── 8. Divider ────────────────────────────────────────────────────────────
    const div1Y = skinY + 24;
    const divGfx1 = this.scene.add.graphics();
    divGfx1.lineStyle(1, THEME.gold, 0.22);
    divGfx1.lineBetween(PAD, div1Y, PW - PAD, div1Y);
    children.push(divGfx1);

    // ── 9. XP bar ────────────────────────────────────────────────────────────
    const xpBarY  = div1Y + 14;
    const xpBarW  = PW - PAD * 2;
    const xpBarH  = 12;
    const xp      = user.xp    ?? 0;
    const xpMax   = (user.level ?? 1) * 1000;
    const xpFill  = Math.min(xp / xpMax, 1);

    children.push(this.scene.add.text(PAD, xpBarY - 14, 'XP', {
      fontSize: '10px', color: THEME.textMutedHex,
      fontFamily: THEME.font, fontStyle: 'bold',
    }));

    const xpGfx = this.scene.add.graphics();
    // Track
    xpGfx.fillStyle(0x3a2e20, 1);
    xpGfx.fillRoundedRect(PAD, xpBarY, xpBarW, xpBarH, 4);
    // Fill
    if (xpFill > 0) {
      xpGfx.fillStyle(THEME.gold, 1);
      xpGfx.fillRoundedRect(PAD, xpBarY, xpBarW * xpFill, xpBarH, 4);
    }
    // Highlight sheen
    xpGfx.fillStyle(0xffffff, 0.08);
    xpGfx.fillRoundedRect(PAD, xpBarY, xpBarW * xpFill, xpBarH / 2, 4);
    children.push(
      xpGfx,
      this.scene.add.text(PW / 2, xpBarY + xpBarH + 4, `${xp.toLocaleString()} / ${xpMax.toLocaleString()} XP`, {
        fontSize: '10px', color: THEME.text,
        fontFamily: THEME.font, align: 'center',
      }).setOrigin(0.5, 0),
    );

    // ── 10. Coins row ────────────────────────────────────────────────────────
    const coinsY = xpBarY + xpBarH + 28;
    children.push(this.scene.add.text(PAD, coinsY, `⬡  ${(user.coins ?? 0).toLocaleString()} coins`, {
      fontSize:   '13px',
      color:      THEME.textGold,
      fontFamily: THEME.font,
      fontStyle:  'bold',
    }));

    // ── 11. Divider ────────────────────────────────────────────────────────────
    const div2Y = coinsY + 24;
    const divGfx2 = this.scene.add.graphics();
    divGfx2.lineStyle(1, THEME.gold, 0.22);
    divGfx2.lineBetween(PAD, div2Y, PW - PAD, div2Y);
    children.push(divGfx2);

    // ── 12. Stats row ────────────────────────────────────────────────────────
    const statsY   = div2Y + 14;
    const profile  = user.profile ?? {};
    const stats = [
      { label: 'WINS',   value: profile.totalWins   ?? 0, colour: 0x3a5a40 },
      { label: 'LOSSES', value: profile.totalLosses ?? 0, colour: 0x5a2424 },
      { label: 'PLAYED', value: profile.gamesPlayed ?? 0, colour: 0x1a1410 },
    ];

    const slotW = (PW - PAD * 2 - 8 * 2) / 3;  // 3 equal slots
    stats.forEach((stat, i) => {
      const sx = PAD + i * (slotW + 8);
      const sg = this.scene.add.graphics();
      sg.fillStyle(stat.colour, 0.55);
      sg.fillRoundedRect(sx, statsY, slotW, 64, 6);
      sg.lineStyle(1, THEME.gold, 0.30);
      sg.strokeRoundedRect(sx, statsY, slotW, 64, 6);
      children.push(
        sg,
        this.scene.add.text(sx + slotW / 2, statsY + 14, `${stat.value}`, {
          fontSize: '20px', color: THEME.textGold,
          fontFamily: THEME.font, fontStyle: 'bold', align: 'center',
        }).setOrigin(0.5, 0),
        this.scene.add.text(sx + slotW / 2, statsY + 42, stat.label, {
          fontSize: '9px', color: THEME.textMutedHex,
          fontFamily: THEME.font, fontStyle: 'bold', align: 'center',
        }).setOrigin(0.5, 0),
      );
    });

    // ── 13. Win-rate bar OR bio placeholder ───────────────────────────────────
    const winRateY    = statsY + 78;
    const wins        = profile.totalWins   ?? 0;
    const losses      = profile.totalLosses ?? 0;
    const played      = profile.gamesPlayed ?? 0;

    if (played > 0) {
      const winFrac  = wins   / played;
      const lossFrac = losses / played;
      const barW     = PW - PAD * 2;
      const barH     = 8;

      // Label + percentage right-aligned
      const winPct = Math.round(winFrac * 100);
      children.push(this.scene.add.text(PAD, winRateY, 'WIN RATE', {
        fontSize: '9px', color: THEME.textMutedHex,
        fontFamily: THEME.font, fontStyle: 'bold',
      }).setOrigin(0, 0));
      children.push(this.scene.add.text(PW - PAD, winRateY, `${winPct}%`, {
        fontSize: '9px', color: THEME.textGold,
        fontFamily: THEME.font, fontStyle: 'bold',
      }).setOrigin(1, 0));

      const wrGfx = this.scene.add.graphics();
      // Track (grey)
      wrGfx.fillStyle(0x2a2218, 1);
      wrGfx.fillRoundedRect(PAD, winRateY + 14, barW, barH, 4);
      // Win segment (gold)
      if (winFrac > 0) {
        wrGfx.fillStyle(THEME.gold, 1);
        wrGfx.fillRoundedRect(PAD, winRateY + 14, barW * winFrac, barH, 4);
      }
      // Loss segment (red, appended after win)
      if (lossFrac > 0) {
        wrGfx.fillStyle(THEME.red, 0.85);
        wrGfx.fillRect(PAD + barW * winFrac, winRateY + 14, barW * lossFrac, barH);
      }
      // Sheen
      wrGfx.fillStyle(0xffffff, 0.06);
      wrGfx.fillRoundedRect(PAD, winRateY + 14, barW, barH / 2, 4);
      children.push(wrGfx);
    } else {
      const bioText = profile.bio ?? 'No dojo record yet.';
      children.push(this.scene.add.text(PW / 2, winRateY, `"${bioText}"`, {
        fontSize: '10px', color: THEME.textMutedHex,
        fontFamily: THEME.font, fontStyle: 'italic', align: 'center',
        wordWrap: { width: PW - PAD * 2 },
      }).setOrigin(0.5, 0));
    }

    // ── 14. Shell inventory grid (only when inventory data is available) ──────
    if (shellInventory) {
      const invStartY = winRateY + 40;

      // Divider
      const invDivGfx = this.scene.add.graphics();
      invDivGfx.lineStyle(1, THEME.gold, 0.22);
      invDivGfx.lineBetween(PAD, invStartY, PW - PAD, invStartY);
      children.push(invDivGfx);

      // Section title
      children.push(this.scene.add.text(PAD, invStartY + 8, 'SHELL INVENTORY', {
        fontSize: '10px', color: THEME.textMutedHex,
        fontFamily: THEME.font, fontStyle: 'bold',
      }));

      // Grid of shell chips
      const chipW   = Math.floor((PW - PAD * 2 - INV_GAP * (INV_COLS - 1)) / INV_COLS);
      const gridStartY = invStartY + INV_HDR_H;
      const invGfx  = this.scene.add.graphics();
      children.push(invGfx);

      INVENTORY_SHELL_TYPES.forEach((shellType, idx) => {
        const col    = idx % INV_COLS;
        const row    = Math.floor(idx / INV_COLS);
        const cx     = PAD + col * (chipW + INV_GAP);
        const cy     = gridStartY + row * (INV_ROW_H + INV_GAP);
        const colour = SHELL_COLOUR[shellType] ?? 0x888888;
        const qty    = shellInventory[shellType] ?? 0;
        const label  = SHELL_SHORT[shellType] ?? shellType;
        const isEmpty = qty <= 0;

        // Chip background
        invGfx.fillStyle(colour, isEmpty ? 0.06 : 0.14);
        invGfx.fillRoundedRect(cx, cy, chipW, INV_ROW_H, 4);
        invGfx.lineStyle(1, colour, isEmpty ? 0.20 : 0.55);
        invGfx.strokeRoundedRect(cx, cy, chipW, INV_ROW_H, 4);

        // Colour dot
        invGfx.fillStyle(colour, isEmpty ? 0.25 : 0.85);
        invGfx.fillCircle(cx + 8, cy + INV_ROW_H / 2, 3);

        // Shell name
        children.push(this.scene.add.text(cx + 14, cy + 5, label, {
          fontSize:  '8px',
          color:     isEmpty ? THEME.textMutedHex : THEME.text,
          fontFamily: THEME.font,
        }));

        // Quantity badge (right-aligned in chip)
        const qtyLabel = qty >= 999 ? '∞' : `${qty}`;
        children.push(this.scene.add.text(cx + chipW - 3, cy + 5, qtyLabel, {
          fontSize:  '8px',
          color:     isEmpty
            ? THEME.textMutedHex
            : Phaser.Display.Color.IntegerToColor(colour).rgba,
          fontFamily: THEME.font,
          fontStyle:  'bold',
          align:      'right',
        }).setOrigin(1, 0));
      });
    }

    // ── 15. Close button ──────────────────────────────────────────────────────
    const closeBtnY = PH - 38;
    const closeGfx  = this.scene.add.graphics();
    const paintClose = (hovered: boolean) => {
      closeGfx.clear();
      closeGfx.fillStyle(hovered ? THEME.gold : 0x2a2218, 0.9);
      closeGfx.fillRoundedRect(PAD, closeBtnY, PW - PAD * 2, 26, 5);
      closeGfx.lineStyle(1, THEME.gold, hovered ? 0 : 0.40);
      closeGfx.strokeRoundedRect(PAD, closeBtnY, PW - PAD * 2, 26, 5);
    };
    paintClose(false);

    const closeHit = this.scene.add
      .rectangle(PW / 2, closeBtnY + 13, PW - PAD * 2, 26, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    const closeTxt = this.scene.add.text(PW / 2, closeBtnY + 13, '✕  Close Profile', {
      fontSize: '13px', color: THEME.text,
      fontFamily: THEME.font, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5);

    closeHit.on('pointerover', () => { paintClose(true);  closeTxt.setColor('#1a1410'); });
    closeHit.on('pointerout',  () => { paintClose(false); closeTxt.setColor(THEME.text); });
    closeHit.on('pointerup',   () => this.hide());
    children.push(closeGfx, closeHit, closeTxt);

    // ── Add all children to container ─────────────────────────────────────────
    this.container.add(children);
  }

  // ── Turtle placeholder art ───────────────────────────────────────────────────
  //
  // Draws a top-down sumo turtle: oval shell body with hex grid pattern,
  // a head circle at the top, and two small flipper ellipses on the sides.
  // All colours use the Japanese palette — no external assets needed.

  private drawTurtlePlaceholder(
    cx: number, cy: number, radius: number,
  ): Phaser.GameObjects.Graphics[] {
    const g = this.scene.add.graphics();

    // ── Shell body (dark olive ellipse) ─────────────────────────────────────
    const shellW = radius * 1.15;
    const shellH = radius * 0.85;
    g.fillStyle(0x2a4d12, 1);
    g.fillEllipse(cx, cy + 6, shellW, shellH);

    // ── Shell highlight rim ──────────────────────────────────────────────────
    g.lineStyle(2.5, 0x3d6a1e, 0.85);
    g.strokeEllipse(cx, cy + 6, shellW, shellH);

    // ── Hex pattern on shell (6 small diamond lines) ─────────────────────────
    g.lineStyle(1, 0x1a3008, 0.65);
    const gridLines = [
      // vertical centre
      { x1: cx,            y1: cy - shellH * 0.35, x2: cx,            y2: cy + shellH * 0.35 + 6 },
      // left diagonal
      { x1: cx - shellW * 0.30, y1: cy - shellH * 0.20, x2: cx - shellW * 0.02, y2: cy + shellH * 0.40 + 6 },
      { x1: cx + shellW * 0.30, y1: cy - shellH * 0.20, x2: cx + shellW * 0.02, y2: cy + shellH * 0.40 + 6 },
      // horizontal bands
      { x1: cx - shellW * 0.40, y1: cy - 4, x2: cx + shellW * 0.40, y2: cy - 4 },
      { x1: cx - shellW * 0.32, y1: cy + 14, x2: cx + shellW * 0.32, y2: cy + 14 },
    ];
    gridLines.forEach(({ x1, y1, x2, y2 }) => g.lineBetween(x1, y1, x2, y2));

    // ── Head ─────────────────────────────────────────────────────────────────
    const headR = radius * 0.26;
    g.fillStyle(0x4a7c25, 1);
    g.fillCircle(cx, cy - shellH * 0.43, headR);
    // Head outline
    g.lineStyle(1.5, 0x3d6a1e, 0.8);
    g.strokeCircle(cx, cy - shellH * 0.43, headR);

    // ── Eyes ─────────────────────────────────────────────────────────────────
    const eyeY = cy - shellH * 0.43 - 3;
    g.fillStyle(0xffffff, 0.9); g.fillCircle(cx - 6, eyeY, 4);
    g.fillStyle(0xffffff, 0.9); g.fillCircle(cx + 6, eyeY, 4);
    g.fillStyle(0x111111, 1);   g.fillCircle(cx - 5, eyeY, 2);
    g.fillStyle(0x111111, 1);   g.fillCircle(cx + 7, eyeY, 2);
    // Eye shine
    g.fillStyle(0xffffff, 0.8); g.fillCircle(cx - 4, eyeY - 1, 1);
    g.fillStyle(0xffffff, 0.8); g.fillCircle(cx + 8, eyeY - 1, 1);

    // ── Flippers (left + right) ──────────────────────────────────────────────
    g.fillStyle(0x3d6a1e, 0.85);
    g.fillEllipse(cx - shellW * 0.60, cy + 4, radius * 0.35, radius * 0.18);
    g.fillEllipse(cx + shellW * 0.60, cy + 4, radius * 0.35, radius * 0.18);

    return [g];
  }
}
