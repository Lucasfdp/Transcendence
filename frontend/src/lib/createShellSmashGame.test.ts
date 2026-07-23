import { afterEach, describe, expect, it, vi } from "vitest";

// Mock Phaser and every scene module so the config builder and timer teardown
// can be exercised without a WebGL context or the heavy scene graph.
vi.mock("phaser", () => ({
	default: {
		AUTO: "AUTO",
		Scale: { RESIZE: "RESIZE", NO_CENTER: "NO_CENTER" },
		Core: { Events: { DESTROY: "destroy" } },
	},
}));
vi.mock("../features/hub/ShellPickerScene", () => ({
	ShellPickerScene: class {},
}));
vi.mock("../features/hub/ReturnToHubScene", () => ({
	ReturnToHubScene: class {},
	RETURN_TO_HUB_EVENT: "return-to-hub",
}));
vi.mock("../features/hub/PhaserBootScene", () => ({
	PhaserBootScene: class {},
}));
vi.mock("../games/bamboo-bash/BambooBashScene", () => ({
	BambooBashScene: class {},
}));
vi.mock("../games/shell-curl/ShellCurlScene", () => ({
	ShellCurlScene: class {},
}));
vi.mock("../games/kame-knock/KameKnockScene", () => ({
	KameKnockScene: class {},
}));
vi.mock("../games/bell-clash/BellClashScene", () => ({
	BellClashScene: class {},
}));
vi.mock("../shared/frontend-performance-profiler", () => ({
	trackFrontendPerformanceResource: vi.fn(() => vi.fn()),
}));
vi.mock("../shared/mechanics/player-config", () => ({
	resolveSnapshotPlayerCosmetics: vi.fn(() => undefined),
}));

import {
	buildShellSmashGameConfig,
	scheduleInitialScene,
	type ShellSmashStartData,
} from "./createShellSmashGame";

function fakeGame() {
	const destroyHandlers: Array<() => void> = [];
	const game = {
		registry: { set: vi.fn(), remove: vi.fn() },
		scene: { start: vi.fn() },
		events: {
			once: vi.fn((_event: string, handler: () => void) => {
				destroyHandlers.push(handler);
			}),
		},
	};
	return { game, destroy: () => destroyHandlers.forEach((h) => h()) };
}

const startData: ShellSmashStartData = {
	gameId: "kame-knock",
	targetScene: "KameKnockScene",
	shellSelection: { player0: [] },
	replayEnabled: true,
	replayDisabledReason: null,
};

describe("buildShellSmashGameConfig", () => {
	it("registers all seven scenes and RESIZE scaling", () => {
		const config = buildShellSmashGameConfig("host");

		expect(config.type).toBe("AUTO");
		expect(config.parent).toBe("host");
		expect(config.transparent).toBe(true);
		expect(Array.isArray(config.scene) && config.scene.length).toBe(7);
		expect(config.scale?.mode).toBe("RESIZE");
	});

	it("keeps a context on caveat renderers via safe render hints", () => {
		const config = buildShellSmashGameConfig("host");

		expect(config.render?.failIfMajorPerformanceCaveat).toBe(false);
		expect(config.render?.powerPreference).toBe("high-performance");
	});
});

describe("scheduleInitialScene", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("does nothing further when no initial scene is supplied", () => {
		vi.useFakeTimers();
		const { game } = fakeGame();

		scheduleInitialScene(game as never);
		vi.runAllTimers();

		expect(game.scene.start).not.toHaveBeenCalled();
		expect(game.events.once).not.toHaveBeenCalled();
	});

	it("wires the registry and starts the target scene on the next tick", () => {
		vi.useFakeTimers();
		const { game } = fakeGame();

		scheduleInitialScene(game as never, startData);

		expect(game.registry.set).toHaveBeenCalledWith("shellSelection", {
			player0: [],
		});
		// No user / online match on this data → those keys are cleared, never set.
		expect(game.registry.remove).toHaveBeenCalledWith("user");
		expect(game.registry.remove).toHaveBeenCalledWith("onlineMatch");
		expect(game.scene.start).not.toHaveBeenCalled();

		vi.runAllTimers();
		expect(game.scene.start).toHaveBeenCalledWith("KameKnockScene");
	});

	it("cancels the scene-start timer when the game is destroyed first", () => {
		vi.useFakeTimers();
		const { game, destroy } = fakeGame();

		scheduleInitialScene(game as never, startData);
		// Game torn down within the same tick (fast route bounce / StrictMode).
		destroy();
		vi.runAllTimers();

		expect(game.scene.start).not.toHaveBeenCalled();
	});
});
