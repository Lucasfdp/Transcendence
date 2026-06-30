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

import Phaser from "phaser";
import type { TurnState } from "./turn-manager";
import { THEME } from "../theme";
import { PLAYER_COLOUR_VALUES, PLAYER_HEX_COLOURS } from "../game-ui";

// ── Layout constants ──────────────────────────────────────────────────────────

const BAR_HEIGHT = 52; // px
const STONES_ROW_H = 18; // px below main bar
const STONE_DOT_R = 5; // radius of each stone-remaining dot
const STONE_DOT_GAP = 14; // centre-to-centre gap between dots
const PLAYER_COLOURS = PLAYER_COLOUR_VALUES;
const PLAYER_HEX = PLAYER_HEX_COLOURS;
const TEAM_LABELS = ["P1", "P2"] as const;

const PHASE_LABELS: Record<string, string> = {
	aiming: "AIMING",
	sweeping: "SWEEPING ▶",
	settling: "SETTLING…",
	scoring: "SCORE",
	gameover: "GAME OVER",
};

interface ScoreHudOptions {
	readonly roundLabel?: string;
	readonly totalRounds?: number;
	readonly phaseLabels?: Partial<Record<string, string>>;
	readonly playerLabel?: (player: number, playerCount: number) => string;
	readonly showBackground?: boolean;
	readonly showRoundInfo?: boolean;
	readonly playerColours?: readonly number[];
	readonly playerHexColours?: readonly string[];
	readonly statusLabel?: (player: number, state: TurnState) => string;
	readonly minPlayerCount?: number;
}

// ── ScoreHud ──────────────────────────────────────────────────────────────────

export class ScoreHud {
	private readonly container: Phaser.GameObjects.Container;
	private readonly gfx: Phaser.GameObjects.Graphics;
	private readonly texts: Map<string, Phaser.GameObjects.Text> = new Map();

	constructor(
		private readonly scene: Phaser.Scene,
		depth = 20,
		private readonly options: ScoreHudOptions = {},
	) {
		this.gfx = scene.add.graphics().setDepth(depth);
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
		const style = (
			size: string,
			color: string,
		): Phaser.Types.GameObjects.Text.TextStyle => ({
			fontSize: size,
			color,
			fontFamily: THEME.font,
			fontStyle: "bold",
		});

		const add = (
			key: string,
			x: number,
			y: number,
			s: string,
			sty: Phaser.Types.GameObjects.Text.TextStyle,
		) => {
			const t = this.scene.add.text(x, y, s, sty).setOrigin(0.5, 0.5);
			this.container.add(t);
			this.texts.set(key, t);
		};

		const w = this.scene.scale.width;
		add(
			"end",
			w * 0.5,
			BAR_HEIGHT * 0.3,
			"END 1 / 3",
			style("13px", THEME.textGold),
		);
		add(
			"phase",
			w * 0.5,
			BAR_HEIGHT * 0.68,
			"AIMING",
			style("11px", THEME.text),
		);

		for (let player = 0; player < 5; player++) {
			add(
				`score${player}`,
				0,
				BAR_HEIGHT * 0.38,
				"0",
				style("20px", PLAYER_HEX[player]),
			);
			add(
				`label${player}`,
				0,
				BAR_HEIGHT * 0.68,
				this.playerLabel(player, 5),
				style("9px", PLAYER_HEX[player]),
			);
			add(
				`status${player}`,
				0,
				BAR_HEIGHT + STONES_ROW_H / 2 + 2,
				"",
				style("9px", PLAYER_HEX[player]),
			);
		}
	}

