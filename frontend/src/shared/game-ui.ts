import type { PanelRect } from "./ui/panels/side-panel";

export const GAME_UI = {
	panelWidth: 230,
	panelMinCanvasW: 1_180,
	panelMinCanvasH: 560,
	panelPad: 16,
	panelTop: 74,
	returnLinkSpace: 58,
	contentTop: 78,
	contentBottom: 58,
	playablePad: 18,
} as const;

export const PLAYER_HEX_COLOURS = [
	"#5b9bd1",
	"#d95d4e",
	"#63b56e",
	"#e8c15a",
	"#a678c8",
] as const;

export const PLAYER_COLOUR_VALUES = [
	0x5b9bd1,
	0xd95d4e,
	0x63b56e,
	0xe8c15a,
	0xa678c8,
] as const;

export interface GameHudLayout {
	readonly leftPanel?: PanelRect;
	readonly rightPanel?: PanelRect;
	readonly contentRect: PanelRect;
}

export function playerHexColour(player: number): string {
	return PLAYER_HEX_COLOURS[player % PLAYER_HEX_COLOURS.length];
}

export function resolveGameHudLayout(width: number, height: number): GameHudLayout {
	const contentTop = GAME_UI.contentTop;
	const fullContent = {
		x: 0,
		y: contentTop,
		width,
		height: Math.max(1, height - contentTop - GAME_UI.contentBottom),
	};

	if (
		width < GAME_UI.panelMinCanvasW ||
		height < GAME_UI.panelMinCanvasH
	) {
		return { contentRect: fullContent };
	}

	const panelH =
		height - GAME_UI.panelTop - GAME_UI.panelPad - GAME_UI.returnLinkSpace;
	const gutterW = GAME_UI.panelPad + GAME_UI.panelWidth + GAME_UI.panelPad;
	const contentW = width - gutterW * 2;
	if (panelH < 200 || contentW < 360) return { contentRect: fullContent };

	return {
		leftPanel: {
			x: GAME_UI.panelPad,
			y: GAME_UI.panelTop,
			width: GAME_UI.panelWidth,
			height: panelH,
		},
		rightPanel: {
			x: width - GAME_UI.panelPad - GAME_UI.panelWidth,
			y: GAME_UI.panelTop,
			width: GAME_UI.panelWidth,
			height: panelH,
		},
		contentRect: {
			x: gutterW + GAME_UI.playablePad,
			y: contentTop + GAME_UI.playablePad,
			width: Math.max(1, contentW - GAME_UI.playablePad * 2),
			height: Math.max(
				1,
				height - contentTop - GAME_UI.contentBottom - GAME_UI.playablePad * 2,
			),
		},
	};
}
