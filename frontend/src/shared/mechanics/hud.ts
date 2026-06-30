/**
 * mechanics/hud.ts — shared in-game HUD widgets for every minigame.
 */

import Phaser from "phaser";
import { THEME } from "../theme";

/**
 * Add a "Return to Hub" link under the right score panel area.
 * Returns the created objects so callers can destroy/reposition on resize.
 */
export function buildReturnButton(
	scene: Phaser.Scene,
	targetScene = "HubScene",
	beforeReturn?: () => void,
): Phaser.GameObjects.GameObject[] {
	const PAD = 16;
	const BW = 230;
	const BH = 38;
	const bx = scene.scale.width - PAD - BW;
	const by = scene.scale.height - PAD - BH;

	const label = scene.add
		.text(bx + BW / 2, by + BH / 2, "RETURN TO HUB", {
			fontSize: "20px",
			color: THEME.text,
			fontFamily: THEME.fontUrbanStone,
			fontStyle: "bold",
		})
		.setOrigin(0.5)
		.setDepth(21)
		.setShadow(0, 3, "rgba(8, 18, 11, 0.9)", 2);

	const zone = scene.add
		.zone(bx + BW / 2, by + BH / 2, BW, BH)
		.setInteractive({ useHandCursor: true })
		.setDepth(22)
		.on("pointerup", () => {
			beforeReturn?.();
			scene.scene.start(targetScene);
		});

	return [label, zone];
}
