/**
 * game/arenas/curl-sheet.ts — arena definition for Shell Curl.
 *
 * The sheet is landscape-oriented (wide) filling almost the full canvas.
 * Stones are delivered from the LEFT and travel RIGHTWARD towards the house.
 * All measurements are in source pixels at 1920×1080 reference resolution.
 */

import type Phaser from "phaser";
import {
	rectArenaPlayableToScreenInRect,
	type RectArenaDef,
	type RectArenaPixels,
} from "../mechanics/rect-arena";

export const CURL_SHEET: RectArenaDef = {
	srcW: 1920,
	srcH: 1080,

	// Sheet rectangle — right margin widened to 230 src-px so the power-guide
	// side panel can fit in the right strip at typical screen resolutions.
	// Left margin stays at 120 (original). Total: 120 + 1570 + 230 = 1920. ✓
	sheetX: 120,
	sheetY: 100,
	sheetW: 1570,
	sheetH: 880,

	// House geometry — scoring house is at the RIGHT end
	houseRadius: 220, // outermost ring in source px
	houseCentreOffset: 380, // distance from sheet end-line to house centre

	orientation: "horizontal",
};

export const CURL_SHEET_SKIN = {
	key: "rectangle-arena-skin",
	source: "/assets/textures/arenas/rectangleSkinArena.png",
	width: 1536,
	height: 1100,
	// Bright interior detected from the supplied texture. The slight asymmetry
	// follows the hand-painted inner stone edge rather than centring by eye.
	playableX: 163,
	playableY: 160,
	playableW: 1232,
	playableH: 791,
} as const;

export interface CurlSheetSkinPixels {
	cx: number;
	cy: number;
	width: number;
	height: number;
}

export interface CurlSheetLayout {
	arena: RectArenaPixels;
	skin: CurlSheetSkinPixels;
}

export function preloadCurlSheetSkin(scene: Phaser.Scene): void {
	if (!scene.textures.exists(CURL_SHEET_SKIN.key))
		scene.load.image(CURL_SHEET_SKIN.key, CURL_SHEET_SKIN.source);
}

/** Fit the complete stone frame while preserving the authored game physics. */
export function resolveCurlSheetLayoutInRect(
	rectX: number,
	rectY: number,
	rectW: number,
	rectH: number,
): CurlSheetLayout {
	const outerWAtUnitScale =
		(CURL_SHEET_SKIN.width * CURL_SHEET.sheetW) /
		CURL_SHEET_SKIN.playableW;
	const outerHAtUnitScale =
		(CURL_SHEET_SKIN.height * CURL_SHEET.sheetH) /
		CURL_SHEET_SKIN.playableH;
	const scale = Math.min(
		rectW / outerWAtUnitScale,
		rectH / outerHAtUnitScale,
	);
	const skinWidth = outerWAtUnitScale * scale;
	const skinHeight = outerHAtUnitScale * scale;
	const skinX = rectX + (rectW - skinWidth) / 2;
	const skinY = rectY + (rectH - skinHeight) / 2;
	const skinScaleX = (CURL_SHEET.sheetW * scale) / CURL_SHEET_SKIN.playableW;
	const skinScaleY = (CURL_SHEET.sheetH * scale) / CURL_SHEET_SKIN.playableH;
	const sheetX = skinX + CURL_SHEET_SKIN.playableX * skinScaleX;
	const sheetY = skinY + CURL_SHEET_SKIN.playableY * skinScaleY;

	return {
		arena: rectArenaPlayableToScreenInRect(
			CURL_SHEET,
			sheetX,
			sheetY,
			CURL_SHEET.sheetW * scale,
			CURL_SHEET.sheetH * scale,
		),
		skin: {
			cx: skinX + skinWidth / 2,
			cy: skinY + skinHeight / 2,
			width: skinWidth,
			height: skinHeight,
		},
	};
}

export function layoutCurlSheetSkin(
	image: Phaser.GameObjects.Image,
	skin: CurlSheetSkinPixels,
): void {
	image
		.setOrigin(0.5)
		.setPosition(skin.cx, skin.cy)
		.setDisplaySize(skin.width, skin.height);
}
