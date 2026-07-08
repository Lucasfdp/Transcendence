import type Phaser from "phaser";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { remapLaunchableToArena, stepLaunchable } from "../runtime/LaunchRuntime";
import { SlingshotLaunchRuntime } from "../runtime/SlingshotLaunchRuntime";
import {
	WorldMapRuntime,
	WorldRuntime,
	type WorldEntitySnapshot,
} from "../runtime/WorldRuntime";

const slingshotInstances: Array<{
	attach: ReturnType<typeof vi.fn>;
	cancel: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
	maxDrag: number;
	launchSpeed: number;
}> = [];

vi.mock("../../../shared/mechanics/slingshot", () => ({
	Slingshot: vi.fn((_scene, _ball, config) => {
		const instance = {
			attach: vi.fn(),
			cancel: vi.fn(),
			destroy: vi.fn(),
			maxDrag: config.maxDrag,
			launchSpeed: config.launchSpeed,
		};
		slingshotInstances.push(instance);
		return instance;
	}),
}));

const oldArena = {
	cx: 100,
	cy: 80,
	rx: 50,
	ry: 40,
	scale: 1,
};

const newArena = {
	cx: 200,
	cy: 180,
	rx: 100,
	ry: 80,
	scale: 2,
};

beforeEach(() => {
	slingshotInstances.length = 0;
});

describe("LaunchRuntime", () => {
	it("remaps launchables by normalised arena position and velocity scale", () => {
		const ball = { x: 125, y: 60, vx: 10, vy: -20, r: 8 };

		remapLaunchableToArena({
			oldArena,
			newArena,
			launchable: ball,
			radius: 16,
			isMoving: () => true,
		});

		expect(ball).toEqual({ x: 250, y: 140, vx: 20, vy: -40, r: 16 });
	});

	it("delegates stopped launchables to a reset hook during relayout", () => {
		const ball = { x: 125, y: 60, vx: 0, vy: 0, r: 8 };

		remapLaunchableToArena({
			oldArena,
			newArena,
			launchable: ball,
			isMoving: () => false,
			resetWhenStopped: (target) => {
				target.x = 200;
				target.y = 180;
				target.r = 16;
			},
		});

		expect(ball).toEqual({ x: 200, y: 180, vx: 0, vy: 0, r: 16 });
	});

	it("fires the settle hook only when the stepped launchable is no longer moving", () => {
		const moving = vi.fn();
		const settled = vi.fn();
		const ball = { x: 0, y: 0, vx: 1, vy: 0, r: 8 };

		const result = stepLaunchable({
			launchable: ball,
			delta: 16,
			arena: oldArena,
			step: (launchable) => {
				launchable.vx = 0;
				return false;
			},
			isMoving: () => false,
			onMoving: moving,
			onSettled: settled,
		});

		expect(result).toBe(false);
		expect(moving).not.toHaveBeenCalled();
		expect(settled).toHaveBeenCalledWith(ball);
	});
});

describe("SlingshotLaunchRuntime", () => {
	it("owns slingshot recreation, scale sync, and teardown", () => {
		let scale = 2;
		const ball = { x: 0, y: 0, vx: 0, vy: 0, r: 10 };
		const runtime = new SlingshotLaunchRuntime({
			scene: {} as Phaser.Scene,
			getLaunchable: () => ball,
			getScale: () => scale,
			maxDragSrc: 100,
			launchSpeedSrc: 400,
			depth: 2,
			onLaunch: vi.fn(),
		});

		runtime.recreate();
		expect(slingshotInstances[0].maxDrag).toBe(200);
		expect(slingshotInstances[0].launchSpeed).toBe(800);

		scale = 3;
		runtime.syncScale();
		expect(slingshotInstances[0].maxDrag).toBe(300);
		expect(slingshotInstances[0].launchSpeed).toBe(1200);

		runtime.attach();
		runtime.cancel();
		runtime.destroy();

		expect(slingshotInstances[0].attach).toHaveBeenCalledTimes(1);
		expect(slingshotInstances[0].cancel).toHaveBeenCalledTimes(1);
		expect(slingshotInstances[0].destroy).toHaveBeenCalledTimes(1);
	});
});

interface TestEntity extends WorldEntitySnapshot {
	readonly type: "bamboo" | "target";
	readonly score?: number;
}

describe("WorldRuntime", () => {
	it("upserts, removes, filters, and serialises entities in insertion order", () => {
		const world = new WorldRuntime<TestEntity>();
		world.set({ id: 1, type: "bamboo", score: 100 });
		world.set({ id: 2, type: "target", score: 50 });
		world.set({ id: 1, type: "bamboo", score: 250 });

		expect(world.size).toBe(2);
		expect(world.get(1)?.score).toBe(250);
		expect(world.filter((entity) => entity.type === "bamboo")).toEqual([
			{ id: 1, type: "bamboo", score: 250 },
		]);
		expect(world.serialise()).toEqual([
			{ id: 1, type: "bamboo", score: 250 },
		]);
		expect(world.remove(1)).toBe(true);
		expect(world.size).toBe(0);
	});
});

describe("WorldMapRuntime", () => {
	it("owns keyed remote entity maps and serialises them", () => {
		const runtime = new WorldMapRuntime<number, { x: number }>();
		runtime.set(2, { x: 10 });
		runtime.replace(new Map([[1, { x: 20 }]]));

		expect(runtime.get(2)).toBeUndefined();
		expect(runtime.map().get(1)).toEqual({ x: 20 });
		expect(runtime.serialise((side, entity) => ({ side, x: entity.x }))).toEqual([
			{ side: 1, x: 20 },
		]);
	});
});
