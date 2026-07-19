/**
 * shared/ui/panels/GameInfoSidePanel.ts — game information side panel.
 *
 * Renders a compact game guide, available powers, and guaranteed match rewards.
 * Hovering a power row shows the power's description in a footer area within the
 * panel — no floating tooltip needed.
 *
 * Shared by all shell minigames.
 */

import Phaser from "phaser";
import { POWER_UP_TEXTURES } from "../../mechanics/game-powers";
import { PowerType } from "../../mechanics/power-system";
import { THEME } from "../../theme";
import { PanelRect } from "./side-panel";

// ── Layout ────────────────────────────────────────────────────────────────────

const PAD = 12;
const TITLE_H = 42;
const SECTION_H = 26;
const ROW_H = 28;
const ICON_R = 7; // icon circle radius
const DESC_H = 126; // power description + guaranteed rewards footer
const SUMMARY_LINE_H = 30;

// Collapsible drop-down geometry — used when the viewport is too small/zoomed to
// dock the panel beside the arena. Anchored to a screen edge below the top HUD.
const COLLAPSE_W = 188;
const COLLAPSE_TOP = 74;
const EDGE_PAD = 12;

// ── Data ──────────────────────────────────────────────────────────────────────

const POWER_LABELS: Record<PowerType, string> = {
	[PowerType.NONE]: "Normal",
	[PowerType.HEAVY]: "Heavy",
	[PowerType.BOMB]: "Bomb",
	[PowerType.SPLITTER]: "Splitter",
	[PowerType.GHOST]: "Ghost",
	[PowerType.MAGNET]: "Magnet",
	[PowerType.SPINNING]: "Spinning",
	[PowerType.BOUNCER]: "Bouncer",
	[PowerType.SHIELD]: "Shield",
	[PowerType.FREEZE]: "Freeze",
	[PowerType.SLICK]: "Slick",
	[PowerType.ROCKET]: "Rocket",
	[PowerType.GIANT]: "Giant",
	[PowerType.TINY]: "Tiny",
	[PowerType.BOOMERANG]: "Boomerang",
	[PowerType.REPEL]: "Repel",
	[PowerType.STICKY]: "Sticky",
	[PowerType.LIGHTNING]: "Lightning",
	[PowerType.VORTEX]: "Vortex",
	[PowerType.MIRROR]: "Mirror",
	[PowerType.RICOCHET]: "Ricochet",
	[PowerType.PHANTOM]: "Phantom",
};

const POWER_DESC: Record<PowerType, string> = {
	[PowerType.NONE]: "Standard delivery, no special effect",
	[PowerType.HEAVY]: "Slower and heavier; harder to deflect",
	[PowerType.BOMB]: "Explodes on first hit, scattering nearby shells",
	[PowerType.SPLITTER]: "Splits into 3 smaller shells when picked up",
	[PowerType.GHOST]: "Passes through opponent shells without deflecting",
	[PowerType.MAGNET]: "Pulls nearby enemy shells towards your delivery",
	[PowerType.SPINNING]: "Follows an unpredictable curved path",
	[PowerType.BOUNCER]: "Bounces off bumpers with an extra speed boost",
	[PowerType.SHIELD]: "Immune to all enemy power effects this throw",
	[PowerType.FREEZE]: "Any shell you touch is frozen in place",
	[PowerType.SLICK]: "Extra low friction — slides much farther than normal",
	[PowerType.ROCKET]:
		"Launches at double speed — harder to aim but massive momentum",
	[PowerType.GIANT]:
		"Your shell is twice as large — covers more ground on delivery",
	[PowerType.TINY]:
		"Shrinks to half size — slips through tight gaps effortlessly",
	[PowerType.BOOMERANG]:
		"Curves outward then reverses, striking targets twice",
	[PowerType.REPEL]:
		"Blasts nearby shells away on contact — clears the house",
	[PowerType.STICKY]:
		"Adheres to the first shell it touches, forming a cluster",
	[PowerType.LIGHTNING]:
		"Strikes a random opponent shell with a bolt on landing",
	[PowerType.VORTEX]:
		"Creates a whirlpool that slowly drags nearby shells in",
	[PowerType.MIRROR]:
		"Creates a mirror copy on the opposite path",
	[PowerType.RICOCHET]:
		"Bounces off any shell it hits at full speed — chain collisions",
	[PowerType.PHANTOM]:
		"Invisible only to collisions while moving; visuals stay readable",
};