	private draw(state: TurnState): void {
		const w = this.scene.scale.width;
		const totH = BAR_HEIGHT + STONES_ROW_H + 4;

		this.gfx.clear();

		if (this.options.showBackground !== false) {
			this.gfx.fillStyle(0x0a1208, 0.95);
			this.gfx.fillRect(0, 0, w, totH);
			this.gfx.lineStyle(1, 0xd4a843, 0.3);
			this.gfx.lineBetween(0, totH, w, totH);
		}

		// Active team underline
		const playerCount = Math.max(
			this.options.minPlayerCount ?? 2,
			state.score.length,
		);
		const slotW = w / playerCount;
		const underW = Math.min(w * 0.2, slotW * 0.7);
		const underY = BAR_HEIGHT - 3;
		const underX0 = slotW * state.currentTeam + (slotW - underW) / 2;
		this.gfx.fillStyle(this.playerColour(state.currentTeam), 0.85);
		this.gfx.fillRect(underX0, underY, underW, 2);

		// Stones-remaining dots, or game-specific per-player status labels.
		if (this.options.statusLabel) this.drawStatusLabels(state, w);
		else this.drawStoneDots(state, w);

		// Update text values
		this.repositionTexts(w, playerCount);
		for (let player = 0; player < 5; player++) {
			const visible = player < playerCount;
			this.texts
				.get(`score${player}`)
				?.setVisible(visible)
				.setColor(this.playerHexColour(player))
				.setText(String(state.score[player] ?? 0));
			this.texts
				.get(`label${player}`)
				?.setVisible(visible)
				.setColor(this.playerHexColour(player))
				.setText(this.playerLabel(player, playerCount));
			this.texts
				.get(`status${player}`)
				?.setVisible(visible && Boolean(this.options.statusLabel))
				.setColor(this.playerHexColour(player))
				.setText(this.options.statusLabel?.(player, state) ?? "");
		}
		const showRoundInfo = this.options.showRoundInfo !== false;
		this.texts
			.get("end")
			?.setVisible(showRoundInfo)
			?.setText(
				`${this.options.roundLabel ?? "END"} ${Math.min(
					this.options.totalRounds ?? 3,
					state.currentEnd + 1,
				)} / ${this.options.totalRounds ?? 3}`,
			);
		this.texts
			.get("phase")
			?.setVisible(showRoundInfo)
			?.setText(
				this.options.phaseLabels?.[state.phase] ??
					PHASE_LABELS[state.phase] ??
					state.phase.toUpperCase(),
			);
	}

	private drawStoneDots(state: TurnState, w: number): void {
		const dotY = BAR_HEIGHT + STONES_ROW_H / 2 + 2;

		const playerCount = Math.max(
			this.options.minPlayerCount ?? 2,
			state.score.length,
		);
		const slotW = w / playerCount;

		for (let team = 0; team < playerCount; team++) {
			const count = state.stonesLeft[team] ?? 0;
			const colour = this.playerColour(team);
			const totalW = count * STONE_DOT_GAP;
			const startX =
				slotW * team + (slotW - totalW) / 2 + STONE_DOT_GAP / 2;

			for (let i = 0; i < count; i++) {
				const cx = startX + i * STONE_DOT_GAP;
				this.gfx.fillStyle(colour, 0.85);
				this.gfx.fillCircle(cx, dotY, STONE_DOT_R);
			}
		}
	}

	private drawStatusLabels(state: TurnState, w: number): void {
		const playerCount = Math.max(
			this.options.minPlayerCount ?? 2,
			state.score.length,
		);
		this.repositionStatusTexts(w, playerCount);
	}

	private repositionTexts(w: number, playerCount: number): void {
		this.texts.get("end")?.setX(w * 0.5);
		this.texts.get("phase")?.setX(w * 0.5);
		for (let player = 0; player < 5; player++) {
			const x = (player + 0.5) * (w / playerCount);
			this.texts.get(`score${player}`)?.setX(x);
			this.texts.get(`label${player}`)?.setX(x);
			this.texts.get(`status${player}`)?.setX(x);
		}
	}

	private repositionStatusTexts(w: number, playerCount: number): void {
		for (let player = 0; player < 5; player++) {
			const x = (player + 0.5) * (w / playerCount);
			this.texts.get(`status${player}`)?.setX(x);
		}
	}

	private playerLabel(player: number, playerCount: number): string {
		const customLabel = this.options.playerLabel?.(player, playerCount);
		if (customLabel) return customLabel;
		if (playerCount === 2 && player < 2) return TEAM_LABELS[player];
		return `PLAYER ${player + 1}`;
	}

	private playerColour(player: number): number {
		const colours = this.options.playerColours ?? PLAYER_COLOURS;
		return colours[player % colours.length] ?? PLAYER_COLOURS[0];
	}

	private playerHexColour(player: number): string {
		const colours = this.options.playerHexColours ?? PLAYER_HEX;
		return colours[player % colours.length] ?? PLAYER_HEX[0];
	}
}
