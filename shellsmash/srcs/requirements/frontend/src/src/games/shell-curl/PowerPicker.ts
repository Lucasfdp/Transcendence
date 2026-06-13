/**
 * game/shell-curl/PowerPicker.ts — power selection widget for Shell Curl.
 *
 * Displays a horizontal row of power tokens at the bottom of the screen.
 * Shown only during phase === 'aiming'; hidden at all other times.
 *
 * Selection changes redraw only the affected token backgrounds — the row
 * itself is never rebuilt while visible.
 */

import Phaser from 'phaser';
import { PowerType, PowerRegistry } from '../../shared/mechanics/power-system';
import { THEME } from '../../shared/theme';

// ── Layout constants ──────────────────────────────────────────────────────────

const TOKEN_W     = 46;
const TOKEN_H     = 46;
const TOKEN_GAP   = 8;
const TOKEN_PAD_B = 20;
const LABEL_H     = 18;
const CORNER_R    = 7;
const HOVER_SCALE = 1.10;
const SEL_SCALE   = 1.12;

// ── Internal token record ─────────────────────────────────────────────────────

interface TokenRecord {
  type:         PowerType;
  accentColour: number;
  bg:           Phaser.GameObjects.Graphics;
  x:            number;
  y:            number;
}

// ── PowerPicker ───────────────────────────────────────────────────────────────

export class PowerPicker {
  private readonly container: Phaser.GameObjects.Container;
  private selected: PowerType  = PowerType.NONE;
  private visible              = false;
  private tokens: TokenRecord[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly registry: PowerRegistry,
    depth = 20,
  ) {
    this.container = scene.add.container(0, 0).setDepth(depth).setVisible(false);
  }

  /** Show the picker with the given subset of powers. */
  show(availablePowers: PowerType[]): void {
    this.container.removeAll(true);
    this.tokens  = [];
    this.selected = PowerType.NONE;

    const count  = Math.min(availablePowers.length, 12);
    const totalW = count * TOKEN_W + (count - 1) * TOKEN_GAP;
    const startX = (this.scene.scale.width - totalW) / 2;
    const baseY  = this.scene.scale.height - TOKEN_H - LABEL_H - TOKEN_PAD_B;

    for (let i = 0; i < count; i++) {
      const type = availablePowers[i];
      const def  = this.registry.get(type);
      const tx   = startX + i * (TOKEN_W + TOKEN_GAP);
      this.buildToken(type, def.accentColour, def.label, tx, baseY, i === 0);
    }

    this.container.setVisible(true);
    this.visible = true;
  }

  hide(): void {
    this.container.setVisible(false);
    this.visible = false;
  }

  getSelected(): PowerType {
    return this.selected;
  }

