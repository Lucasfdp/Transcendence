import Phaser from "phaser";

import {
	getGameSocket,
	type GameSnapshot,
	type OnlineMatchContext,
} from "../../services/network/gameSocket";
import { showGameEndModal, type GameEndModalOptions } from "./game-end-modal";
import { applySnapshotPlayerCosmetics } from "./player-config";

interface OnlineRematchOptions extends Omit<GameEndModalOptions, "actions"> {
	readonly matchId: string;
	readonly side: number;
	readonly sceneKey: string;
	readonly onReturn?: () => void;
	readonly onOverlay?: (overlay: Phaser.GameObjects.Container) => void;
}

const rematchListenerCleanup = new WeakMap<Phaser.Scene, () => void>();

/** Tournament minigames auto-return to the board after this many seconds. */
const TOURNAMENT_CONTINUE_SECONDS = 15;

export function showOnlineRematchEndModal(
	scene: Phaser.Scene,
	previous: Phaser.GameObjects.Container | null | undefined,
	options: OnlineRematchOptions,
): Phaser.GameObjects.Container {
	let overlay: Phaser.GameObjects.Container;
	const socket = getGameSocket();
	rematchListenerCleanup.get(scene)?.();
	let disposed = false;

	// Tournament minigame (the room carries the owning tournament id): no
	// rematch here — the tournament coordinator decides what comes next. One
	// CONTINUE button plus a countdown; when it hits 0 we continue anyway so an
	// idle player never lingers on the end screen. Continuing starts HubScene,
	// whose return-to-hub event GamePage redirects to `/tournament/:id`.
	const tournamentId = (
		scene.registry.get("onlineMatch") as { tournamentId?: string } | undefined
	)?.tournamentId;
	if (tournamentId) {
		return showTournamentContinueModal(scene, previous, options);
	}

	const disposeListeners = (): void => {
		if (disposed) return;
		disposed = true;
		socket.off("match:rematch-start", onStart);
		socket.off("match:rematch-cancelled", onCancelled);
		scene.events.off("shutdown", disposeListeners);
		if (rematchListenerCleanup.get(scene) === disposeListeners)
			rematchListenerCleanup.delete(scene);
	};

	const leave = (): void => {
		disposeListeners();
		socket.emit("match:leave-finished", { matchId: options.matchId });
		options.onReturn?.();
		scene.registry.remove("onlineMatch");
		scene.scene.start("HubScene");
	};

	const wait = (): void => {
		socket.emit("match:play-again", { matchId: options.matchId });
		overlay = showGameEndModal(scene, overlay, {
			...options,
			result: "WAITING FOR OTHER PLAYERS...",
			actions: [{ label: "RETURN", onClick: leave }],
		});
		options.onOverlay?.(overlay);
	};

	const onStart = (payload: {
		matchId: string;
		side: number;
		gameId: string;
		snapshot: GameSnapshot;
		physicsState?: OnlineMatchContext["physicsState"];
		replayEnabled?: boolean;
		replayDisabledReason?: "powerups-enabled" | null;
	}): void => {
		disposeListeners();
		applySnapshotPlayerCosmetics(scene.registry, payload.snapshot.players);
		scene.registry.set("onlineMatch", {
			matchId: payload.matchId,
			side: payload.side,
			snapshot: payload.snapshot,
			physicsState: payload.physicsState,
			replayEnabled: payload.replayEnabled,
			replayDisabledReason: payload.replayDisabledReason,
		});
		scene.scene.start(options.sceneKey);
	};

	const onCancelled = (payload: {
		matchId: string;
		reason?: string;
	}): void => {
		if (payload.matchId !== options.matchId) return;
		disposeListeners();
		overlay = showGameEndModal(scene, overlay, {
			...options,
			result: payload.reason ?? "REMATCH CANCELLED",
			actions: [{ label: "RETURN", onClick: leave }],
		});
		options.onOverlay?.(overlay);
	};

	socket.on("match:rematch-start", onStart);
	socket.on("match:rematch-cancelled", onCancelled);
	scene.events.once("shutdown", disposeListeners);
	rematchListenerCleanup.set(scene, disposeListeners);

	overlay = showGameEndModal(scene, previous, {
		...options,
		actions: [
			{ label: "PLAY AGAIN", onClick: wait },
			{ label: "RETURN", onClick: leave },
		],
	});
	return overlay;
}

interface TournamentContinueCountdown {
	readonly matchId: string;
	/** Re-render with fresh options, keeping the running countdown. */
	readonly show: (
		previous: Phaser.GameObjects.Container | null | undefined,
		options: OnlineRematchOptions,
	) => Phaser.GameObjects.Container;
	readonly cancel: () => void;
}

/**
 * One live countdown per scene. The scenes rebuild their end screen whenever
 * the overlay is destroyed (e.g. the resize handler), which re-enters
 * `showTournamentContinueModal`; without this registry every re-entry armed a
 * SECOND ticking timer and the two re-rendered the modal on alternating
 * seconds, each with its own count ("13, 12, 14, 11, 13, 10…").
 */
const tournamentContinueCountdowns = new WeakMap<
	Phaser.Scene,
	TournamentContinueCountdown
>();

function showTournamentContinueModal(
	scene: Phaser.Scene,
	previous: Phaser.GameObjects.Container | null | undefined,
	options: OnlineRematchOptions,
): Phaser.GameObjects.Container {
	const running = tournamentContinueCountdowns.get(scene);
	if (running && running.matchId === options.matchId)
		return running.show(previous, options);
	running?.cancel();

	const socket = getGameSocket();
	let overlay: Phaser.GameObjects.Container | null | undefined = previous;
	let currentOptions = options;
	let remaining = TOURNAMENT_CONTINUE_SECONDS;
	let done = false;

	const dispose = (): void => {
		if (done) return;
		done = true;
		timer.remove();
		scene.events.off("shutdown", dispose);
		if (tournamentContinueCountdowns.get(scene)?.matchId === options.matchId)
			tournamentContinueCountdowns.delete(scene);
	};

	const continueToTournament = (): void => {
		if (done) return;
		dispose();
		socket.emit("match:leave-finished", { matchId: currentOptions.matchId });
		currentOptions.onReturn?.();
		scene.registry.remove("onlineMatch");
		scene.scene.start("HubScene");
	};

	// The modal is fully rebuilt each tick (the same idiom the rematch flow
	// uses for its WAITING/CANCELLED re-renders) so the countdown stays live.
	const render = (): Phaser.GameObjects.Container => {
		overlay = showGameEndModal(scene, overlay, {
			...currentOptions,
			result: `${currentOptions.result} — BACK TO THE BOARD IN ${remaining}s`,
			actions: [{ label: "CONTINUE", onClick: continueToTournament }],
		});
		currentOptions.onOverlay?.(overlay);
		return overlay;
	};

	const timer = scene.time.addEvent({
		delay: 1_000,
		repeat: TOURNAMENT_CONTINUE_SECONDS - 1,
		callback: () => {
			remaining -= 1;
			if (remaining <= 0) continueToTournament();
			else render();
		},
	});
	scene.events.once("shutdown", dispose);
	tournamentContinueCountdowns.set(scene, {
		matchId: options.matchId,
		show: (nextPrevious, nextOptions) => {
			// The caller may have destroyed the previous overlay (resize
			// rebuild passes undefined); keep our reference in that case —
			// showGameEndModal safely ignores an already-destroyed container.
			if (nextPrevious) overlay = nextPrevious;
			currentOptions = nextOptions;
			return render();
		},
		cancel: dispose,
	});

	return render();
}
