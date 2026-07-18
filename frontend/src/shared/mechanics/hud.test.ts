import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({ default: {} }));

import { buildReturnButton, TOURNAMENT_QUIT_EVENT } from "./hud";

function makeScene(registryValues: Record<string, unknown> = {}) {
	const pointerHandlers = new Map<string, () => void>();
	const text = {
		setOrigin: vi.fn().mockReturnThis(),
		setDepth: vi.fn().mockReturnThis(),
		setShadow: vi.fn().mockReturnThis(),
	};
	const zone = {
		setInteractive: vi.fn(),
		setDepth: vi.fn(),
		on: vi.fn(),
	};
	zone.setInteractive.mockReturnValue(zone);
	zone.setDepth.mockReturnValue(zone);
	zone.on.mockImplementation((event: string, handler: () => void) => {
		pointerHandlers.set(event, handler);
		return zone;
	});
	const scene = {
		scale: { width: 800, height: 600 },
		add: {
			text: vi.fn().mockReturnValue(text),
			zone: vi.fn().mockReturnValue(zone),
		},
		registry: { get: vi.fn((key: string) => registryValues[key]) },
		scene: { start: vi.fn() },
	};
	return { scene, pointerHandlers };
}

describe("buildReturnButton", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("plain matches keep the RETURN TO HUB behavior", () => {
		const { scene, pointerHandlers } = makeScene();
		const beforeReturn = vi.fn();

		buildReturnButton(scene as never, "HubScene", beforeReturn);

		expect(scene.add.text.mock.calls[0]?.[2]).toBe("RETURN TO HUB");
		pointerHandlers.get("pointerup")?.();
		expect(beforeReturn).toHaveBeenCalled();
		expect(scene.scene.start).toHaveBeenCalledWith("HubScene");
	});

	it("tournament minigames get LEAVE GAME: confirm quits the whole tournament", () => {
		const { scene, pointerHandlers } = makeScene({
			onlineMatch: { tournamentId: "t-1" },
		});
		const beforeReturn = vi.fn();
		vi.spyOn(window, "confirm").mockReturnValue(true);
		const onQuit = vi.fn();
		window.addEventListener(TOURNAMENT_QUIT_EVENT, onQuit);

		buildReturnButton(scene as never, "HubScene", beforeReturn);
		expect(scene.add.text.mock.calls[0]?.[2]).toBe("LEAVE GAME");

		pointerHandlers.get("pointerup")?.();
		window.removeEventListener(TOURNAMENT_QUIT_EVENT, onQuit);

		// GamePage owns the socket emit + navigation — the button only asks
		// for confirmation and fires the quit event; no scene switch here.
		expect(window.confirm).toHaveBeenCalledWith(
			expect.stringContaining("count"),
		);
		expect(onQuit).toHaveBeenCalledTimes(1);
		expect(beforeReturn).not.toHaveBeenCalled();
		expect(scene.scene.start).not.toHaveBeenCalled();
	});

	it("declining the confirmation leaves the match untouched", () => {
		const { scene, pointerHandlers } = makeScene({
			onlineMatch: { tournamentId: "t-1" },
		});
		vi.spyOn(window, "confirm").mockReturnValue(false);
		const onQuit = vi.fn();
		window.addEventListener(TOURNAMENT_QUIT_EVENT, onQuit);

		buildReturnButton(scene as never, "HubScene");
		pointerHandlers.get("pointerup")?.();
		window.removeEventListener(TOURNAMENT_QUIT_EVENT, onQuit);

		expect(onQuit).not.toHaveBeenCalled();
		expect(scene.scene.start).not.toHaveBeenCalled();
	});
});
