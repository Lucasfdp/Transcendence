/**
 * shared/ui/panels/PowerSidePanel.ts — interactive power-selection side panel.
 *
 * Renders all available powers as clickable rows in a right-side panel,
 * replacing the bottom PowerPicker bar. Hovering a row shows the power's
 * description in a footer area within the panel — no floating tooltip needed.
 *
 * Relocated from games/shell-curl/PowerSidePanel.ts so all three ball-physics
 * games (BambooBash, KameKnock, BellClash) can share the same component.
 */

import Phaser from 'phaser';
import { PowerType } from '../../mechanics/power-system';
import { THEME } from '../../theme';
import { PanelRect } from './side-panel';

// ── Layout ────────────────────────────────────────────────────────────────────

const PAD    = 12;
const TITLE_H = 30;
const ROW_H  = 28;
const ICON_R = 7;   // icon circle radius
const DESC_H = 68;  // description footer height (name + two wrapped lines)

// ── Data ──────────────────────────────────────────────────────────────────────

const POWER_LABELS: Record<PowerType, string> = {
  [PowerType.NONE]:      'Normal',
  [PowerType.HEAVY]:     'Heavy',
  [PowerType.BOMB]:      'Bomb',
  [PowerType.SPLITTER]:  'Splitter',
  [PowerType.GHOST]:     'Ghost',
  [PowerType.MAGNET]:    'Magnet',
  [PowerType.SPINNING]:  'Spinning',
  [PowerType.BOUNCER]:   'Bouncer',
  [PowerType.SHIELD]:    'Shield',
  [PowerType.FREEZE]:    'Freeze',
  [PowerType.SLICK]:     'Slick',
  [PowerType.ROCKET]:    'Rocket',
  [PowerType.GIANT]:     'Giant',
  [PowerType.TINY]:      'Tiny',
  [PowerType.BOOMERANG]: 'Boomerang',
  [PowerType.REPEL]:     'Repel',
  [PowerType.STICKY]:    'Sticky',
  [PowerType.LIGHTNING]: 'Lightning',
  [PowerType.VORTEX]:    'Vortex',
  [PowerType.CLONE]:     'Clone',
  [PowerType.RICOCHET]:  'Ricochet',
  [PowerType.PHANTOM]:   'Phantom',
};

const POWER_DESC: Record<PowerType, string> = {
  [PowerType.NONE]:      'Standard delivery, no special effect',
  [PowerType.HEAVY]:     'Extra knockback on contact with other stones',
  [PowerType.BOMB]:      'Explodes on first hit, scattering nearby stones',
  [PowerType.SPLITTER]:  'Splits into 3 smaller stones on first collision',
  [PowerType.GHOST]:     'Passes through opponent stones without deflecting',
  [PowerType.MAGNET]:    'Pulls nearby enemy stones toward your delivery',
  [PowerType.SPINNING]:  'Follows an unpredictable curved path',
  [PowerType.BOUNCER]:   'Bounces off bumpers with an extra speed boost',
  [PowerType.SHIELD]:    'Immune to all enemy power effects this throw',
  [PowerType.FREEZE]:    'Any stone you touch is frozen in place',
  [PowerType.SLICK]:     'Extra low friction — slides much farther than normal',
  [PowerType.ROCKET]:    'Launches at double speed — harder to aim but massive momentum',
  [PowerType.GIANT]:     'Your stone is twice as large — covers more ground on delivery',
  [PowerType.TINY]:      'Shrinks to half size — slips through tight gaps effortlessly',
  [PowerType.BOOMERANG]: 'Curves outward then reverses, striking targets twice',
  [PowerType.REPEL]:     'Blasts nearby stones away on contact — clears the house',
  [PowerType.STICKY]:    'Adheres to the first stone it touches, forming a cluster',
  [PowerType.LIGHTNING]: 'Strikes a random opponent stone with a bolt on landing',
  [PowerType.VORTEX]:    'Creates a whirlpool that slowly drags nearby stones in',
  [PowerType.CLONE]:     'Spawns a ghost copy that follows the same path one beat later',
  [PowerType.RICOCHET]:  'Bounces off any stone it hits at full speed — chain collisions',
  [PowerType.PHANTOM]:   'Invisible while moving; only revealed when it comes to rest',
};

