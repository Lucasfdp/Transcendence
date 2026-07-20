/**
 * mechanics/start-countdown.ts — the shared "3, 2, 1, GO!" match opener.
 *
 * Extracted from Bamboo Bash's countdown (visuals identical) so EVERY
 * minigame — local or online — opens with the same beat: Bell Clash and
 * Temple Curling never had one, and Kame Knock only showed it online, which
 * read as "the countdown is missing" whenever the tournament rolled one of
 * those games. Presentation-only by default: it does not touch input gating
 * unless the caller wires `onComplete` (as Bamboo/Kame's own gating does).
 */

import Phaser from "phaser";

import { THEME } from "../theme";

const STEPS = ["3", "2", "1", "GO!"];
const STEP_MS = 800;

export interface StartCountdownOptions {
	/** Render depth (pass the scene's overlay depth); defaults to 100. */
	depth?: number;
	/** Fired once "GO!" finished (the text destroys itself first). */
	onComplete?: () => void;
}

/**
 * Plays "3 → 2 → 1 → GO!" centred on the scene and returns the text object
 * (callers may reposition it on resize). Timers ride the scene clock and the
 * text guards itself, so a scene shutdown mid-countdown is safe.
 */
export function runStartCountdown(
	scene: Phaser.Scene,
	options: StartCountdownOptions = {},
): Phaser.GameObjects.Text {
	const text = scene.add
		.text(scene.scale.width / 2, scene.scale.height / 2, "", {
			fontSize: "120px",
			color: THEME.textGold,
			fontFamily: THEME.font,
			fontStyle: "bold",
			stroke: "#10150f",
			strokeThickness: 8,
		})
		.setOrigin(0.5)
		.setDepth(options.depth ?? 100)
		.setShadow(0, 5, "rgba(8, 18, 11, 0.92)", 8);

	const showStep = (index: number): void => {
		if (!text.scene) return; // destroyed / scene shut down mid-countdown

		const label = STEPS[index];
		// Kill the previous step's fade-out before showing this number — its
		// fade (ends ~780 ms) can otherwise finish just after this step's
		// setAlpha(1) (cadence is 800 ms) and stamp the number blank.
		scene.tweens.killTweensOf(text);
		text.setText(label).setScale(0.4).setAlpha(1);
		scene.tweens.add({
			targets: text,
			scale: label === "GO!" ? 1.6 : 1.2,
			duration: 650,
			ease: "Back.easeOut",
		});
		scene.tweens.add({
			targets: text,
			alpha: 0,
			delay: 500,
			duration: 280,
			ease: "Cubic.easeIn",
		});

		if (index < STEPS.length - 1) {
			scene.time.delayedCall(STEP_MS, () => showStep(index + 1));
		} else {
			scene.time.delayedCall(STEP_MS, () => {
				text.destroy();
				options.onComplete?.();
			});
		}
	};

	showStep(0);
	return text;
}

/**
 * Flashes one big centred celebration label (e.g. "PERFECT!") with the same
 * beat as the countdown's "GO!": pop in with Back.easeOut, quick fade, then
 * the text destroys itself. Presentation-only; safe across scene shutdowns
 * because the tweens ride the scene and die with it.
 */
export function runSplashText(
	scene: Phaser.Scene,
	label: string,
	options: StartCountdownOptions = {},
): Phaser.GameObjects.Text {
	const text = scene.add
		.text(scene.scale.width / 2, scene.scale.height / 2, label, {
			fontSize: "120px",
			color: THEME.textGold,
			fontFamily: THEME.font,
			fontStyle: "bold",
			stroke: "#10150f",
			strokeThickness: 8,
		})
		.setOrigin(0.5)
		.setDepth(options.depth ?? 100)
		.setShadow(0, 5, "rgba(8, 18, 11, 0.92)", 8)
		.setScale(0.4)
		.setAlpha(1);

	scene.tweens.add({
		targets: text,
		scale: 1.6,
		duration: 650,
		ease: "Back.easeOut",
	});
	scene.tweens.add({
		targets: text,
		alpha: 0,
		delay: 600,
		duration: 320,
		ease: "Cubic.easeIn",
		onComplete: () => {
			text.destroy();
			options.onComplete?.();
		},
	});
	return text;
}
