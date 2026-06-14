/**
 * shared/ui/panels/side-panel.ts — reusable Phaser side panel widget.
 */

import Phaser from 'phaser';
import { THEME } from '../../theme';

export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SidePanelRow {
  label: string;
  value?: string;
  /** Two-line layout: rendered below the label in smaller muted text. Mutually exclusive with value. */
  subtitle?: string;
  muted?: boolean;
  labelColor?: string;
  valueColor?: string;
  labelFontSize?: string;
  valueFontSize?: string;
  icon?: (gfx: Phaser.GameObjects.Graphics, x: number, y: number, size: number) => void;
}

export interface SidePanelConfig {
  title: string;
  rect: PanelRect;
  rows: SidePanelRow[];
  footerRows?: SidePanelRow[];
}

const PAD = 14;
const VALUE_PAD = 24;
const TITLE_H = 30;
const ROW_H = 38;
const ICON_SIZE = 24;

export class SidePanel {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly texts: Phaser.GameObjects.Text[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth = 20,
  ) {
    this.gfx = scene.add.graphics().setDepth(depth);
  }

  update(config: SidePanelConfig): void {
    this.clearTexts();
    this.drawFrame(config.rect);
    this.drawTitle(config.title, config.rect);
    this.drawRows(config.rows, config.rect, config.footerRows ?? []);
  }

  destroy(): void {
    this.clearTexts();
    this.gfx.destroy();
  }

  private drawFrame(rect: PanelRect): void {
    this.gfx.clear();
    this.gfx.fillStyle(0x0a1208, 0.88);
    this.gfx.fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 12);
    this.gfx.lineStyle(1.5, THEME.gold, 0.65);
    this.gfx.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 12);
  }

  private drawTitle(title: string, rect: PanelRect): void {
    const text = this.scene.add.text(rect.x + PAD, rect.y + PAD - 2, title, {
      fontSize: '14px',
      color: THEME.textGold,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setDepth(this.depth + 1);
    this.texts.push(text);

    this.gfx.lineStyle(1, THEME.gold, 0.25);
    this.gfx.lineBetween(rect.x + PAD, rect.y + PAD + TITLE_H, rect.x + rect.width - PAD, rect.y + PAD + TITLE_H);
  }

  private drawRows(rows: SidePanelRow[], rect: PanelRect, footerRows: SidePanelRow[]): void {
    const startY = rect.y + PAD + TITLE_H + 18;
    const footerReserve = footerRows.length > 0 ? footerRows.length * ROW_H + 18 : 0;
    const maxRows = Math.max(0, Math.floor((rect.height - PAD - TITLE_H - 20 - footerReserve) / ROW_H));

    rows.slice(0, maxRows).forEach((row, index) => {
      const y = startY + index * ROW_H;
      this.drawRow(row, rect, y);
    });

    if (footerRows.length === 0) return;

    const footerStartY = rect.y + rect.height - PAD - footerRows.length * ROW_H;
    this.gfx.lineStyle(1, THEME.gold, 0.25);
    this.gfx.lineBetween(rect.x + PAD, footerStartY - 12, rect.x + rect.width - PAD, footerStartY - 12);

    footerRows.forEach((row, index) => this.drawRow(row, rect, footerStartY + index * ROW_H));
  }

  private drawRow(row: SidePanelRow, rect: PanelRect, y: number): void {
    const iconX = rect.x + PAD + ICON_SIZE / 2;
    const textX = row.icon ? rect.x + PAD + ICON_SIZE + 10 : rect.x + PAD;
    const valueX = rect.x + rect.width - VALUE_PAD;
    const labelColor = row.muted ? THEME.textMutedHex : row.labelColor ?? THEME.text;
    const valueColor = row.muted ? THEME.textMutedHex : row.valueColor ?? THEME.textGold;

    if (row.icon) row.icon(this.gfx, iconX, y + ICON_SIZE / 2, ICON_SIZE);

    const label = this.scene.add.text(textX, y + 2, row.label, {
      fontSize: row.labelFontSize ?? '12px',
      color: labelColor,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setDepth(this.depth + 1);
    this.texts.push(label);

    // Two-line layout: subtitle replaces right-side value
    if (row.subtitle) {
      const sub = this.scene.add.text(textX, y + 17, row.subtitle, {
        fontSize: '10px',
        color: THEME.textMutedHex,
        fontFamily: THEME.font,
      }).setDepth(this.depth + 1);
      this.texts.push(sub);
      return;
    }

    if (!row.value) return;

    const value = this.scene.add.text(valueX, y + 2, row.value, {
      fontSize: row.valueFontSize ?? '12px',
      color: valueColor,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(this.depth + 1);
    this.texts.push(value);
  }

  private clearTexts(): void {
    for (const text of this.texts) text.destroy();
    this.texts.length = 0;
  }
}
