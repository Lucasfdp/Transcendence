import Phaser from "phaser";
import { ShellPickerScene } from "../features/hub/ShellPickerScene";
import { ReturnToHubScene } from "../features/hub/ReturnToHubScene";
import { PhaserBootScene } from "../features/hub/PhaserBootScene";
import { BambooBashScene } from "../games/bamboo-bash/BambooBashScene";
import { ShellCurlScene } from "../games/shell-curl/ShellCurlScene";
import { KameKnockScene } from "../games/kame-knock/KameKnockScene";
import { BellClashScene } from "../games/bell-clash/BellClashScene";
import type { GameId } from "../shared/mechanics/game-powers";
import { trackFrontendPerformanceResource } from "../shared/frontend-performance-profiler";
import type { OnlineMatchContext } from "../services/network/gameSocket";
import { resolveSnapshotPlayerCosmetics } from "../shared/mechanics/player-config";

export interface ShellSmashStartData {
	gameId: GameId;
	targetScene: string;
	shellSelection: Record<string, string[]>;
	shellSkins?: Record<string, string>;
	trailEffects?: Record<string, string>;
	user?: {
		id?: number;
		username?: string;
		turtleName?: string | null;
		shellSkin?: string;
		trailEffect?: string;
		hubBackground?: string;
		hubBackgroundAlter?: string | null;
		isGuest?: boolean;
	};
	localMode?: "solo" | "versus";
	localPlayerCount?: number;
	localPowerupsEnabled?: boolean;
	replayEnabled: boolean;
	replayDisabledReason: "powerups-enabled" | null;
	onlineMatch?: OnlineMatchContext;
}

export function createShellSmashGame(
	parent: string | HTMLElement,
	initialScene?: ShellSmashStartData,
): Phaser.Game {
	const config: Phaser.Types.Core.GameConfig = {
		type: Phaser.AUTO,
		banner: false,
		width: window.innerWidth,
		height: window.innerHeight,
		backgroundColor: "rgba(0,0,0,0)",
		transparent: true,
		parent,
		callbacks: {
			postBoot: (game) => {
				configureInitialScene(game, initialScene);
				if (!initialScene) return;
				window.setTimeout(
					() => game.scene.start(initialScene.targetScene),
					0,
				);
			},
		},
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
	const releaseGame = trackFrontendPerformanceResource("phaserGames");
	const releaseCanvas = trackFrontendPerformanceResource("canvases");
	game.events.once(Phaser.Core.Events.DESTROY, () => {
		releaseCanvas();
		releaseGame();
	});
	return game;
}

function configureInitialScene(
	game: Phaser.Game,
	initialScene?: ShellSmashStartData,
): void {
	if (!initialScene) return;
	const onlineCosmetics = initialScene.onlineMatch?.snapshot
		? resolveSnapshotPlayerCosmetics(initialScene.onlineMatch.snapshot.players)
		: undefined;

	game.registry.set("shellSelection", initialScene.shellSelection);
	game.registry.set(
		"shellSkins",
		initialScene.shellSkins ?? onlineCosmetics?.shellSkins ?? {},
	);
	game.registry.set(
		"trailEffects",
		initialScene.trailEffects ?? onlineCosmetics?.trailEffects ?? {},
	);
	if (initialScene.user) game.registry.set("user", initialScene.user);
	else game.registry.remove("user");
	game.registry.set("localMode", initialScene.localMode ?? "solo");
	game.registry.set("localPlayerCount", initialScene.localPlayerCount ?? 1);
	game.registry.set(
		"localPowerupsEnabled",
		initialScene.localPowerupsEnabled ?? false,
	);
	game.registry.set("replayEnabled", initialScene.replayEnabled);
	game.registry.set(
		"replayDisabledReason",
		initialScene.replayDisabledReason,
	);
	if (initialScene.onlineMatch) {
		game.registry.set("onlineMatch", initialScene.onlineMatch);
	} else {
		game.registry.remove("onlineMatch");
	}
}
