import { describe, expect, it, vi } from "vitest";

import {
	applySnapshotPlayerCosmetics,
	resolveSnapshotPlayerCosmetics,
} from "./player-config";

describe("snapshot player cosmetics", () => {
	it("maps cosmetics by side rather than snapshot order", () => {
		expect(
			resolveSnapshotPlayerCosmetics([
				{ side: 1, shellSkin: "dragon", trailEffect: "trail_spark" },
				{ side: 0, shellSkin: "bamboo", trailEffect: "trail_ghost" },
			]),
		).toEqual({
			shellSkins: { player0: "bamboo", player1: "dragon" },
			trailEffects: { player0: "trail_ghost", player1: "trail_spark" },
		});
	});

	it("uses safe defaults and ignores invalid sides", () => {
		expect(
			resolveSnapshotPlayerCosmetics([
				{ side: 0 },
				{ side: -1, shellSkin: "purple", trailEffect: "trail_comet" },
			]),
		).toEqual({
			shellSkins: { player0: "base" },
			trailEffects: { player0: "trail_classic" },
		});
	});

	it("updates both Phaser registry maps together", () => {
		const registry = { set: vi.fn() };
		applySnapshotPlayerCosmetics(registry, [
			{ side: 2, shellSkin: "purple", trailEffect: "trail_ripple" },
		]);

		expect(registry.set).toHaveBeenNthCalledWith(1, "shellSkins", {
			player2: "purple",
		});
		expect(registry.set).toHaveBeenNthCalledWith(2, "trailEffects", {
			player2: "trail_ripple",
		});
	});
});
