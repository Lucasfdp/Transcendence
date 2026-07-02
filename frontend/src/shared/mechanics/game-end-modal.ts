import Phaser from "phaser";

import { THEME } from "../theme";

export interface GameEndModalPlayer {
	readonly label: string;
	readonly score: string | number;
	readonly color?: string;
	readonly detail?: string;
}

export interface GameEndModalAction {
	readonly label: string;
	readonly onClick: () => void;
}

export interface GameEndModalOptions {
	readonly title: string;
	readonly result: string;
	readonly players: readonly GameEndModalPlayer[];
	readonly actions: readonly GameEndModalAction[];
	readonly depth?: number;
	readonly width?: number;
	readonly height?: number;
}

export function showGameEndModal(
	scene: Phaser.Scene,
	previous: Phaser.GameObjects.Container | null | undefined,
	options: GameEndModalOptions,
): Phaser.GameObjects.Container {
	previous?.destroy(true);

	const { width, height } = scene.scale;
	const panelW = Math.min(options.width ?? 560, Math.max(360, width - 32));
	const panelH = Math.min(options.height ?? 340, Math.max(300, height - 32));
	const actionCount = Math.max(1, options.actions.length);
	const buttonW = actionCount > 1 ? 180 : Math.min(220, panelW - 96);
	const buttonH = 46;
	const buttonY = panelH / 2 - 56;

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
			.text(0, -panelH / 2 + 48, options.title, {
				fontSize: "42px",
				color: THEME.textJade,
				fontFamily: THEME.fontBlowbrush,
				fontStyle: "bold",
				stroke: "#10150f",
				strokeThickness: 5,
			})
			.setOrigin(0.5)
			.setShadow(0, 3, "rgba(8, 18, 11, 0.9)", 3),
	);

	container.add(
		scene.add
			.text(0, -panelH / 2 + 96, options.result, {
				fontSize: "24px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
				align: "center",
				wordWrap: { width: panelW - 72 },
				stroke: "#10150f",
				strokeThickness: 3,
			})
			.setOrigin(0.5)
			.setShadow(0, 2, "rgba(8, 18, 11, 0.82)", 2),
	);

	const players = options.players.length > 0 ? options.players : [];
	const playerCount = Math.max(1, players.length);
	const cellW = Math.min(104, (panelW - 72) / playerCount);
	const totalW = cellW * playerCount;
	const labelSize = playerCount >= 5 ? "15px" : "17px";
	const scoreSize = playerCount >= 5 ? "23px" : "27px";
	const detailSize = playerCount >= 5 ? "11px" : "12px";
	const playersY = -panelH / 2 + 158;

	players.forEach((player, index) => {
		const color = player.color ?? THEME.text;
		const x = -totalW / 2 + cellW / 2 + index * cellW;

		container.add(
			scene.add
				.text(x, playersY, player.label, {
					fontSize: labelSize,
					color,
					fontFamily: THEME.font,
					fontStyle: "bold",
					align: "center",
					wordWrap: { width: cellW - 8 },
					stroke: "#10150f",
					strokeThickness: 2,
				})
				.setOrigin(0.5)
				.setShadow(0, 2, "rgba(8, 18, 11, 0.7)", 2),
		);

		if (player.detail) {
			container.add(
				scene.add
					.text(x, playersY + 24, player.detail, {
						fontSize: detailSize,
						color: THEME.textMutedHex,
						fontFamily: THEME.font,
						fontStyle: "bold",
						align: "center",
						wordWrap: { width: cellW - 8 },
					})
					.setOrigin(0.5),
			);
		}

		container.add(
			scene.add
				.text(x, playersY + (player.detail ? 52 : 38), String(player.score), {
					fontSize: scoreSize,
					color,
					fontFamily: THEME.font,
					fontStyle: "bold",
					align: "center",
					stroke: "#10150f",
					strokeThickness: 3,
				})
				.setOrigin(0.5)
				.setShadow(0, 2, "rgba(8, 18, 11, 0.82)", 2),
		);
	});

	const actionGap = 44;
	const actionsW =
		options.actions.length * buttonW +
		(options.actions.length - 1) * actionGap;
	options.actions.forEach((action, index) => {
		const x = -actionsW / 2 + buttonW / 2 + index * (buttonW + actionGap);
		addModalButton(scene, container, x, buttonY, buttonW, buttonH, action);
	});

	return container;
}

function addModalButton(
	scene: Phaser.Scene,
	container: Phaser.GameObjects.Container,
	x: number,
	y: number,
	width: number,
	height: number,
	action: GameEndModalAction,
): void {
	const bg = scene.add.graphics();
	bg.fillStyle(THEME.stoneInk, 0.78);
	bg.fillRoundedRect(x - width / 2, y - height / 2, width, height, 8);
	bg.lineStyle(1.5, THEME.stoneLight, 0.72);
	bg.strokeRoundedRect(x - width / 2, y - height / 2, width, height, 8);
	bg.lineStyle(1, THEME.gold, 0.52);
	bg.strokeRoundedRect(
		x - width / 2 + 3,
		y - height / 2 + 3,
		width - 6,
		height - 6,
		6,
	);
	container.add(bg);

	container.add(
		scene.add
			.text(x, y, action.label, {
				fontSize: "18px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5)
			.setShadow(0, 2, "rgba(8, 18, 11, 0.8)", 2),
	);

	const zone = scene.add
		.zone(x, y, width, height)
		.setInteractive({ useHandCursor: true });
	zone.on(
		"pointerup",
		(
			_pointer: Phaser.Input.Pointer,
			_localX: number,
			_localY: number,
			event: Phaser.Types.Input.EventData,
		) => {
			event.stopPropagation();
			zone.disableInteractive();
			action.onClick();
		},
	);
	container.add(zone);
}
