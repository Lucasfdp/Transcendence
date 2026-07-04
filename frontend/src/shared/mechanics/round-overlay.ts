import Phaser from "phaser";

import { THEME } from "../theme";

export interface RoundOverlayOptions {
	readonly message: string;
	readonly buttonLabel?: string | null;
	readonly onButton?: (() => void) | null;
	readonly depth?: number;
	readonly width?: number;
	readonly height?: number;
	readonly autoDismissMs?: number;
	readonly onAutoDismiss?: (() => void) | null;
}

export function showRoundTransitionOverlay(
	scene: Phaser.Scene,
	previous: Phaser.GameObjects.Container | null | undefined,
	options: RoundOverlayOptions,
): Phaser.GameObjects.Container {
	previous?.destroy(true);

	const { width, height } = scene.scale;
	const panelW = Math.min(options.width ?? 560, Math.max(320, width - 32));
	const panelH = options.height ?? (options.buttonLabel ? 240 : 160);
	const buttonLabel = options.buttonLabel ?? null;
	const buttonY = panelH / 2 - 58;
	const buttonW = Math.min(220, panelW - 80);
	const buttonH = 46;
	const messageY = buttonLabel ? -36 : 0;

	const container = scene.add
		.container(width / 2, height / 2)
		.setDepth(options.depth ?? 100);

	const bg = scene.add.graphics();
	bg.fillStyle(THEME.stoneDeep, 0.9);
	bg.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
	bg.lineStyle(2, THEME.stoneLight, 0.82);
	bg.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
	bg.lineStyle(1, THEME.gold, 0.58);
	bg.strokeRoundedRect(
		-panelW / 2 + 4,
		-panelH / 2 + 4,
		panelW - 8,
		panelH - 8,
		12,
	);
	container.add(bg);

	container.add(
		scene.add
			.text(0, messageY, options.message, {
				fontSize: "24px",
				color: THEME.text,
				fontFamily: THEME.font,
				fontStyle: "bold",
				align: "center",
				wordWrap: { width: panelW - 56 },
				stroke: "#10150f",
				strokeThickness: 3,
			})
			.setOrigin(0.5)
			.setShadow(0, 3, "rgba(8, 18, 11, 0.85)", 3),
	);

	if (buttonLabel && options.onButton) {
		const btnBg = scene.add.graphics();
		btnBg.fillStyle(THEME.stoneInk, 0.78);
		btnBg.fillRoundedRect(
			-buttonW / 2,
			buttonY - buttonH / 2,
			buttonW,
			buttonH,
			8,
		);
		btnBg.lineStyle(1.5, THEME.gold, 0.8);
		btnBg.strokeRoundedRect(
			-buttonW / 2,
			buttonY - buttonH / 2,
			buttonW,
			buttonH,
			8,
		);
		container.add(btnBg);

		container.add(
			scene.add
				.text(0, buttonY, buttonLabel, {
					fontSize: "18px",
					color: THEME.textGold,
					fontFamily: THEME.font,
					fontStyle: "bold",
				})
				.setOrigin(0.5)
				.setShadow(0, 2, "rgba(8, 18, 11, 0.8)", 2),
		);

		const zone = scene.add
			.zone(0, buttonY, buttonW, buttonH)
			.setInteractive({ useHandCursor: true });
		zone.on("pointerup", () => {
			container.destroy(true);
			options.onButton?.();
		});
		container.add(zone);
	}

	if (!buttonLabel && options.autoDismissMs && options.onAutoDismiss) {
		scene.time.delayedCall(options.autoDismissMs, () => {
			if (!container.active) return;
			container.destroy(true);
			options.onAutoDismiss?.();
		});
	}

	return container;
}
