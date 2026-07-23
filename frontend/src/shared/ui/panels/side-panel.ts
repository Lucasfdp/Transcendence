/**
 * shared/ui/panels/side-panel.ts — reusable Phaser side panel widget.
 *
 * Performance (Phase 7, Wave C): the panel keeps a positional pool of Text
 * objects and updates them in place instead of destroying and recreating every
 * text object whenever a row value changes. Each render acquires text slots in
 * a stable order (title, chevron, visible rows, footer rows); a per-slot
 * descriptor cache skips all Phaser setters — and therefore the underlying
 * canvas-texture regeneration — for slots whose content and style did not
 * change. Surplus slots are hidden rather than freed, so a busy in-game panel
 * (scores, timers, event log) no longer churns the GPU/text texture cache or
 * the JS heap on every update. The vector frame is a single retained Graphics
 * object, and the collapse toggle is one retained interactive Zone.
 */

import Phaser from "phaser";
import { THEME } from "../../theme";

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
	icon?: (
		gfx: Phaser.GameObjects.Graphics,
		x: number,
		y: number,
		size: number,
	) => void;
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
const COLLAPSE_W = 200;
const COLLAPSE_TOP = 74;
const EDGE_PAD = 12;

const TITLE_SHADOW = "rgba(5, 28, 18, 0.78)";
const LABEL_SHADOW = "rgba(8, 18, 11, 0.65)";

/** Text style plus placement, used to build a stable per-slot descriptor key. */
interface TextSlotSpec {
	content: string;
	x: number;
	y: number;
	originX: number;
	originY: number;
	color: string;
	fontSize: string;
	fontFamily: string;
	fontStyle: string;
	depth: number;
	shadow: string | null;
}

export class SidePanel {
	private readonly gfx: Phaser.GameObjects.Graphics;

	// Positional Text pool. Slots are acquired in a stable order every render;
	// `slotCache[i]` holds the descriptor last applied to `textPool[i]` so an
	// unchanged slot performs no Phaser work at all.
	private readonly textPool: Phaser.GameObjects.Text[] = [];
	private readonly slotCache: (string | null)[] = [];
	private poolCursor = 0;

	// Single retained collapse toggle. Its pointer handler is attached once and
	// reads the current panel state through `this`, so re-rendering only moves
	// and resizes the zone rather than re-subscribing input.
	private toggleZone: Phaser.GameObjects.Zone | null = null;

	// Collapse state. The panel can be collapsed to its title strip in every
	// mode; until the player chooses, drop-downs auto-compact (no room to
	// dock) while docked panels start open. The choice persists across
	// rebuilds and mode switches.
	private collapsible = false;
	private collapsedChoice: boolean | null = null;
	private side: "left" | "right" = "right";
	private lastConfig: SidePanelConfig | null = null;

	private get collapsed(): boolean {
		return this.collapsedChoice ?? this.collapsible;
	}

	// Scroll window over the log rows when there are more than fit above the footer.
	private rect: PanelRect | null = null;
	private scrollRow = 0;
	private maxScrollRows = 0;
	private lastRenderKey: string | null = null;

	constructor(
		private readonly scene: Phaser.Scene,
		private readonly depth = 20,
	) {
		this.gfx = scene.add.graphics().setDepth(depth);
		this.scene.input.on("wheel", this.onWheel, this);
	}

