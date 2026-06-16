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

// Collapsible drop-down geometry — used when the viewport is too small/zoomed to
// dock the panel beside the arena. Anchored to a screen edge below the top HUD.
const COLLAPSE_W   = 200;
const COLLAPSE_TOP = 74;
const EDGE_PAD     = 12;

export class SidePanel {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly texts: Phaser.GameObjects.Text[] = [];
  private readonly zones: Phaser.GameObjects.Zone[] = [];

  // Collapsible (drop-down) mode state. `collapsed` persists across rebuilds.
  private collapsible = false;
  private collapsed   = true;
  private side: 'left' | 'right' = 'right';
  private lastConfig: SidePanelConfig | null = null;

  // Scroll window over the log rows when there are more than fit above the footer.
  private rect: PanelRect | null = null;
  private scrollRow              = 0;
  private maxScrollRows          = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth = 20,
  ) {
    this.gfx = scene.add.graphics().setDepth(depth);
    this.scene.input.on('wheel', this.onWheel, this);
  }

  /** Mouse-wheel over the panel scrolls the log window when it overflows. */
  private onWheel(
    pointer: Phaser.Input.Pointer, _objs: Phaser.GameObjects.GameObject[], _dx: number, deltaY: number,
  ): void {
    if (this.maxScrollRows <= 0 || !this.rect || !this.lastConfig) return;
    const r = this.rect;
    // pointer.x/y are screen-space; the rect is world-space. Under camera zoom
    // they diverge, so transform through the camera before the bounds test.
    const p = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (p.x < r.x || p.x > r.x + r.width || p.y < r.y || p.y > r.y + r.height) return;
    const next = Phaser.Math.Clamp(this.scrollRow + (deltaY > 0 ? 1 : -1), 0, this.maxScrollRows);
    if (next !== this.scrollRow) {
      this.scrollRow = next;
      this.render(this.lastConfig);
    }
  }

  /** Dock the panel at an explicit rect (normal, room-permitting layout). */
  update(config: SidePanelConfig): void {
    this.collapsible = false;
    this.render(config);
  }

  /**
   * Show the panel as a collapsible drop-down anchored to a screen edge — used
   * when the viewport is too small/zoomed to dock the panel beside the arena.
   * Renders a slim "<title> ▾" header; clicking it drops the full panel down.
   */
  updateCollapsible(side: 'left' | 'right', config: Omit<SidePanelConfig, 'rect'>): void {
    this.collapsible = true;
    this.side = side;
    this.render({ ...config, rect: this.collapsibleRect() });
  }

  private render(config: SidePanelConfig): void {
    this.lastConfig = config;
    this.rect = config.rect;
    this.maxScrollRows = 0;  // recomputed in drawRows; stays 0 when collapsed
    this.clearObjects();
    this.drawFrame(config.rect);
    this.drawTitle(config.title, config.rect);
    if (!(this.collapsible && this.collapsed)) {
      this.drawRows(config.rows, config.rect, config.footerRows ?? []);
    }
  }

  private collapsibleRect(): PanelRect {
    const sw = this.scene.scale.width;
    const sh = this.scene.scale.height;
    const w  = Math.min(COLLAPSE_W, sw - EDGE_PAD * 2);
    const x  = this.side === 'left' ? EDGE_PAD : sw - EDGE_PAD - w;
    const headerH = PAD + TITLE_H;
    const height  = this.collapsed ? headerH : Math.max(headerH, sh - COLLAPSE_TOP - EDGE_PAD);
    return { x, y: COLLAPSE_TOP, width: w, height };
  }

  destroy(): void {
    this.scene.input.off('wheel', this.onWheel, this);
    this.clearObjects();
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

    // Collapsible header: chevron + a click-zone over the title strip that
    // toggles the panel open/closed. When collapsed we draw only this strip.
    if (this.collapsible) {
      const chev = this.scene.add.text(
        rect.x + rect.width - PAD - 12, rect.y + PAD - 2, this.collapsed ? '▾' : '▴',
        { fontSize: '14px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold' },
      ).setDepth(this.depth + 1);
      this.texts.push(chev);

      const toggle = this.scene.add.zone(rect.x, rect.y, rect.width, PAD + TITLE_H)
        .setOrigin(0, 0).setInteractive({ useHandCursor: true }).setDepth(this.depth + 2);
      toggle.on('pointerup', () => {
        this.collapsed = !this.collapsed;
        if (this.lastConfig) this.render({ ...this.lastConfig, rect: this.collapsibleRect() });
      });
      this.zones.push(toggle);

      if (this.collapsed) return;
    }

    this.gfx.lineStyle(1, THEME.gold, 0.25);
    this.gfx.lineBetween(rect.x + PAD, rect.y + PAD + TITLE_H, rect.x + rect.width - PAD, rect.y + PAD + TITLE_H);
  }

  private drawRows(rows: SidePanelRow[], rect: PanelRect, footerRows: SidePanelRow[]): void {
    const startY = rect.y + PAD + TITLE_H + 18;
    const footerReserve = footerRows.length > 0 ? footerRows.length * ROW_H + 18 : 0;
    const visibleRows = Math.max(0, Math.floor((rect.height - PAD - TITLE_H - 20 - footerReserve) / ROW_H));

    // Scrollable window (mouse-wheel over the panel) when there are more rows
    // than fit above the footer.
    this.maxScrollRows = Math.max(0, rows.length - visibleRows);
    this.scrollRow = Phaser.Math.Clamp(this.scrollRow, 0, this.maxScrollRows);

    rows.slice(this.scrollRow, this.scrollRow + visibleRows).forEach((row, index) => {
      const y = startY + index * ROW_H;
      this.drawRow(row, rect, y);
    });

    if (this.maxScrollRows > 0 && visibleRows > 0) {
      const barTop = startY - 4;
      const barH   = visibleRows * ROW_H;
      const barX   = rect.x + rect.width - 7;
      this.gfx.fillStyle(0xffffff, 0.07);
      this.gfx.fillRoundedRect(barX, barTop, 3, barH, 1.5);
      const thumbH = Math.max(16, barH * (visibleRows / rows.length));
      const thumbY = barTop + (barH - thumbH) * (this.scrollRow / this.maxScrollRows);
      this.gfx.fillStyle(THEME.gold, 0.55);
      this.gfx.fillRoundedRect(barX, thumbY, 3, thumbH, 1.5);
    }

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

  private clearObjects(): void {
    for (const text of this.texts) text.destroy();
    this.texts.length = 0;
    for (const zone of this.zones) zone.destroy();
    this.zones.length = 0;
  }
}
