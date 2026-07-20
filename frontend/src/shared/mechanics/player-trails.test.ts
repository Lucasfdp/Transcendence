import type Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";

import {
	buildPlayerTrailStamps,
	drawClassicPlayerTrail,
	drawPlayerTrails,
	recordPlayerTrails,
	type PlayerTrailPoint,
	type PlayerTrailStore,
} from "./player-trails";

function createGraphicsMock() {
	return {
		fillCircle: vi.fn(),
		lineBetween: vi.fn(),
		lineStyle: vi.fn(),
	};
}

function createChainableGraphicsMock() {
	const gfx = {
		clear: vi.fn(),
		fillStyle: vi.fn(),
		fillCircle: vi.fn(),
		lineStyle: vi.fn(),
		lineBetween: vi.fn(),
		strokeCircle: vi.fn(),
	};
	for (const method of Object.values(gfx)) method.mockReturnValue(gfx);
	return gfx;
}

function makePoints(count: number): PlayerTrailPoint[] {
	return Array.from({ length: count }, (_value, index) => ({
		x: index * 10,
		y: index * 5,
	}));
}

describe("recordPlayerTrails", () => {
	it("appends points in place without replacing the stored array", () => {
		const store: PlayerTrailStore = new Map();
		const trail: PlayerTrailPoint[] = [{ x: 0, y: 0 }];
		store.set(1, trail);

		recordPlayerTrails(
			store,
			[{ id: 1, player: 0, x: 100, y: 0, moving: true }],
			{ minDistance: 1 },
		);

		expect(store.get(1)).toBe(trail);
		expect(trail).toEqual([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]);
	});

	it("trims the oldest points in place when exceeding maxPoints", () => {
		const store: PlayerTrailStore = new Map();
		const trail = makePoints(4);
		store.set("ball", trail);

		recordPlayerTrails(
			store,
			[{ id: "ball", player: 0, x: 500, y: 500, moving: true }],
			{ minDistance: 1, maxPoints: 4 },
		);

		expect(store.get("ball")).toBe(trail);
		expect(trail).toHaveLength(4);
		expect(trail[0]).toEqual({ x: 10, y: 5 });
		expect(trail[3]).toEqual({ x: 500, y: 500 });
	});

	it("skips points closer than the minimum distance", () => {
		const store: PlayerTrailStore = new Map();
		store.set(1, [{ x: 0, y: 0 }]);

		recordPlayerTrails(
			store,
			[{ id: 1, player: 0, x: 2, y: 0, moving: true }],
			{ minDistance: 8 },
		);

		expect(store.get(1)).toEqual([{ x: 0, y: 0 }]);
	});

	it("fades stopped trails from the oldest end when opted in", () => {
		const store: PlayerTrailStore = new Map();
		store.set("stopped", makePoints(5));
		const archived = makePoints(3);
		store.set("archived", archived);

		recordPlayerTrails(
			store,
			[{ id: "stopped", player: 0, x: 40, y: 20, moving: false }],
			{ stoppedFadePointsPerRecord: 2 },
		);

		expect(store.get("stopped")).toEqual([
			{ x: 20, y: 10 },
			{ x: 30, y: 15 },
			{ x: 40, y: 20 },
		]);
		// Trails absent from the call must persist untouched.
		expect(store.get("archived")).toBe(archived);
		expect(archived).toHaveLength(3);
	});

	it("deletes the store entry once a faded trail is empty", () => {
		const store: PlayerTrailStore = new Map();
		store.set("stopped", makePoints(3));
		const object = {
			id: "stopped",
			player: 0,
			x: 20,
			y: 10,
			moving: false,
		};

		recordPlayerTrails(store, [object], {
			stoppedFadePointsPerRecord: 2,
		});
		expect(store.get("stopped")).toHaveLength(1);

		recordPlayerTrails(store, [object], {
			stoppedFadePointsPerRecord: 2,
		});
		expect(store.has("stopped")).toBe(false);

		// A further call for an absent entry must be a no-op.
		recordPlayerTrails(store, [object], {
			stoppedFadePointsPerRecord: 2,
		});
		expect(store.has("stopped")).toBe(false);
	});

	it("leaves stopped trails untouched without the fade option", () => {
		const store: PlayerTrailStore = new Map();
		const trail = makePoints(4);
		store.set("stopped", trail);

		recordPlayerTrails(store, [
			{ id: "stopped", player: 0, x: 30, y: 15, moving: false },
		]);

		expect(store.get("stopped")).toBe(trail);
		expect(trail).toHaveLength(4);
	});
});

