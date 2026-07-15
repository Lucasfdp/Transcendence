import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	const socket = {
		on: vi.fn((event: string, handler: (payload: unknown) => void) => {
			const handlers = listeners.get(event) ?? new Set();
			handlers.add(handler);
			listeners.set(event, handlers);
		}),
		off: vi.fn((event: string, handler: (payload: unknown) => void) => {
			listeners.get(event)?.delete(handler);
		}),
		emit: vi.fn(),
	};
	return {
		listeners,
		socket,
		showGameEndModal: vi.fn(),
	};
});

vi.mock("phaser", () => ({ default: {} }));
vi.mock("../../services/network/gameSocket", () => ({
	getGameSocket: () => mocks.socket,
}));
vi.mock("./game-end-modal", () => ({
	showGameEndModal: mocks.showGameEndModal,
}));

import { showOnlineRematchEndModal } from "./online-rematch";

function makeScene() {
	const shutdownListeners = new Set<() => void>();
	return {
		events: {
			once: vi.fn((_event: string, handler: () => void) =>
				shutdownListeners.add(handler),
			),
			off: vi.fn((_event: string, handler: () => void) =>
				shutdownListeners.delete(handler),
			),
		},
		registry: { set: vi.fn(), remove: vi.fn() },
		scene: { start: vi.fn() },
	};
}

const options = {
	title: "TEMPLE CURLING",
	result: "DRAW",
	players: [],
	matchId: "old-match",
	side: 0,
	sceneKey: "ShellCurlScene",
};

describe("online rematch modal", () => {
	beforeEach(() => {
		mocks.listeners.clear();
		mocks.socket.on.mockClear();
		mocks.socket.off.mockClear();
		mocks.socket.emit.mockClear();
		mocks.showGameEndModal.mockReset();
		mocks.showGameEndModal.mockImplementation(
			(_scene, _previous, modalOptions) => ({ modalOptions }),
		);
	});

	it("replaces duplicate end-state listeners and starts the rematch once", () => {
		const scene = makeScene();
		showOnlineRematchEndModal(scene as never, null, options);
		showOnlineRematchEndModal(scene as never, null, options);

		expect(mocks.listeners.get("match:rematch-start")?.size).toBe(1);
		const physicsState = {
			matchId: "new-match",
			physicsSeq: 0,
			serverTime: 100,
			entities: [],
		};
		const snapshot = {
			matchId: "new-match",
			gameId: "temple-curling",
			phase: "active",
		};
		for (const handler of mocks.listeners.get("match:rematch-start") ?? [])
			handler({
				matchId: "new-match",
				side: 0,
				gameId: "temple-curling",
				snapshot,
				physicsState,
				replayEnabled: false,
				replayDisabledReason: "powerups-enabled",
			});

		expect(scene.registry.set).toHaveBeenCalledWith("onlineMatch", {
			matchId: "new-match",
			side: 0,
			snapshot,
			physicsState,
			replayEnabled: false,
			replayDisabledReason: "powerups-enabled",
		});
		expect(scene.scene.start).toHaveBeenCalledTimes(1);
		expect(scene.scene.start).toHaveBeenCalledWith("ShellCurlScene");
	});

	it("sends the shared play-again request from every game modal", () => {
		const scene = makeScene();
		showOnlineRematchEndModal(scene as never, null, options);
		const firstModal = mocks.showGameEndModal.mock.calls[0]?.[2] as {
			actions: Array<{ label: string; onClick(): void }>;
		};

		firstModal.actions
			.find((action) => action.label === "PLAY AGAIN")
			?.onClick();

		expect(mocks.socket.emit).toHaveBeenCalledWith("match:play-again", {
			matchId: "old-match",
		});
	});
});
