import Phaser from "phaser";
import { installHiDPI } from "../shared/hidpi";
import { ShellPickerScene } from "../features/hub/ShellPickerScene";
import { ReturnToHubScene } from "../features/hub/ReturnToHubScene";
import { PhaserBootScene } from "../features/hub/PhaserBootScene";
import { BambooBashScene } from "../games/bamboo-bash/BambooBashScene";
import { ShellCurlScene } from "../games/shell-curl/ShellCurlScene";
import { KameKnockScene } from "../games/kame-knock/KameKnockScene";
import { BellClashScene } from "../games/bell-clash/BellClashScene";
import type { GameId } from "../shared/mechanics/game-powers";
import type { OnlineMatchContext } from "../services/network/gameSocket";

export interface ShellSmashStartData {
	gameId: GameId;
	targetScene: string;
	shellSelection: Record<string, string[]>;
	shellSkins?: Record<string, string>;
	user?: {
		id?: number;
		username?: string;
		turtleName?: string | null;
		shellSkin?: string;
		hubBackground?: string;
		hubBackgroundAlter?: string | null;
		isGuest?: boolean;
	};
	localMode?: "solo" | "versus";
	localPlayerCount?: number;
	localPowerupsEnabled?: boolean;
	onlineMatch?: OnlineMatchContext;
}

export function createShellSmashGame(
	parent: string | HTMLElement,
	initialScene?: ShellSmashStartData,
): Phaser.Game {
	const config: Phaser.Types.Core.GameConfig = {
		type: Phaser.AUTO,
		width: window.innerWidth,
		height: window.innerHeight,
		backgroundColor: "rgba(0,0,0,0)",
		transparent: true,
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
		game.registry.set("shellSelection", initialScene.shellSelection);
		game.registry.set("shellSkins", initialScene.shellSkins ?? {});
		if (initialScene.user) game.registry.set("user", initialScene.user);
		else game.registry.remove("user");
		game.registry.set("localMode", initialScene.localMode ?? "solo");
		game.registry.set("localPlayerCount", initialScene.localPlayerCount ?? 1);
		game.registry.set(
			"localPowerupsEnabled",
			initialScene.localPowerupsEnabled ?? true,
		);
		if (initialScene.onlineMatch) {
			game.registry.set("onlineMatch", initialScene.onlineMatch);
		} else {
			game.registry.remove("onlineMatch");
		}
		game.scene.start(initialScene.targetScene);
	}
	return game;
}
