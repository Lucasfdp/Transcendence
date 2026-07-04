import Phaser from "phaser";

import { getGameSocket, type GameSnapshot } from "../../services/network/gameSocket";
import {
	showGameEndModal,
	type GameEndModalOptions,
} from "./game-end-modal";

interface OnlineRematchOptions extends Omit<GameEndModalOptions, "actions"> {
	readonly matchId: string;
	readonly side: number;
	readonly sceneKey: string;
	readonly onReturn?: () => void;
	readonly onOverlay?: (overlay: Phaser.GameObjects.Container) => void;
}

export function showOnlineRematchEndModal(
	scene: Phaser.Scene,
	previous: Phaser.GameObjects.Container | null | undefined,
	options: OnlineRematchOptions,
): Phaser.GameObjects.Container {
	let overlay: Phaser.GameObjects.Container;
	const socket = getGameSocket();

	const leave = (): void => {
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
	}): void => {
		socket.off("match:rematch-start", onStart);
		socket.off("match:rematch-cancelled", onCancelled);
		scene.registry.set("onlineMatch", {
			matchId: payload.matchId,
			side: payload.side,
			snapshot: payload.snapshot,
		});
		scene.scene.start(options.sceneKey);
	};

	const onCancelled = (payload: { matchId: string; reason?: string }): void => {
		if (payload.matchId !== options.matchId) return;
		overlay = showGameEndModal(scene, overlay, {
			...options,
			result: payload.reason ?? "REMATCH CANCELLED",
			actions: [{ label: "RETURN", onClick: leave }],
		});
		options.onOverlay?.(overlay);
	};

	socket.off("match:rematch-start", onStart);
	socket.off("match:rematch-cancelled", onCancelled);
	socket.on("match:rematch-start", onStart);
	socket.on("match:rematch-cancelled", onCancelled);

	overlay = showGameEndModal(scene, previous, {
		...options,
		actions: [
			{ label: "PLAY AGAIN", onClick: wait },
			{ label: "RETURN", onClick: leave },
		],
	});
	return overlay;
}