const ACCENT_COLOURS: Record<PowerType, number> = {
  [PowerType.NONE]:      0x888888,
  [PowerType.HEAVY]:     0x886633,
  [PowerType.BOMB]:      0xff6600,
  [PowerType.SPLITTER]:  0xffee00,
  [PowerType.GHOST]:     0xaaddff,
  [PowerType.MAGNET]:    0xff44cc,
  [PowerType.SPINNING]:  0x44ffcc,
  [PowerType.BOUNCER]:   0xff8800,
  [PowerType.SHIELD]:    0x44cc44,
  [PowerType.FREEZE]:    0x88ccff,
  [PowerType.SLICK]:     0xccffee,
  [PowerType.ROCKET]:    0xff3333,
  [PowerType.GIANT]:     0xcc66ff,
  [PowerType.TINY]:      0x99eeaa,
  [PowerType.BOOMERANG]: 0xffcc00,
  [PowerType.REPEL]:     0xff6688,
  [PowerType.STICKY]:    0xaa8855,
  [PowerType.LIGHTNING]: 0xeeff44,
  [PowerType.VORTEX]:    0x6699ff,
  [PowerType.CLONE]:     0x55dddd,
  [PowerType.RICOCHET]:  0xff9944,
  [PowerType.PHANTOM]:   0xbbbbbb,
};

// ── PowerSidePanel ────────────────────────────────────────────────────────────

export class PowerSidePanel {
  private readonly gfx:   Phaser.GameObjects.Graphics;
  private readonly texts: Phaser.GameObjects.Text[] = [];
  private readonly zones: Phaser.GameObjects.Zone[] = [];

  private selected:   PowerType        = PowerType.NONE;
  private hovered:    PowerType | null = null;
  private rect:       PanelRect | null = null;
  private powers:     PowerType[]      = [];
  private usedPowers: Set<PowerType>   = new Set();
  private active                       = false;

  constructor(
    private readonly scene:    Phaser.Scene,
    private readonly onSelect: (type: PowerType) => void,
    private readonly depth     = 20,
  ) {
    this.gfx = scene.add.graphics().setDepth(depth);
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
    this.rect       = rect;
    this.powers     = powers;
    this.selected   = selected;
    this.usedPowers = usedPowers ?? new Set();
    this.active     = true;
    this.rebuild();
  }

  /** Rebuild in-place preserving current selection — use on resize. */
  refresh(): void {
    if (this.active) this.rebuild();
  }

  hide(): void {
    this.active = false;
    this.clear();
  }

  destroy(): void {
    this.clear();
    this.gfx.destroy();
  }

