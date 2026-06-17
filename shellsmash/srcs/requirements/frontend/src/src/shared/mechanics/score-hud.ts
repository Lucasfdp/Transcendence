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
const PLAYER_COLOURS  = [0x2255cc, 0xcc2222, 0x22aa55, 0xbb55dd, 0xd4a843] as const;
const PLAYER_HEX      = ['#2255cc', '#cc2222', '#22aa55', '#bb55dd', '#d4a843'] as const;
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
    add('end',     w * 0.50, BAR_HEIGHT * 0.30, 'END 1 / 3', style('13px', THEME.textGold));
    add('phase',   w * 0.50, BAR_HEIGHT * 0.68, 'AIMING', style('11px', THEME.text));

    for (let player = 0; player < 5; player++) {
      add(`score${player}`, 0, BAR_HEIGHT * 0.38, '0', style('20px', PLAYER_HEX[player]));
      add(`label${player}`, 0, BAR_HEIGHT * 0.68, this.playerLabel(player, 5), style('9px', PLAYER_HEX[player]));
    }
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
    const playerCount = Math.max(2, state.score.length);
    const slotW = w / playerCount;
    const underW  = Math.min(w * 0.20, slotW * 0.70);
    const underY  = BAR_HEIGHT - 3;
    const underX0 = slotW * state.currentTeam + (slotW - underW) / 2;
    this.gfx.fillStyle(0xd4a843, 0.85);
    this.gfx.fillRect(underX0, underY, underW, 2);

    // Stones-remaining dots
    this.drawStoneDots(state, w);

    // Update text values
    this.repositionTexts(w, playerCount);
    for (let player = 0; player < 5; player++) {
      const visible = player < playerCount;
      this.texts.get(`score${player}`)?.setVisible(visible).setText(String(state.score[player] ?? 0));
      this.texts.get(`label${player}`)?.setVisible(visible).setText(this.playerLabel(player, playerCount));
    }
    this.texts.get('end')?.setText(`END ${Math.min(3, state.currentEnd + 1)} / 3`);
    this.texts.get('phase')?.setText(PHASE_LABELS[state.phase] ?? state.phase.toUpperCase());
  }

  private drawStoneDots(state: TurnState, w: number): void {
    const dotY = BAR_HEIGHT + STONES_ROW_H / 2 + 2;

    const playerCount = Math.max(2, state.score.length);
    const slotW = w / playerCount;

    for (let team = 0; team < playerCount; team++) {
      const count  = state.stonesLeft[team] ?? 0;
      const colour = PLAYER_COLOURS[team % PLAYER_COLOURS.length];
      const totalW = count * STONE_DOT_GAP;
      const startX = slotW * team + (slotW - totalW) / 2 + STONE_DOT_GAP / 2;

      for (let i = 0; i < count; i++) {
        const cx = startX + i * STONE_DOT_GAP;
        this.gfx.fillStyle(colour, 0.85);
        this.gfx.fillCircle(cx, dotY, STONE_DOT_R);
      }
    }
  }

  private repositionTexts(w: number, playerCount: number): void {
    this.texts.get('end')?.setX(w * 0.50);
    this.texts.get('phase')?.setX(w * 0.50);
    for (let player = 0; player < 5; player++) {
      const x = (player + 0.5) * (w / playerCount);
      this.texts.get(`score${player}`)?.setX(x);
      this.texts.get(`label${player}`)?.setX(x);
    }
  }

  private playerLabel(player: number, playerCount: number): string {
    if (playerCount === 2 && player < 2) return TEAM_LABELS[player];
    return `PLAYER ${player + 1}`;
  }
}