describe("drawPlayerTrails", () => {
	it("renders classic trails as polyline segments, not circle stamps", () => {
		const gfx = createChainableGraphicsMock();
		const store: PlayerTrailStore = new Map([[1, makePoints(3)]]);

		drawPlayerTrails(
			gfx as unknown as Phaser.GameObjects.Graphics,
			store,
			new Map([[1, 0]]),
		);

		expect(gfx.clear).toHaveBeenCalledTimes(1);
		expect(gfx.lineBetween).toHaveBeenCalledTimes(2);
		expect(gfx.fillCircle).not.toHaveBeenCalled();
	});

	it("limits classic trails to the recent point window", () => {
		const gfx = createChainableGraphicsMock();
		const store: PlayerTrailStore = new Map([[1, makePoints(80)]]);

		drawPlayerTrails(
			gfx as unknown as Phaser.GameObjects.Graphics,
			store,
			new Map([[1, 0]]),
		);

		// The stamp path only drew the last 32 points; the polyline path must
		// keep the same window, yielding 31 segments.
		expect(gfx.lineBetween).toHaveBeenCalledTimes(31);
	});

	it("keeps the stamp path for cosmetic trail effects", () => {
		const gfx = createChainableGraphicsMock();
		const store: PlayerTrailStore = new Map([["ball", makePoints(8)]]);

		drawPlayerTrails(
			gfx as unknown as Phaser.GameObjects.Graphics,
			store,
			new Map([["ball", 1]]),
			{ trailEffectsById: new Map([["ball", "trail_comet"]]) },
		);

		expect(gfx.fillCircle).toHaveBeenCalled();
		expect(gfx.lineBetween).not.toHaveBeenCalled();
	});

	it("falls back to the polyline path for unknown effect ids", () => {
		const gfx = createChainableGraphicsMock();
		const store: PlayerTrailStore = new Map([["ball", makePoints(3)]]);

		drawPlayerTrails(
			gfx as unknown as Phaser.GameObjects.Graphics,
			store,
			new Map([["ball", 1]]),
			{ trailEffectsById: new Map([["ball", "trail_unknown"]]) },
		);

		expect(gfx.lineBetween).toHaveBeenCalledTimes(2);
		expect(gfx.fillCircle).not.toHaveBeenCalled();
	});
});

describe("drawClassicPlayerTrail", () => {
	it("draws one progressively faded segment for every consecutive pair", () => {
		const gfx = createGraphicsMock();
		const positions = [
			{ x: 10, y: 20 },
			{ x: 30, y: 40 },
			{ x: 50, y: 60 },
		];

		drawClassicPlayerTrail(
			gfx as unknown as Phaser.GameObjects.Graphics,
			positions,
			0xf0d979,
			{ scale: 1.5 },
		);

		expect(gfx.lineBetween.mock.calls).toEqual([
			[10, 20, 30, 40],
			[30, 40, 50, 60],
		]);
		expect(gfx.lineStyle.mock.calls).toEqual([
			[6, 0xf0d979, 0.1 + (1 / 3) * 0.38],
			[6, 0xf0d979, 0.1 + (2 / 3) * 0.38],
		]);
		expect(gfx.fillCircle).not.toHaveBeenCalled();

		const compactGfx = createGraphicsMock();
		drawClassicPlayerTrail(
			compactGfx as unknown as Phaser.GameObjects.Graphics,
			positions.slice(0, 2),
			0xf0d979,
			{ scale: 0.4 },
		);
		expect(compactGfx.lineStyle).toHaveBeenCalledWith(
			2,
			0xf0d979,
			0.1 + (1 / 2) * 0.38,
		);
	});

	it.each([{ positions: [] }, { positions: [{ x: 10, y: 20 }] }])(
		"does not draw a trail with fewer than two positions",
		({ positions }) => {
			const gfx = createGraphicsMock();

			drawClassicPlayerTrail(
				gfx as unknown as Phaser.GameObjects.Graphics,
				positions,
				0xf0d979,
			);

			expect(gfx.lineStyle).not.toHaveBeenCalled();
			expect(gfx.lineBetween).not.toHaveBeenCalled();
			expect(gfx.fillCircle).not.toHaveBeenCalled();
		},
	);

	it("keeps independent trails disconnected", () => {
		const gfx = createGraphicsMock();

		drawClassicPlayerTrail(
			gfx as unknown as Phaser.GameObjects.Graphics,
			[
				{ x: 1, y: 2 },
				{ x: 3, y: 4 },
			],
			0xf0d979,
		);
		drawClassicPlayerTrail(
			gfx as unknown as Phaser.GameObjects.Graphics,
			[
				{ x: 100, y: 200 },
				{ x: 300, y: 400 },
			],
			0x9fd890,
		);

		expect(gfx.lineBetween.mock.calls).toEqual([
			[1, 2, 3, 4],
			[100, 200, 300, 400],
		]);
	});
});

describe("buildPlayerTrailStamps", () => {
	const positions = Array.from({ length: 12 }, (_value, index) => ({
		x: index * 10,
		y: 20 + index * 2,
	}));

	it("builds a continuous texture-stamped classic trail", () => {
		const stamps = buildPlayerTrailStamps(
			positions,
			0xf0d979,
			"trail_classic",
		);

		expect(stamps.length).toBeGreaterThan(positions.length);
		expect(stamps.every((stamp) => stamp.texture === "soft")).toBe(true);
		expect(stamps[stamps.length - 1]?.tint).toBe(0xf0d979);
	});

	it.each([
		["trail_comet", "soft"],
		["trail_spark", "spark"],
		["trail_ghost", "ring"],
		["trail_ripple", "ring"],
	] as const)("builds distinct %s stamps", (effect, texture) => {
		const stamps = buildPlayerTrailStamps(positions, 0xf0d979, effect);
		expect(stamps.length).toBeGreaterThan(0);
		expect(stamps.some((stamp) => stamp.texture === texture)).toBe(true);
	});

	it("falls back to classic stamps for an unknown cosmetic id", () => {
		const stamps = buildPlayerTrailStamps(
			positions,
			0xf0d979,
			"trail_unknown",
		);
		expect(stamps.length).toBeGreaterThan(positions.length);
		expect(stamps.every((stamp) => stamp.texture === "soft")).toBe(true);
	});
});