	/** Mouse-wheel over the panel scrolls the log window when it overflows. */
	private onWheel(
		pointer: Phaser.Input.Pointer,
		_objs: Phaser.GameObjects.GameObject[],
		_dx: number,
		deltaY: number,
	): void {
		if (this.maxScrollRows <= 0 || !this.rect || !this.lastConfig) return;
		const r = this.rect;
		// pointer.x/y are screen-space; the rect is world-space. Under camera zoom
		// they diverge, so transform through the camera before the bounds test.
		const p = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
		if (
			p.x < r.x ||
			p.x > r.x + r.width ||
			p.y < r.y ||
			p.y > r.y + r.height
		)
			return;
		const next = Phaser.Math.Clamp(
			this.scrollRow + (deltaY > 0 ? 1 : -1),
			0,
			this.maxScrollRows,
		);
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
	updateCollapsible(
		side: "left" | "right",
		config: Omit<SidePanelConfig, "rect">,
	): void {
		this.collapsible = true;
		this.side = side;
		this.render({ ...config, rect: this.collapsibleRect() });
	}

	private render(config: SidePanelConfig): void {
		// Collapsed panels shrink to the title strip in every mode.
		const rect = this.collapsed
			? { ...config.rect, height: PAD + TITLE_H }
			: config.rect;
		const renderKey = this.renderKey({ ...config, rect });
		if (renderKey === this.lastRenderKey) return;
		this.lastRenderKey = renderKey;
		this.lastConfig = config;
		this.rect = rect;
		this.maxScrollRows = 0; // recomputed in drawRows; stays 0 when collapsed
		this.poolCursor = 0;
		this.drawFrame(rect);
		this.drawTitle(config.title, rect);
		if (!this.collapsed) {
			this.drawRows(config.rows, rect, config.footerRows ?? []);
		}
		this.hideUnusedSlots();
	}

	private collapsibleRect(): PanelRect {
		const sw = this.scene.scale.width;
		const sh = this.scene.scale.height;
		const w = Math.min(COLLAPSE_W, sw - EDGE_PAD * 2);
		const x = this.side === "left" ? EDGE_PAD : sw - EDGE_PAD - w;
		const height = Math.max(
			PAD + TITLE_H,
			sh - COLLAPSE_TOP - EDGE_PAD,
		);
		return { x, y: COLLAPSE_TOP, width: w, height };
	}

	destroy(): void {
		this.scene.input.off("wheel", this.onWheel, this);
		for (const text of this.textPool) text.destroy();
		this.textPool.length = 0;
		this.slotCache.length = 0;
		this.toggleZone?.destroy();
		this.toggleZone = null;
		this.gfx.destroy();
	}

	private renderKey(config: SidePanelConfig): string {
		return JSON.stringify({
			collapsible: this.collapsible,
			collapsed: this.collapsed,
			side: this.side,
			scrollRow: this.scrollRow,
			title: config.title,
			rect: config.rect,
			rows: config.rows.map((row) => this.rowKey(row)),
			footerRows: (config.footerRows ?? []).map((row) => this.rowKey(row)),
		});
	}

	private rowKey(row: SidePanelRow): Record<string, string | boolean | undefined> {
		return {
			label: row.label,
			value: row.value,
			subtitle: row.subtitle,
			muted: row.muted,
			labelColor: row.labelColor,
			valueColor: row.valueColor,
			labelFontSize: row.labelFontSize,
			valueFontSize: row.valueFontSize,
			hasIcon: Boolean(row.icon),
		};
	}

	/**
	 * Reuse the next pooled Text slot (or create one on first use), applying the
	 * spec only when it differs from the slot's cached descriptor. Returns the
	 * live Text so callers can keep drawing, but no setter fires for an unchanged
	 * slot, which is what keeps a frequently-updated panel cheap.
	 */
	private acquireText(spec: TextSlotSpec): void {
		const index = this.poolCursor++;
		const key = this.slotKey(spec);
		let text = this.textPool[index];
		if (!text) {
			text = this.scene.add
				.text(spec.x, spec.y, spec.content, {
					fontSize: spec.fontSize,
					color: spec.color,
					fontFamily: spec.fontFamily,
					fontStyle: spec.fontStyle,
				})
				.setOrigin(spec.originX, spec.originY)
				.setDepth(spec.depth);
			if (spec.shadow) text.setShadow(0, 2, spec.shadow, this.shadowBlur(spec));
			this.textPool[index] = text;
			this.slotCache[index] = key;
			return;
		}
		if (this.slotCache[index] === key) {
			// Unchanged slot: only make sure it is visible after a prior hide.
			if (!text.visible) text.setVisible(true);
			return;
		}
		text.setVisible(true);
		text.setPosition(spec.x, spec.y);
		text.setOrigin(spec.originX, spec.originY);
		text.setStyle({
			fontSize: spec.fontSize,
			color: spec.color,
			fontFamily: spec.fontFamily,
			fontStyle: spec.fontStyle,
		});
		text.setDepth(spec.depth);
		text.setShadow(0, 2, spec.shadow ?? "rgba(0,0,0,0)", this.shadowBlur(spec));
		text.setText(spec.content);
		this.slotCache[index] = key;
	}

	private shadowBlur(spec: TextSlotSpec): number {
		return spec.shadow === TITLE_SHADOW ? 2 : 1;
	}

	private slotKey(spec: TextSlotSpec): string {
		return `${spec.content}|${spec.x}|${spec.y}|${spec.originX}|${spec.originY}|${spec.color}|${spec.fontSize}|${spec.fontFamily}|${spec.fontStyle}|${spec.depth}|${spec.shadow ?? ""}`;
	}

	private hideUnusedSlots(): void {
		for (let i = this.poolCursor; i < this.textPool.length; i += 1) {
			const text = this.textPool[i];
			if (text.visible) {
				text.setVisible(false);
				this.slotCache[i] = null;
			}
		}
	}

	private drawFrame(rect: PanelRect): void {
		this.gfx.clear();
		this.gfx.fillStyle(THEME.stoneDeep, 0.88);
		this.gfx.fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 12);
		this.gfx.lineStyle(2, THEME.stoneLight, 0.64);
		this.gfx.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 12);
		this.gfx.lineStyle(1, THEME.gold, 0.52);
		this.gfx.strokeRoundedRect(rect.x + 3, rect.y + 3, rect.width - 6, rect.height - 6, 10);
	}

	private drawTitle(title: string, rect: PanelRect): void {
		this.acquireText({
			content: title,
			x: rect.x + PAD,
			y: rect.y + PAD - 2,
			originX: 0,
			originY: 0,
			color: THEME.textJade,
			fontSize: "20px",
			fontFamily: THEME.fontBlowbrush,
			fontStyle: "bold",
			depth: this.depth + 1,
			shadow: TITLE_SHADOW,
		});

		// Chevron toggles the panel open/closed in every mode.
		this.acquireText({
			content: this.collapsed ? "▾" : "▴",
			x: rect.x + rect.width - PAD - 12,
			y: rect.y + PAD - 2,
			originX: 0,
			originY: 0,
			color: THEME.textGold,
			fontSize: "16px",
			fontFamily: THEME.font,
			fontStyle: "bold",
			depth: this.depth + 1,
			shadow: null,
		});

		this.ensureToggleZone(rect);

		if (this.collapsed) return;

		this.gfx.lineStyle(1, THEME.stoneLight, 0.36);
		this.gfx.lineBetween(
			rect.x + PAD,
			rect.y + PAD + TITLE_H,
			rect.x + rect.width - PAD,
			rect.y + PAD + TITLE_H,
		);
	}

	/** Create the collapse zone once, then only reposition/resize on later renders. */
	private ensureToggleZone(rect: PanelRect): void {
		if (!this.toggleZone) {
			this.toggleZone = this.scene.add
				.zone(rect.x, rect.y, rect.width, PAD + TITLE_H)
				.setOrigin(0, 0)
				.setInteractive({ useHandCursor: true })
				.setDepth(this.depth + 2);
			this.toggleZone.on("pointerup", () => {
				this.collapsedChoice = !this.collapsed;
				if (!this.lastConfig) return;
				this.render(
					this.collapsible
						? { ...this.lastConfig, rect: this.collapsibleRect() }
						: this.lastConfig,
				);
			});
			return;
		}
		this.toggleZone.setPosition(rect.x, rect.y);
		this.toggleZone.setSize(rect.width, PAD + TITLE_H);
		this.toggleZone.input?.hitArea?.setTo?.(0, 0, rect.width, PAD + TITLE_H);
	}

	private drawRows(
		rows: SidePanelRow[],
		rect: PanelRect,
		footerRows: SidePanelRow[],
	): void {
		const startY = rect.y + PAD + TITLE_H + 18;
		const footerReserve =
			footerRows.length > 0 ? footerRows.length * ROW_H + 18 : 0;
		const visibleRows = Math.max(
			0,
			Math.floor(
				(rect.height - PAD - TITLE_H - 20 - footerReserve) / ROW_H,
			),
		);

		// Scrollable window (mouse-wheel over the panel) when there are more rows
		// than fit above the footer.
		this.maxScrollRows = Math.max(0, rows.length - visibleRows);
		this.scrollRow = Phaser.Math.Clamp(
			this.scrollRow,
			0,
			this.maxScrollRows,
		);

		rows.slice(this.scrollRow, this.scrollRow + visibleRows).forEach(
			(row, index) => {
				const y = startY + index * ROW_H;
				this.drawRow(row, rect, y);
			},
		);

		if (this.maxScrollRows > 0 && visibleRows > 0) {
			const barTop = startY - 4;
			const barH = visibleRows * ROW_H;
			const barX = rect.x + rect.width - 7;
			this.gfx.fillStyle(THEME.cream, 0.08);
			this.gfx.fillRoundedRect(barX, barTop, 3, barH, 1.5);
			const thumbH = Math.max(16, barH * (visibleRows / rows.length));
			const thumbY =
				barTop +
				(barH - thumbH) * (this.scrollRow / this.maxScrollRows);
			this.gfx.fillStyle(THEME.jade, 0.62);
			this.gfx.fillRoundedRect(barX, thumbY, 3, thumbH, 1.5);
		}

		if (footerRows.length === 0) return;

		const footerStartY =
			rect.y + rect.height - PAD - footerRows.length * ROW_H;
		this.gfx.lineStyle(1, THEME.stoneLight, 0.32);
		this.gfx.lineBetween(
			rect.x + PAD,
			footerStartY - 12,
			rect.x + rect.width - PAD,
			footerStartY - 12,
		);

		footerRows.forEach((row, index) =>
			this.drawRow(row, rect, footerStartY + index * ROW_H),
		);
	}

	private drawRow(row: SidePanelRow, rect: PanelRect, y: number): void {
		const iconX = rect.x + PAD + ICON_SIZE / 2;
		const textX = row.icon ? rect.x + PAD + ICON_SIZE + 10 : rect.x + PAD;
		const valueX = rect.x + rect.width - VALUE_PAD;
		const labelColor = row.muted
			? THEME.textMutedHex
			: (row.labelColor ?? THEME.text);
		const valueColor = row.muted
			? THEME.textMutedHex
			: (row.valueColor ?? THEME.textGold);

		if (row.icon) row.icon(this.gfx, iconX, y + ICON_SIZE / 2, ICON_SIZE);

		this.acquireText({
			content: row.label,
			x: textX,
			y: y + 2,
			originX: 0,
			originY: 0,
			color: labelColor,
			fontSize: row.labelFontSize ?? "14px",
			fontFamily: THEME.font,
			fontStyle: "bold",
			depth: this.depth + 1,
			shadow: LABEL_SHADOW,
		});

		// Two-line layout: subtitle replaces right-side value
		if (row.subtitle) {
			this.acquireText({
				content: row.subtitle,
				x: textX,
				y: y + 17,
				originX: 0,
				originY: 0,
				color: THEME.textMutedHex,
				fontSize: "11px",
				fontFamily: THEME.font,
				fontStyle: "normal",
				depth: this.depth + 1,
				shadow: null,
			});
			return;
		}

		if (!row.value) return;

		this.acquireText({
			content: row.value,
			x: valueX,
			y: y + 2,
			originX: 1,
			originY: 0,
			color: valueColor,
			fontSize: row.valueFontSize ?? "14px",
			fontFamily: THEME.font,
			fontStyle: "bold",
			depth: this.depth + 1,
			shadow: LABEL_SHADOW,
		});
	}
}
