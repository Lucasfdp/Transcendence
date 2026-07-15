import { describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
	default: {
		Scene: class {},
		Scale: { Events: { RESIZE: "resize" } },
		Scenes: { Events: { SHUTDOWN: "shutdown", DESTROY: "destroy" } },
	},
}));

import { ResponsiveScene } from "./responsive-scene";

class TestResponsiveScene extends ResponsiveScene {
	readonly cleanup = vi.fn();

	protected relayout(): void {}

	protected onShutdown(): void {
		this.cleanup();
	}
}

type Listener = { callback: () => void; context: unknown; once: boolean };

function createScene(): {
	scene: TestResponsiveScene;
	emit(event: string): void;
	scale: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> };
} {
	const listeners = new Map<string, Listener[]>();
	const events = {
		on(event: string, callback: () => void, context: unknown): void {
			const entries = listeners.get(event) ?? [];
			entries.push({ callback, context, once: false });
			listeners.set(event, entries);
		},
		once(event: string, callback: () => void, context: unknown): void {
			const entries = listeners.get(event) ?? [];
			entries.push({ callback, context, once: true });
			listeners.set(event, entries);
		},
		off(event: string, callback: () => void, context: unknown): void {
			listeners.set(
				event,
				(listeners.get(event) ?? []).filter(
					(listener) =>
						listener.callback !== callback || listener.context !== context,
				),
			);
		},
	};
	const scale = { on: vi.fn(), off: vi.fn() };
	const scene = Object.create(TestResponsiveScene.prototype) as TestResponsiveScene;
	Object.assign(scene, {
		cleanup: vi.fn(),
		events,
		scale,
		_resizeTimer: null,
		_responsiveOn: false,
		_hasTeardown: false,
	});

	return {
		scene,
		scale,
		emit(event: string): void {
			for (const listener of [...(listeners.get(event) ?? [])]) {
				if (listener.once) events.off(event, listener.callback, listener.context);
				listener.callback.call(listener.context);
			}
		},
	};
}

describe("ResponsiveScene lifecycle cleanup", () => {
	it("cleans external listeners when Phaser destroys the game without shutdown", () => {
		const { scene, emit, scale } = createScene();

		(scene as unknown as { enableResponsive(): void }).enableResponsive();
		emit("destroy");

		expect(scene.cleanup).toHaveBeenCalledTimes(1);
		expect(scale.off).toHaveBeenCalledTimes(1);
	});

	it("cleans once per lifecycle and can register again after shutdown", () => {
		const { scene, emit, scale } = createScene();
		const responsive = scene as unknown as { enableResponsive(): void };

		responsive.enableResponsive();
		emit("shutdown");
		emit("destroy");

		expect(scene.cleanup).toHaveBeenCalledTimes(1);
		expect(scale.off).toHaveBeenCalledTimes(1);

		responsive.enableResponsive();
		emit("shutdown");

		expect(scene.cleanup).toHaveBeenCalledTimes(2);
		expect(scale.on).toHaveBeenCalledTimes(2);
	});
});
