/**
 * game/shell-curl/PowerPicker.ts — power selection widget for Shell Curl.
 *
 * Displays a horizontal row of up to 5 power tokens at the bottom of the
 * screen. Shown only during phase === 'aiming'; hidden at all other times.
 */

import Phaser from 'phaser';
import { PowerType, PowerRegistry } from '../mechanics/power-system';
import { THEME } from '../../hub/theme';

// ── Layout constants ──────────────────────────────────────────────────────────

const TOKEN_W     = 52;  // width of each token
const TOKEN_H     = 52;  // height of each token
const TOKEN_GAP   = 14;  // gap between tokens
const TOKEN_PAD_B = 20;  // padding from bottom of screen
const LABEL_H     = 18;  // space below token for label text
const CORNER_R    = 8;   // rounded rect corner radius
const HOVER_SCALE = 1.10;
const SEL_SCALE   = 1.12;

// ── PowerPicker ───────��──────────────────────────────��────────────────────────

export class PowerPicker {
  private readonly container: Phaser.GameObjects.Container;
  private selected: PowerType = PowerType.NONE;
  private visible  = false;

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
    this.selected = PowerType.NONE;

    const count  = Math.min(availablePowers.length, 5);
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

  // ── Private ──────────────────────────────────────────────────────────────────

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

    // Small power icon (simple geometry per type)
    const icon = this.scene.add.graphics();
    this.drawPowerIcon(icon, type, x + TOKEN_W / 2, y + TOKEN_H / 2 - 2, accentColour);
    this.container.add(icon);

    // Label text
    const txt = this.scene.add
      .text(x + TOKEN_W / 2, y + TOKEN_H + 4, label, {
        fontSize: '9px',
        color: THEME.text,
        fontFamily: THEME.font,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    this.container.add(txt);

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
      this.selected = type;
      // Redraw all tokens to reflect new selection
      const types = this.container.getAll()
        .filter(o => (o as Phaser.GameObjects.Zone).type === 'Zone')
        .map((_, idx) => idx); // simplified — re-show with current types
      // Full rebuild on selection change:
      const available = this.registry.available().map(d => d.type);
      this.show(available);
      this.selected = type; // re-set after rebuild
    });

    this.container.add(zone);

    if (isSelected || autoSelect) {
      this.selected = type;
      bg.setScale(SEL_SCALE);
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

    // Fill
    g.fillStyle(0x0d1a0d, 0.92);
    g.fillRoundedRect(x, y, TOKEN_W, TOKEN_H, CORNER_R);

    if (selected) {
      // Gold border + light accent fill
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
    const u = 7; // unit size for icon geometry

    g.lineStyle(2, colour, 0.9);
    g.fillStyle(colour, 0.85);

    switch (type) {
      case PowerType.NONE:
        // Circle with line through it
        g.strokeCircle(cx, cy, u * 1.2);
        g.lineBetween(cx - u, cy + u, cx + u, cy - u);
        break;

      case PowerType.HEAVY:
        // Bold filled circle (heavy weight symbol)
        g.fillCircle(cx, cy, u * 1.3);
        break;

      case PowerType.BOMB:
        // Circle with fuse line
        g.fillCircle(cx, cy + u * 0.3, u);
        g.lineStyle(2, colour, 0.9);
        g.lineBetween(cx + u * 0.7, cy - u * 0.3, cx + u * 1.4, cy - u * 1.2);
        break;

      case PowerType.SPLITTER:
        // Triangle of 3 small circles
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
          g.fillCircle(cx + Math.cos(a) * u, cy + Math.sin(a) * u, u * 0.45);
        }
        break;

      case PowerType.GHOST:
        // Dashed circle
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
        // U-shape
        g.beginPath();
        g.arc(cx, cy + u * 0.2, u, Math.PI, 0, false);
        g.strokePath();
        g.lineBetween(cx - u, cy + u * 0.2, cx - u, cy + u * 1.1);
        g.lineBetween(cx + u, cy + u * 0.2, cx + u, cy + u * 1.1);
        break;

      case PowerType.SPINNING:
        // Spiral arc
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
        // Zigzag line
        g.lineBetween(cx - u * 1.2, cy, cx - u * 0.3, cy - u);
        g.lineBetween(cx - u * 0.3, cy - u, cx + u * 0.5, cy + u);
        g.lineBetween(cx + u * 0.5, cy + u, cx + u * 1.2, cy);
        break;

      case PowerType.SHIELD:
        // Shield shape
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
        // Snowflake
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.lineBetween(cx, cy, cx + Math.cos(a) * u * 1.2, cy + Math.sin(a) * u * 1.2);
        }
        break;

      case PowerType.SLICK:
        // Speed lines
        for (let i = -1; i <= 1; i++) {
          const off = i * u * 0.5;
          g.lineBetween(cx - u * 1.2, cy + off, cx + u * 1.2, cy + off);
        }
        break;
    }
  }
}
