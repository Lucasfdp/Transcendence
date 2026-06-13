/**
 * game/mechanics/score-hud.ts — reusable top-bar scoreboard for 2-team games.
 *
 * Renders a dark strip across the top of the scene showing:
 *   - Team name + score (left and right)
 *   - Current end + phase label (centre)
 *   - Active team underline
 *   - Stones-remaining row below the main bar
 *
 * Zero imports from any specific minigame directory.
 */

import Phaser from 'phaser';
import type { TurnState } from './turn-manager';
import { THEME } from '../theme';

// ── Layout constants ──────────────────────────────────────────────────────────

const BAR_HEIGHT      = 52;   // px
const STONES_ROW_H    = 18;   // px below main bar
const STONE_DOT_R     = 5;    // radius of each stone-remaining dot
const STONE_DOT_GAP   = 14;   // centre-to-centre gap between dots
const TEAM_0_COLOUR   = 0x2255cc;
const TEAM_1_COLOUR   = 0xcc2222;
const TEAM_LABELS     = ['KAME BLUE', 'KAME RED'] as const;

const PHASE_LABELS: Record<string, string> = {
  aiming:   'AIMING',
  sweeping: 'SWEEPING ▶',
  settling: 'SETTLING…',
  scoring:  'SCORE',
  gameover: 'GAME OVER',
};

// ── ScoreHud ──────────────────────────────────────────────────────────────────

export class ScoreHud {
  private readonly container: Phaser.GameObjects.Container;
  private readonly gfx:       Phaser.GameObjects.Graphics;
  private readonly texts:     Map<string, Phaser.GameObjects.Text> = new Map();

  constructor(
    private readonly scene: Phaser.Scene,
    depth = 20,
  ) {
    this.gfx       = scene.add.graphics().setDepth(depth);
    this.container = scene.add.container(0, 0).setDepth(depth);
    this.buildTexts();
  }

  /** Redraw the HUD to reflect the current TurnState. */
  update(state: TurnState): void {
    this.draw(state);
  }

  destroy(): void {
    this.gfx.destroy();
    this.container.destroy(true);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private buildTexts(): void {
    const style = (size: string, color: string): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontSize: size,
      color,
      fontFamily: THEME.font,
      fontStyle: 'bold',
    });

    const add = (key: string, x: number, y: number, s: string, sty: Phaser.Types.GameObjects.Text.TextStyle) => {
      const t = this.scene.add.text(x, y, s, sty).setOrigin(0.5, 0.5);
      this.container.add(t);
      this.texts.set(key, t);
    };

    const w = this.scene.scale.width;
    add('score0',  w * 0.12, BAR_HEIGHT * 0.4,  '0', style('26px', '#2255cc'));
    add('label0',  w * 0.22, BAR_HEIGHT * 0.4,  TEAM_LABELS[0], style('11px', '#2255cc'));
    add('end',     w * 0.50, BAR_HEIGHT * 0.30, 'END 1 / 3', style('13px', THEME.textGold));
    add('phase',   w * 0.50, BAR_HEIGHT * 0.68, 'AIMING', style('11px', THEME.text));
    add('label1',  w * 0.78, BAR_HEIGHT * 0.4,  TEAM_LABELS[1], style('11px', '#cc2222'));
    add('score1',  w * 0.88, BAR_HEIGHT * 0.4,  '0', style('26px', '#cc2222'));
  }

  private draw(state: TurnState): void {
    const w    = this.scene.scale.width;
    const totH = BAR_HEIGHT + STONES_ROW_H + 4;

    this.gfx.clear();

    // Background bar
    this.gfx.fillStyle(0x0a1208, 0.95);
    this.gfx.fillRect(0, 0, w, totH);
    this.gfx.lineStyle(1, 0xd4a843, 0.3);
    this.gfx.lineBetween(0, totH, w, totH);

    // Active team underline
    const underW  = w * 0.28;
    const underY  = BAR_HEIGHT - 3;
    const underX0 = state.currentTeam === 0 ? w * 0.01 : w - w * 0.01 - underW;
    this.gfx.fillStyle(0xd4a843, 0.85);
    this.gfx.fillRect(underX0, underY, underW, 2);

    // Stones-remaining dots
    this.drawStoneDots(state, w);

    // Update text values
    this.repositionTexts(w);
    this.texts.get('score0')?.setText(String(state.score[0]));
    this.texts.get('score1')?.setText(String(state.score[1]));
    this.texts.get('end')?.setText(`END ${state.currentEnd + 1} / 3`);
    this.texts.get('phase')?.setText(PHASE_LABELS[state.phase] ?? state.phase.toUpperCase());
  }

  private drawStoneDots(state: TurnState, w: number): void {
    const dotY = BAR_HEIGHT + STONES_ROW_H / 2 + 2;

    for (let team = 0; team < 2; team++) {
      const count  = state.stonesLeft[team as 0 | 1];
      const colour = team === 0 ? TEAM_0_COLOUR : TEAM_1_COLOUR;
      const totalW = count * STONE_DOT_GAP;
      const startX = team === 0
        ? w * 0.02
        : w - w * 0.02 - totalW + STONE_DOT_GAP / 2;

      for (let i = 0; i < count; i++) {
        const cx = startX + i * STONE_DOT_GAP;
        this.gfx.fillStyle(colour, 0.85);
        this.gfx.fillCircle(cx, dotY, STONE_DOT_R);
      }
    }
  }

  private repositionTexts(w: number): void {
    this.texts.get('score0')?.setX(w * 0.12);
    this.texts.get('label0')?.setX(w * 0.22);
    this.texts.get('end')?.setX(w * 0.50);
    this.texts.get('phase')?.setX(w * 0.50);
    this.texts.get('label1')?.setX(w * 0.78);
    this.texts.get('score1')?.setX(w * 0.88);
  }
}