const ACCENT_COLOURS: Record<PowerType, number> = {
	[PowerType.NONE]: 0x888888,
	[PowerType.HEAVY]: 0x886633,
	[PowerType.BOMB]: 0xff6600,
	[PowerType.SPLITTER]: 0xffee00,
	[PowerType.GHOST]: 0xaaddff,
	[PowerType.MAGNET]: 0xff44cc,
	[PowerType.SPINNING]: 0x44ffcc,
	[PowerType.BOUNCER]: 0xff8800,
	[PowerType.SHIELD]: 0x44cc44,
	[PowerType.FREEZE]: 0x88ccff,
	[PowerType.SLICK]: 0xccffee,
	[PowerType.ROCKET]: 0xff3333,
	[PowerType.GIANT]: 0xcc66ff,
	[PowerType.TINY]: 0x99eeaa,
	[PowerType.BOOMERANG]: 0xffcc00,
	[PowerType.REPEL]: 0xff6688,
	[PowerType.STICKY]: 0xaa8855,
	[PowerType.LIGHTNING]: 0xeeff44,
	[PowerType.VORTEX]: 0x6699ff,
	[PowerType.MIRROR]: 0x55dddd,
	[PowerType.RICOCHET]: 0xff9944,
	[PowerType.PHANTOM]: 0xbbbbbb,
};

export interface GameInfoPanelRow {
	label: string;
	value: string;
	labelColor?: string;
	valueColor?: string;
}

export interface GameInfoPanelDetails {
	summaryTitle: string;
	summaryLines: string[];
	rewardRows: GameInfoPanelRow[];
}

// ── GameInfoSidePanel ─────────────────────────────────────────────────────────

export class GameInfoSidePanel {
	private readonly gfx: Phaser.GameObjects.Graphics;
	private readonly texts: Phaser.GameObjects.Text[] = [];
	private readonly images: Phaser.GameObjects.Image[] = [];
	private readonly zones: Phaser.GameObjects.Zone[] = [];

	private selected: PowerType = PowerType.NONE;
	private hovered: PowerType | null = null;
	private rect: PanelRect | null = null;
	private powers: PowerType[] = [];
	private usedPowers: Set<PowerType> = new Set();
	private active = false;

	// Collapse state. The panel can be collapsed to its title strip in every
	// mode; until the player chooses, drop-downs auto-compact (no room to
	// dock) while docked panels start open. The choice persists across
	// rebuilds and mode switches.
	private collapsible = false;
	private collapsedChoice: boolean | null = null;
	private side: "left" | "right" = "left";

	private get collapsed(): boolean {
		return this.collapsedChoice ?? this.collapsible;
	}

	// Scroll window over the power rows when the list is taller than the panel.
	private scrollRow = 0;
	private maxScrollRows = 0;
	private lastRenderKey: string | null = null;

	constructor(
		private readonly scene: Phaser.Scene,
		private readonly onSelect: (type: PowerType) => void,
		private readonly depth = 20,
		private readonly gameTitle = "GAME",
		private readonly readOnly = false,
		private readonly infoRows: () => GameInfoPanelRow[] = () => [],
		private readonly details: () => GameInfoPanelDetails | null = () => null,
	) {
		this.gfx = scene.add.graphics().setDepth(depth);
		this.scene.input.on("wheel", this.onWheel, this);
	}

