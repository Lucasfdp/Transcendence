/**
 * mechanics/hud.ts — shared in-game HUD widgets for every minigame.
 */

import Phaser from "phaser";
import { THEME } from "../theme";

/**
 * Fired by the in-arena "LEAVE GAME" button of a tournament minigame after the
 * player confirms. GamePage listens: it emits `tournament:quit` (permanent —
 * CPU takes over, counts as a loss) and navigates back to the hub.
 */
export const TOURNAMENT_QUIT_EVENT = "shellsmash:quit-tournament";

const TOURNAMENT_QUIT_CONFIRM =
	"Are you sure you want to quit the game? This counts as a LOSS on your " +
	"record. A CPU will take your place for the rest of the tournament and " +
	"you won't be able to rejoin.";

/**
 * Add a "Return to Hub" link under the right score panel area.
 * Returns the created objects so callers can destroy/reposition on resize.
 *
 * Tournament minigames (the online-match context carries `tournamentId`) get
 * a "LEAVE GAME" button instead: there is no hub to casually return to
 * mid-tournament — leaving means quitting the WHOLE tournament for good, so
 * it asks for confirmation and then fires TOURNAMENT_QUIT_EVENT (handled by
 * GamePage, which owns the socket emit + navigation).
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
	const isTournament = Boolean(
		(
			scene.registry.get("onlineMatch") as
				| { tournamentId?: string }
				| undefined
		)?.tournamentId,
	);

	const label = scene.add
		.text(
			bx + BW / 2,
			by + BH / 2,
			isTournament ? "LEAVE GAME" : "RETURN TO HUB",
			{
				fontSize: "20px",
				color: THEME.text,
				fontFamily: THEME.font,
				fontStyle: "bold",
			},
		)
		.setOrigin(0.5)
		.setDepth(21)
		.setShadow(0, 3, "rgba(8, 18, 11, 0.9)", 2);

	const zone = scene.add
		.zone(bx + BW / 2, by + BH / 2, BW, BH)
		.setInteractive({ useHandCursor: true })
		.setDepth(22)
		.on("pointerup", () => {
			if (isTournament) {
				if (window.confirm(TOURNAMENT_QUIT_CONFIRM)) {
					window.dispatchEvent(new CustomEvent(TOURNAMENT_QUIT_EVENT));
				}
				return;
			}
			beforeReturn?.();
			scene.scene.start(targetScene);
		});

	return [label, zone];
}
