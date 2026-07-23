import Phaser from "phaser";
import { ShellPickerScene } from "../features/hub/ShellPickerScene";
import { ReturnToHubScene } from "../features/hub/ReturnToHubScene";
import { PhaserBootScene } from "../features/hub/PhaserBootScene";
import { detectSoftwareRenderer } from "../features/backdrop/starField";
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

// Defer the first scene start to the next macrotask so postBoot returns before
// Phaser drives the scene, matching the previous behaviour. Named so the timer
// teardown below reads clearly rather than repeating a bare literal.
const SCENE_START_DELAY_MS = 0;

/**
 * Build the Phaser game configuration. Extracted from {@link createShellSmashGame}
 * so the scene list, render tuning, initial-scene registry wiring, and —
 * crucially — the scene-start timer teardown can be unit-tested without
 * constructing a real WebGL context.
 */
export function buildShellSmashGameConfig(
	parent: string | HTMLElement,
	initialScene?: ShellSmashStartData,
): Phaser.Types.Core.GameConfig {
	return {
		// Phaser's WebGL Graphics renderer rebuilds path and triangulation
		// objects on every rendered frame. On llvmpipe, SWGL, and SwiftShader
		// that caused the one-megabyte nursery to fill almost every frame.
		// Canvas keeps the same scene contract while avoiding that WebGL
		// allocation path on machines where rendering is already CPU-bound.
		type: detectSoftwareRenderer() ? Phaser.CANVAS : Phaser.AUTO,
		banner: false,
		width: window.innerWidth,
		height: window.innerHeight,
		backgroundColor: "rgba(0,0,0,0)",
		transparent: true,
		parent,
		render: {
			// Prefer the discrete GPU where the browser exposes a choice, but
			// never refuse a context on a machine that only offers a software or
			// integrated caveat renderer — the game must still start on the
			// software-WebGL destination used for the performance baseline.
			// These are context-creation hints only and do not change the
			// rendered output. RESIZE mode already draws at CSS-pixel resolution
			// (device-pixel-ratio independent), which is the intended cheap path
			// under software rendering, so no DPR multiplier is applied.
			powerPreference: "high-performance",
			failIfMajorPerformanceCaveat: false,
		},
		callbacks: {
			postBoot: (game) => scheduleInitialScene(game, initialScene),
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
}

/**
 * Configure the registry and, when an initial scene is supplied, start it on the
 * next macrotask. The scheduling timer is cleared on game destruction so a game
 * torn down within the same tick (a fast route bounce, or a StrictMode
 * mount/unmount pair) never calls `scene.start` on a destroyed game.
 */
export function scheduleInitialScene(
	game: Phaser.Game,
	initialScene?: ShellSmashStartData,
): void {
	configureInitialScene(game, initialScene);
	if (!initialScene) return;
	const startTimer = globalThis.setTimeout(() => {
		game.scene.start(initialScene.targetScene);
	}, SCENE_START_DELAY_MS);
	game.events.once(Phaser.Core.Events.DESTROY, () => {
		globalThis.clearTimeout(startTimer);
	});
}

export function createShellSmashGame(
	parent: string | HTMLElement,
	initialScene?: ShellSmashStartData,
): Phaser.Game {
	const game = new Phaser.Game(buildShellSmashGameConfig(parent, initialScene));
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