	/** Mouse-wheel over the panel scrolls the row window when it overflows. */
	private onWheel(
		pointer: Phaser.Input.Pointer,
		_objs: Phaser.GameObjects.GameObject[],
		_dx: number,
		deltaY: number,
	): void {
		if (!this.active || !this.rect || this.maxScrollRows <= 0) return;
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
			this.rebuild();
		}
	}

	/**
	 * Show the panel with a fresh set of available powers.
	 * @param usedPowers Powers the player has already fired this game — rendered
	 *                   greyed-out (opacity 0.35) and made non-selectable.
	 */
	show(
		rect: PanelRect,
		powers: PowerType[],
		selected: PowerType,
		usedPowers?: Set<PowerType>,
	): void {
		this.collapsible = false;
		this.rect = rect;
		this.powers = powers;
		this.selected = selected;
		this.usedPowers = usedPowers ?? new Set();
		this.active = true;
		this.rebuild();
	}

	/**
	 * Show the panel as a collapsible drop-down anchored to a screen edge — used
	 * when the viewport is too small/zoomed to dock the panel beside the arena.
	 * Renders a slim "POWERS ▾" header; clicking it drops the full panel down.
	 */
	showCollapsible(
		side: "left" | "right",
		powers: PowerType[],
		selected: PowerType,
		usedPowers?: Set<PowerType>,
	): void {
		this.collapsible = true;
		this.side = side;
		this.powers = powers;
		this.selected = selected;
		this.usedPowers = usedPowers ?? new Set();
		this.active = true;
		this.updateCollapsibleRect();
		this.rebuild();
	}

	/** Rebuild in-place preserving current selection — use on resize. */
	refresh(): void {
		if (!this.active) return;
		if (this.collapsible) this.updateCollapsibleRect();
		this.rebuild();
	}

	/** Recompute the expanded drop-down rect (rebuild clamps when collapsed). */
	private updateCollapsibleRect(): void {
		const sw = this.scene.scale.width;
		const sh = this.scene.scale.height;
		const w = Math.min(COLLAPSE_W, sw - EDGE_PAD * 2);
		const x = this.side === "left" ? EDGE_PAD : sw - EDGE_PAD - w;
		const headerH = PAD + TITLE_H;
		const maxH = sh - COLLAPSE_TOP - EDGE_PAD;
		const details = this.details();
		const summaryH = details
			? SECTION_H + details.summaryLines.length * SUMMARY_LINE_H + 6
			: 0;
		const infoH = this.infoRows().length * 22;
		const need =
			headerH +
			summaryH +
			infoH +
			SECTION_H +
			8 +
			this.powers.length * ROW_H +
			DESC_H +
			PAD;
		this.rect = {
			x,
			y: COLLAPSE_TOP,
			width: w,
			height: Math.max(headerH, Math.min(need, maxH)),
		};
	}

	destroy(): void {
		this.scene.input.off("wheel", this.onWheel, this);
		this.clear();
		this.gfx.destroy();
	}

	getSelected(): PowerType {
		return this.selected;
	}

	/** Whether the panel is currently shown (docked or collapsed). */
	isVisible(): boolean {
		return this.active;
	}

	// ── Private ───────────────────────────────────────────────────────────────

	private rebuild(): void {
		if (!this.rect || !this.active) return;
		const renderKey = this.renderKey(this.rect);
		if (renderKey === this.lastRenderKey) return;
		this.lastRenderKey = renderKey;
		this.clear();
		this.maxScrollRows = 0; // recomputed in the rows section; stays 0 when collapsed
		// Collapsed panels shrink to the title strip in every mode.
		const r = this.collapsed
			? { ...this.rect, height: PAD + TITLE_H }
			: this.rect;

		// Frame
		this.gfx.fillStyle(THEME.stoneDeep, 0.88);
		this.gfx.fillRoundedRect(r.x, r.y, r.width, r.height, 12);
		this.gfx.lineStyle(2, THEME.stoneLight, 0.64);
		this.gfx.strokeRoundedRect(r.x, r.y, r.width, r.height, 12);
		this.gfx.lineStyle(1, THEME.gold, 0.52);
		this.gfx.strokeRoundedRect(
			r.x + 3,
			r.y + 3,
			r.width - 6,
			r.height - 6,
			10,
		);

		// Title
		this.addText(r.x + PAD, r.y + PAD - 2, this.gameTitle, {
			fontSize: "30px",
			color: THEME.textJade,
			fontFamily: THEME.fontBlowbrush,
			fontStyle: "bold",
		}).setShadow(0, 2, "rgba(5, 28, 18, 0.78)", 2);

		// Chevron + a click-zone over the title strip toggle the panel
		// open/closed in every mode. When collapsed we draw only this strip.
		this.addText(
			r.x + r.width - PAD - 12,
			r.y + PAD - 2,
			this.collapsed ? "▾" : "▴",
			{
				fontSize: "14px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			},
		);
		const toggle = this.scene.add
			.zone(r.x, r.y, r.width, PAD + TITLE_H)
			.setOrigin(0, 0)
			.setInteractive({ useHandCursor: true })
			.setDepth(this.depth + 2);
		toggle.on("pointerup", () => {
			this.collapsedChoice = !this.collapsed;
			if (this.collapsible) this.updateCollapsibleRect();
			this.rebuild();
		});
		this.zones.push(toggle);
		if (this.collapsed) return;

		this.gfx.lineStyle(1, THEME.stoneLight, 0.36);
		this.gfx.lineBetween(
			r.x + PAD,
			r.y + PAD + TITLE_H,
			r.x + r.width - PAD,
			r.y + PAD + TITLE_H,
		);

		let sectionY = r.y + PAD + TITLE_H + 9;
		const details = this.details();
		if (details) {
			this.addText(r.x + PAD, sectionY, details.summaryTitle, {
				fontSize: "13px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			}).setShadow(0, 2, "rgba(8, 18, 11, 0.65)", 1);
			sectionY += SECTION_H;

			details.summaryLines.forEach((line) => {
				this.addText(r.x + PAD, sectionY, line, {
					fontSize: "10px",
					color: THEME.text,
					fontFamily: THEME.font,
					wordWrap: { width: r.width - PAD * 2 },
				});
				sectionY += SUMMARY_LINE_H;
			});
			sectionY += 6;
		}

		const infoRows = this.infoRows();
		infoRows.forEach((row, index) => {
			const y = sectionY + index * 22;
			this.addText(r.x + PAD, y, row.label, {
				fontSize: "12px",
				color: row.labelColor ?? THEME.textJade,
				fontFamily: THEME.font,
				fontStyle: "bold",
			}).setShadow(0, 2, "rgba(8, 18, 11, 0.65)", 1);
			this.addText(r.x + r.width - PAD, y, row.value, {
				fontSize: "13px",
				color: row.valueColor ?? THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
				.setOrigin(1, 0)
				.setShadow(0, 2, "rgba(8, 18, 11, 0.65)", 1);
		});
		sectionY += infoRows.length * 22;

		this.addText(r.x + PAD, sectionY, "AVAILABLE POWERS", {
			fontSize: "13px",
			color: THEME.textGold,
			fontFamily: THEME.font,
			fontStyle: "bold",
		}).setShadow(0, 2, "rgba(8, 18, 11, 0.65)", 1);

		// Power rows. When the list is taller than the space above the footer, show
		// a scrollable window (mouse-wheel over the panel) instead of clipping rows.
		const rowsStartY = sectionY + SECTION_H;
		const iconX = r.x + PAD + ICON_R;
		const regionBot = r.y + r.height - DESC_H - PAD;
		const visibleRows = Math.max(
			0,
			Math.floor((regionBot - rowsStartY) / ROW_H),
		);
		this.maxScrollRows = Math.max(0, this.powers.length - visibleRows);
		this.scrollRow = Phaser.Math.Clamp(
			this.scrollRow,
			0,
			this.maxScrollRows,
		);

		this.powers
			.slice(this.scrollRow, this.scrollRow + visibleRows)
			.forEach((power, i) => {
				const ry = rowsStartY + i * ROW_H;
				const isSel = power === this.selected;
				const isHov = power === this.hovered;
				// NONE is always usable; other powers are one-shot per game
				const isUsed =
					power !== PowerType.NONE && this.usedPowers.has(power);
				const dim = isUsed ? 0.35 : 1.0;
				const colour = ACCENT_COLOURS[power];
				const cy = ry + ROW_H / 2;

				// Row background highlight (skip for used powers)
				if (!isUsed && (isSel || isHov)) {
					this.gfx.fillStyle(colour, isSel ? 0.18 : 0.07);
					this.gfx.fillRoundedRect(
						r.x + 4,
						ry,
						r.width - 8,
						ROW_H,
						4,
					);
					if (isSel) {
						this.gfx.lineStyle(1, THEME.gold, 0.55);
						this.gfx.strokeRoundedRect(
							r.x + 4,
							ry,
							r.width - 8,
							ROW_H,
							4,
						);
					}
				}

				// Icon badge
				this.gfx.fillStyle(
					colour,
					(isSel && !isUsed ? 0.42 : 0.18) * dim,
				);
				this.gfx.fillCircle(iconX, cy, ICON_R * 1.28);
				this.gfx.lineStyle(
					isSel && !isUsed ? 1.5 : 1,
					colour,
					(isSel && !isUsed ? 1.0 : 0.55) * dim,
				);
				this.gfx.strokeCircle(iconX, cy, ICON_R * 1.28);

				const texture = POWER_UP_TEXTURES[power];
				if (texture && this.scene.textures.exists(texture)) {
					this.addImage(iconX, cy, texture, dim).setDisplaySize(
						ICON_R * 2.7,
						ICON_R * 2.7,
					);
				} else {
					this.gfx.fillStyle(colour, (isSel && !isUsed ? 0.9 : 0.4) * dim);
					this.gfx.fillCircle(iconX, cy, ICON_R);
				}

				// Strikethrough bar for used powers
				if (isUsed) {
					this.gfx.lineStyle(1, 0x555555, 0.6);
					this.gfx.lineBetween(
						r.x + PAD,
						cy,
						r.x + r.width - PAD,
						cy,
					);
				}

				// Label
				const labelColor = isUsed
					? "#444444"
					: isSel
						? THEME.textGold
						: isHov
							? THEME.text
							: THEME.textMutedHex;

				this.addText(
					r.x + PAD + ICON_R * 2 + 6,
					cy - 7,
					POWER_LABELS[power],
					{
						fontSize: "12px",
						color: labelColor,
						fontFamily: THEME.font,
						fontStyle: isSel && !isUsed ? "bold" : "normal",
					},
					dim,
				);

				// Hit zone — hover is always useful; selection can be disabled for pickup mode.
				if (!isUsed) {
					const zone = this.scene.add
						.zone(r.x + 4, ry, r.width - 8, ROW_H)
						.setOrigin(0, 0)
						.setInteractive({ useHandCursor: !this.readOnly });

					zone.on("pointerover", () => {
						this.hovered = power;
						this.rebuild();
					});
					zone.on("pointerout", () => {
						this.hovered = null;
						this.rebuild();
					});
					zone.on("pointerup", () => {
						if (this.readOnly) return;
						if (power === this.selected) return;
						this.selected = power;
						this.onSelect(power);
						this.rebuild();
					});

					this.zones.push(zone);
				}
			});

		// Scrollbar thumb on the right edge of the rows region when it overflows.
		if (this.maxScrollRows > 0 && visibleRows > 0) {
			const barH = regionBot - rowsStartY;
			const barX = r.x + r.width - 7;
			this.gfx.fillStyle(0xffffff, 0.07);
			this.gfx.fillRoundedRect(barX, rowsStartY, 3, barH, 1.5);
			const thumbH = Math.max(
				16,
				barH * (visibleRows / this.powers.length),
			);
			const thumbY =
				rowsStartY +
				(barH - thumbH) * (this.scrollRow / this.maxScrollRows);
			this.gfx.fillStyle(THEME.gold, 0.55);
			this.gfx.fillRoundedRect(barX, thumbY, 3, thumbH, 1.5);
		}

		// Description and guaranteed rewards footer
		const footerY = r.y + r.height - DESC_H - PAD;
		const descPower =
			this.hovered ??
			(this.powers.includes(this.selected)
				? this.selected
				: (this.powers[0] ?? this.selected));

		this.gfx.lineStyle(1, THEME.gold, 0.25);
		this.gfx.lineBetween(r.x + PAD, footerY, r.x + r.width - PAD, footerY);

		this.addText(r.x + PAD, footerY + 10, POWER_LABELS[descPower], {
			fontSize: "14px",
			color: THEME.textGold,
			fontFamily: THEME.font,
			fontStyle: "bold",
		});

		this.addText(r.x + PAD, footerY + 28, POWER_DESC[descPower], {
			fontSize: "10px",
			color: THEME.text,
			fontFamily: THEME.font,
			wordWrap: { width: r.width - PAD * 2 },
		});

		if (details && details.rewardRows.length > 0) {
			const rewardY = footerY + 66;
			this.gfx.lineStyle(1, THEME.gold, 0.18);
			this.gfx.lineBetween(
				r.x + PAD,
				rewardY - 8,
				r.x + r.width - PAD,
				rewardY - 8,
			);
			this.addText(r.x + PAD, rewardY, "MATCH REWARDS", {
				fontSize: "12px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			});

			details.rewardRows.slice(0, 3).forEach((row, index) => {
				const y = rewardY + 18 + index * 14;
				this.addText(r.x + PAD, y, row.label, {
					fontSize: "10px",
					color: row.labelColor ?? THEME.textMutedHex,
					fontFamily: THEME.font,
				});
				this.addText(r.x + r.width - PAD, y, row.value, {
					fontSize: "10px",
					color: row.valueColor ?? THEME.textGold,
					fontFamily: THEME.font,
					fontStyle: "bold",
				})
					.setOrigin(1, 0)
					.setShadow(0, 2, "rgba(8, 18, 11, 0.65)", 1);
			});
		}
	}

	private addText(
		x: number,
		y: number,
		text: string,
		style: Phaser.Types.GameObjects.Text.TextStyle,
		alpha = 1,
	): Phaser.GameObjects.Text {
		const t = this.scene.add
			.text(x, y, text, style)
			.setDepth(this.depth + 1);
		if (alpha < 1) t.setAlpha(alpha);
		this.texts.push(t);
		return t;
	}

	private addImage(
		x: number,
		y: number,
		texture: string,
		alpha = 1,
	): Phaser.GameObjects.Image {
		const image = this.scene.add
			.image(x, y, texture)
			.setDepth(this.depth + 1.1)
			.setAlpha(alpha);
		this.images.push(image);
		return image;
	}

	private renderKey(rect: PanelRect): string {
		const details = this.details();
		return JSON.stringify({
			active: this.active,
			collapsible: this.collapsible,
			collapsed: this.collapsed,
			side: this.side,
			scrollRow: this.scrollRow,
			selected: this.selected,
			hovered: this.hovered,
			rect,
			powers: this.powers,
			usedPowers: [...this.usedPowers].sort(),
			infoRows: this.infoRows(),
			details,
			gameTitle: this.gameTitle,
			readOnly: this.readOnly,
		});
	}

	private clear(): void {
		this.gfx.clear();
		for (const t of this.texts) t.destroy();
		this.texts.length = 0;
		for (const image of this.images) image.destroy();
		this.images.length = 0;
		for (const z of this.zones) z.destroy();
		this.zones.length = 0;
	}
}