  getSelected(): PowerType {
    return this.selected;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private rebuild(): void {
    if (!this.rect || !this.active) return;
    this.clear();
    const r = this.rect;

    // Frame
    this.gfx.fillStyle(0x0a1208, 0.88);
    this.gfx.fillRoundedRect(r.x, r.y, r.width, r.height, 12);
    this.gfx.lineStyle(1.5, THEME.gold, 0.65);
    this.gfx.strokeRoundedRect(r.x, r.y, r.width, r.height, 12);

    // Title
    this.addText(r.x + PAD, r.y + PAD - 2, 'POWERS', {
      fontSize: '14px', color: THEME.textGold,
      fontFamily: THEME.font, fontStyle: 'bold',
    });
    this.gfx.lineStyle(1, THEME.gold, 0.25);
    this.gfx.lineBetween(r.x + PAD, r.y + PAD + TITLE_H, r.x + r.width - PAD, r.y + PAD + TITLE_H);

    // Power rows
    const rowsStartY = r.y + PAD + TITLE_H + 8;
    const iconX      = r.x + PAD + ICON_R;

    this.powers.forEach((power, i) => {
      const ry     = rowsStartY + i * ROW_H;
      const isSel  = power === this.selected;
      const isHov  = power === this.hovered;
      // NONE is always usable; other powers are one-shot per game
      const isUsed = power !== PowerType.NONE && this.usedPowers.has(power);
      const dim    = isUsed ? 0.35 : 1.0;
      const colour = ACCENT_COLOURS[power];
      const cy     = ry + ROW_H / 2;

      // Row background highlight (skip for used powers)
      if (!isUsed && (isSel || isHov)) {
        this.gfx.fillStyle(colour, isSel ? 0.18 : 0.07);
        this.gfx.fillRoundedRect(r.x + 4, ry, r.width - 8, ROW_H, 4);
        if (isSel) {
          this.gfx.lineStyle(1, THEME.gold, 0.55);
          this.gfx.strokeRoundedRect(r.x + 4, ry, r.width - 8, ROW_H, 4);
        }
      }

      // Icon circle
      this.gfx.fillStyle(colour, (isSel && !isUsed ? 0.90 : 0.40) * dim);
      this.gfx.fillCircle(iconX, cy, ICON_R);
      this.gfx.lineStyle(isSel && !isUsed ? 1.5 : 1, colour, (isSel && !isUsed ? 1.0 : 0.55) * dim);
      this.gfx.strokeCircle(iconX, cy, ICON_R);

      // Strikethrough bar for used powers
      if (isUsed) {
        this.gfx.lineStyle(1, 0x555555, 0.6);
        this.gfx.lineBetween(r.x + PAD, cy, r.x + r.width - PAD, cy);
      }

      // Label
      const labelColor = isUsed
        ? '#444444'
        : (isSel ? THEME.textGold : (isHov ? THEME.text : THEME.textMutedHex));

      this.addText(
        r.x + PAD + ICON_R * 2 + 6,
        cy - 7,
        POWER_LABELS[power],
        {
          fontSize:   '12px',
          color:      labelColor,
          fontFamily: THEME.font,
          fontStyle:  isSel && !isUsed ? 'bold' : 'normal',
        },
        dim,
      );

      // Hit zone — only for non-used powers
      if (!isUsed) {
        const zone = this.scene.add
          .zone(r.x + 4, ry, r.width - 8, ROW_H)
          .setOrigin(0, 0)
          .setInteractive({ useHandCursor: true });

        zone.on('pointerover', () => { this.hovered = power; this.rebuild(); });
        zone.on('pointerout',  () => { this.hovered = null;  this.rebuild(); });
        zone.on('pointerup',   () => {
          if (power === this.selected) return;
          this.selected = power;
          this.onSelect(power);
          this.rebuild();
        });

        this.zones.push(zone);
      }
    });

    // Description footer
    const footerY   = r.y + r.height - DESC_H - PAD;
    const descPower = this.hovered ?? this.selected;

    this.gfx.lineStyle(1, THEME.gold, 0.25);
    this.gfx.lineBetween(r.x + PAD, footerY, r.x + r.width - PAD, footerY);

    this.addText(r.x + PAD, footerY + 10, POWER_LABELS[descPower], {
      fontSize: '12px', color: THEME.textGold,
      fontFamily: THEME.font, fontStyle: 'bold',
    });

    this.addText(r.x + PAD, footerY + 28, POWER_DESC[descPower], {
      fontSize:   '10px',
      color:      THEME.text,
      fontFamily: THEME.font,
      wordWrap:   { width: r.width - PAD * 2 },
    });
  }

  private addText(
    x: number,
    y: number,
    text: string,
    style: Phaser.Types.GameObjects.Text.TextStyle,
    alpha = 1,
  ): void {
    const t = this.scene.add.text(x, y, text, style).setDepth(this.depth + 1);
    if (alpha < 1) t.setAlpha(alpha);
    this.texts.push(t);
  }

  private clear(): void {
    this.gfx.clear();
    for (const t of this.texts) t.destroy();
    this.texts.length = 0;
    for (const z of this.zones) z.destroy();
    this.zones.length = 0;
  }
}
