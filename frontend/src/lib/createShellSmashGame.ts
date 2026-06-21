import Phaser from "phaser";
import { installHiDPI } from "../shared/hidpi";
import { ShellPickerScene } from "../features/hub/ShellPickerScene";
import { ReturnToHubScene } from "../features/hub/ReturnToHubScene";
import { PhaserBootScene } from "../features/hub/PhaserBootScene";
import { BambooBashScene } from "../games/bamboo-bash/BambooBashScene";
import { ShellCurlScene } from "../games/shell-curl/ShellCurlScene";
import { KameKnockScene } from "../games/kame-knock/KameKnockScene";
import { BellClashScene } from "../games/bell-clash/BellClashScene";
import type { ShellPickerData } from "../features/hub/ShellPickerScene";

export function createShellSmashGame(
	parent: string | HTMLElement,
	initialScene?: ShellPickerData,
): Phaser.Game {
	const config: Phaser.Types.Core.GameConfig = {
		type: Phaser.AUTO,
		width: window.innerWidth,
		height: window.innerHeight,
		backgroundColor: "#0d1117",
		parent,
		scene: [
			PhaserBootScene,
			ShellPickerScene,
			ReturnToHubScene,
			BambooBashScene,
			ShellCurlScene,
			KameKnockScene,
			BellClashScene,
		],
		scale: {
			mode: Phaser.Scale.RESIZE,
			autoCenter: Phaser.Scale.NO_CENTER,
		},
	};

	const game = new Phaser.Game(config);
	installHiDPI(game);
	if (initialScene) {
		game.scene.start("ShellPickerScene", initialScene);
	}
	return game;
}
