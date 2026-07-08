import type Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";

import { CommonGameSceneHost } from "../scene/CommonGameSceneHost";
import { SceneSocketChannel } from "../scene/SceneSocketChannel";

describe("CommonGameSceneHost", () => {
	it("dispatches update and relayout through the scene host", () => {
		const update = vi.fn();
		const relayout = vi.fn();
		const runtimeUpdate = vi.fn();
		const runtimeRelayout = vi.fn();
		const host = new CommonGameSceneHost({} as Phaser.Scene, {
			descriptor: { gameId: "bamboo-bash", sceneKey: "BambooBashScene" },
			update,
			relayout,
		});

		host.registerRuntime({
			id: "runtime",
			update: runtimeUpdate,
			relayout: runtimeRelayout,
		});

		host.update(120, 16);
		host.relayout();

		expect(update).toHaveBeenCalledWith(120, 16);
		expect(runtimeUpdate).toHaveBeenCalledWith(120, 16);
		expect(relayout).toHaveBeenCalledTimes(1);
		expect(runtimeRelayout).toHaveBeenCalledTimes(1);
	});

	it("runs shutdown cleanup once and ignores later dispatches", () => {
		const update = vi.fn();
		const shutdown = vi.fn();
		const runtimeShutdown = vi.fn();
		const host = new CommonGameSceneHost({} as Phaser.Scene, {
			descriptor: { gameId: "bamboo-bash", sceneKey: "BambooBashScene" },
			update,
			shutdown,
		});

		host.registerRuntime({
			id: "runtime",
			shutdown: runtimeShutdown,
		});

		host.shutdown();
		host.shutdown();
		host.update(200, 16);

		expect(runtimeShutdown).toHaveBeenCalledTimes(1);
		expect(shutdown).toHaveBeenCalledTimes(1);
		expect(update).not.toHaveBeenCalled();
	});

	it("can be activated again when Phaser reuses a scene instance", () => {
		const update = vi.fn();
		const shutdown = vi.fn();
		const host = new CommonGameSceneHost({} as Phaser.Scene, {
			descriptor: { gameId: "bamboo-bash", sceneKey: "BambooBashScene" },
			update,
			shutdown,
		});

		host.shutdown();
		host.activate();
		host.update(300, 16);

		expect(shutdown).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith(300, 16);
	});
});

describe("SceneSocketChannel", () => {
	it("registers listeners with a defensive off and removes them on shutdown", () => {
		const socket = {
			on: vi.fn(),
			off: vi.fn(),
		};
		const listener = vi.fn();
		const channel = new SceneSocketChannel(() => socket);

		channel.on("game:state", listener);
		channel.shutdown();
		channel.shutdown();

		expect(socket.off).toHaveBeenNthCalledWith(
			1,
			"game:state",
			listener,
		);
		expect(socket.on).toHaveBeenCalledWith("game:state", listener);
		expect(socket.off).toHaveBeenNthCalledWith(
			2,
			"game:state",
			listener,
		);
		expect(socket.off).toHaveBeenCalledTimes(2);
	});
});