  destroy(): void {
    this.container.destroy(true);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private buildToken(
    type: PowerType,
    accentColour: number,
    label: string,
    x: number,
    y: number,
    autoSelect: boolean,
  ): void {
    const isSelected = autoSelect || type === this.selected;

    // Background rect
    const bg = this.scene.add.graphics();
    this.drawTokenBg(bg, x, y, accentColour, isSelected);
    this.container.add(bg);

    // Power icon
    const icon = this.scene.add.graphics();
    this.drawPowerIcon(icon, type, x + TOKEN_W / 2, y + TOKEN_H / 2 - 2, accentColour);
    this.container.add(icon);

    // Label — wrap after the first word so two-word names stack neatly
    const wrappedLabel = label.replace(' ', '\n');
    const txt = this.scene.add
      .text(x + TOKEN_W / 2, y + TOKEN_H + 4, wrappedLabel, {
        fontSize: '9px',
        color: THEME.text,
        fontFamily: THEME.font,
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5, 0);
    this.container.add(txt);

    // Store record for in-place selection redraws
    const record: TokenRecord = { type, accentColour, bg, x, y };
    this.tokens.push(record);

    // Hit zone
    const zone = this.scene.add
      .zone(x + TOKEN_W / 2, y + TOKEN_H / 2, TOKEN_W, TOKEN_H)
      .setInteractive({ useHandCursor: true });

    zone.on('pointerover', () => {
      if (type !== this.selected) {
        this.scene.tweens.add({ targets: bg, scaleX: HOVER_SCALE, scaleY: HOVER_SCALE, duration: 80 });
      }
    });
    zone.on('pointerout', () => {
      if (type !== this.selected) {
        this.scene.tweens.add({ targets: bg, scaleX: 1, scaleY: 1, duration: 80 });
      }
    });
    zone.on('pointerup', () => {
      if (type === this.selected) return; // already selected — no-op
      this.selectToken(type);
    });

    this.container.add(zone);

    if (isSelected || autoSelect) {
      this.selected = type;
      bg.setScale(SEL_SCALE);
    }
  }

  /**
   * Update selection in-place — only redraws the two affected token backgrounds.
   * The row stays intact; no container rebuild.
   */
  private selectToken(type: PowerType): void {
    const prev = this.selected;
    this.selected = type;

    for (const rec of this.tokens) {
      if (rec.type === prev || rec.type === type) {
        const sel = rec.type === type;
        this.drawTokenBg(rec.bg, rec.x, rec.y, rec.accentColour, sel);
        this.scene.tweens.add({
          targets: rec.bg,
          scaleX: sel ? SEL_SCALE : 1,
          scaleY: sel ? SEL_SCALE : 1,
          duration: 90,
        });
      }
    }
  }

  private drawTokenBg(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    accentColour: number,
    selected: boolean,
  ): void {
    g.clear();
    g.fillStyle(0x0d1a0d, 0.92);
    g.fillRoundedRect(x, y, TOKEN_W, TOKEN_H, CORNER_R);

    if (selected) {
      g.fillStyle(accentColour, 0.20);
      g.fillRoundedRect(x, y, TOKEN_W, TOKEN_H, CORNER_R);
      g.lineStyle(2, 0xd4a843, 1);
    } else {
      g.lineStyle(1.5, accentColour, 0.70);
    }
    g.strokeRoundedRect(x, y, TOKEN_W, TOKEN_H, CORNER_R);
  }

  private drawPowerIcon(
    g: Phaser.GameObjects.Graphics,
    type: PowerType,
    cx: number,
    cy: number,
    colour: number,
  ): void {
    g.clear();
    const u = 7;

    g.lineStyle(2, colour, 0.9);
    g.fillStyle(colour, 0.85);

    switch (type) {
      case PowerType.NONE:
        g.strokeCircle(cx, cy, u * 1.2);
        g.lineBetween(cx - u, cy + u, cx + u, cy - u);
        break;

      case PowerType.HEAVY:
        g.fillCircle(cx, cy, u * 1.3);
        break;

      case PowerType.BOMB:
        g.fillCircle(cx, cy + u * 0.3, u);
        g.lineStyle(2, colour, 0.9);
        g.lineBetween(cx + u * 0.7, cy - u * 0.3, cx + u * 1.4, cy - u * 1.2);
        break;

      case PowerType.SPLITTER:
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
          g.fillCircle(cx + Math.cos(a) * u, cy + Math.sin(a) * u, u * 0.45);
        }
        break;

      case PowerType.GHOST:
        for (let i = 0; i < 8; i++) {
          if (i % 2 === 0) {
            const a0 = (i / 8) * Math.PI * 2;
            const a1 = ((i + 0.7) / 8) * Math.PI * 2;
            g.beginPath();
            g.arc(cx, cy, u * 1.1, a0, a1, false);
            g.strokePath();
          }
        }
        break;

      case PowerType.MAGNET:
        g.beginPath();
        g.arc(cx, cy + u * 0.2, u, Math.PI, 0, false);
        g.strokePath();
        g.lineBetween(cx - u, cy + u * 0.2, cx - u, cy + u * 1.1);
        g.lineBetween(cx + u, cy + u * 0.2, cx + u, cy + u * 1.1);
        break;

      case PowerType.SPINNING:
        for (let i = 0; i < 3; i++) {
          const r  = u * (0.4 + i * 0.35);
          const a0 = -Math.PI * 0.3 + i * 0.6;
          const a1 = a0 + Math.PI * 1.5;
          g.beginPath();
          g.arc(cx, cy, r, a0, a1, false);
          g.strokePath();
        }
        break;

      case PowerType.BOUNCER:
        g.lineBetween(cx - u * 1.2, cy, cx - u * 0.3, cy - u);
        g.lineBetween(cx - u * 0.3, cy - u, cx + u * 0.5, cy + u);
        g.lineBetween(cx + u * 0.5, cy + u, cx + u * 1.2, cy);
        break;

      case PowerType.SHIELD:
        g.beginPath();
        g.moveTo(cx, cy - u * 1.2);
        g.lineTo(cx + u, cy - u * 0.5);
        g.lineTo(cx + u, cy + u * 0.3);
        g.lineTo(cx, cy + u * 1.2);
        g.lineTo(cx - u, cy + u * 0.3);
        g.lineTo(cx - u, cy - u * 0.5);
        g.closePath();
        g.strokePath();
        break;

      case PowerType.FREEZE:
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.lineBetween(cx, cy, cx + Math.cos(a) * u * 1.2, cy + Math.sin(a) * u * 1.2);
        }
        break;

      case PowerType.SLICK:
        for (let i = -1; i <= 1; i++) {
          const off = i * u * 0.5;
          g.lineBetween(cx - u * 1.2, cy + off, cx + u * 1.2, cy + off);
        }
        break;
    }
  }
}
