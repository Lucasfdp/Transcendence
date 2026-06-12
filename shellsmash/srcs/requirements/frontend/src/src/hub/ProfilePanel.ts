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
 * Layout (panel is 320 × 490, anchored 16px from top-left below the HUD):
 *
 *   ┌──────────────────────────────────┐
 *   │  ╔══════════════╗  [level badge] │
 *   │  ║  TURTLE ART  ║               │
 *   │  ╚══════════════╝  [42 badge]   │
 *   │  KAMEGORO                       │
 *   │  Shell: kanagawa                │
 *   │  ─────────────────────────────  │
 *   │  XP ██████████░░░  1250/2000    │
 *   │  ─────────────────────────────  │
 *   │  ┌──────┐  ┌──────┐  ┌──────┐  │
 *   │  │ WINS │  │LOSSES│  │PLAYED│  │
 *   │  └──────┘  └──────┘  └──────┘  │
 *   │  [ ✕  Close Profile ]           │
 *   └──────────────────────────────────┘
 */

import Phaser from 'phaser';
import { THEME } from './theme';

// Fixed panel geometry
const PW  = 320;  // panel width
const PH  = 490;  // panel height
const PAD = 20;   // internal padding

export class ProfilePanel {
  private readonly scene:     Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, user: any, panelX: number, panelY: number) {
    this.scene     = scene;
    this.container = scene.add.container(panelX, panelY);
    this.container.setDepth(100); // always on top
    this.build(user);
    this.container.setVisible(false);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  show() {
    this.container.setVisible(true).setAlpha(0);
    this.scene.tweens.add({
      targets: this.container, alpha: 1, duration: 200, ease: 'Power2',
    });
  }

  hide() {
    this.scene.tweens.add({
      targets:    this.container,
      alpha:      0,
      duration:   150,
      ease:       'Power1',
      onComplete: () => this.container.setVisible(false),
    });
  }

  toggle() {
    if (this.container.visible) this.hide(); else this.show();
  }

  isOpen() { return this.container.visible; }

  destroy() { this.container.destroy(); }

  // ── Build ────────────────────────────────────────────────────────────────────

  private build(user: any) {
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

    // ── 5. Player name ────────────────────────────────────────────────────────
    const displayName = (user.turtleName ?? user.username ?? 'Unknown').toUpperCase();
    const nameText = this.scene.add.text(PW / 2, avatarCY + frameR + 18, displayName, {
      fontSize:   '20px',
      color:      THEME.textGold,
      fontFamily: THEME.font,
      fontStyle:  'bold',
      align:      'center',
    }).setOrigin(0.5, 0);
    children.push(nameText);

    // ── 6. Level badge (gold circle beside name) ──────────────────────────────
    const nameRight  = PW / 2 + nameText.width / 2 + 10;
    const nameMidY   = avatarCY + frameR + 18 + 10;
    const lvlGfx = this.scene.add.graphics();
    lvlGfx.fillStyle(THEME.gold, 1);   lvlGfx.fillCircle(nameRight + 16, nameMidY, 16);
    lvlGfx.fillStyle(THEME.background, 1); lvlGfx.fillCircle(nameRight + 16, nameMidY, 13);
    lvlGfx.lineStyle(1.5, THEME.gold, 0.7); lvlGfx.strokeCircle(nameRight + 16, nameMidY, 16);
    const lvlText = this.scene.add.text(nameRight + 16, nameMidY, `${user.level ?? 1}`, {
      fontSize: '11px', color: THEME.textGold,
      fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5);
    children.push(lvlGfx, lvlText);

    // ── 7. Shell skin subtitle ────────────────────────────────────────────────
    const skinY = avatarCY + frameR + 44;
    children.push(this.scene.add.text(PW / 2, skinY, `⬡  ${user.shellSkin ?? 'kanagawa'}`, {
      fontSize: '12px', color: THEME.textMutedHex,
      fontFamily: THEME.font, align: 'center',
    }).setOrigin(0.5, 0));

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

    // ── 10. Divider ────────────────────────────────────────────────────────────
    const div2Y = xpBarY + xpBarH + 26;
    const divGfx2 = this.scene.add.graphics();
    divGfx2.lineStyle(1, THEME.gold, 0.22);
    divGfx2.lineBetween(PAD, div2Y, PW - PAD, div2Y);
    children.push(divGfx2);

    // ── 11. Stats row ────────────────────────────────────────────────────────
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

    // ── 12. Bio / placeholder text ────────────────────────────────────────────
    const bioY = statsY + 78;
    const bioText = profile.bio ?? 'No dojo record yet.';
    children.push(this.scene.add.text(PW / 2, bioY, `"${bioText}"`, {
      fontSize: '10px', color: THEME.textMutedHex,
      fontFamily: THEME.font, fontStyle: 'italic', align: 'center',
      wordWrap: { width: PW - PAD * 2 },
    }).setOrigin(0.5, 0));

    // ── 13. Close button ──────────────────────────────────────────────────────
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
