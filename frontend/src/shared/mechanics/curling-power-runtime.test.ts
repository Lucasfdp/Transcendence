import { describe, expect, it } from "vitest";

import type { StoneState } from "./ball";
import { CurlingPowerRuntime } from "./curling-power-runtime";
import { ALL_POWERS, PowerRegistry, PowerType } from "./power-system";
import type { RectArenaPixels } from "./rect-arena";

const arena = {
	sheetX: 0,
	sheetY: 0,
	sheetW: 600,
	sheetH: 300,
	houseFarCX: 500,
	houseFarCY: 150,
	houseNearCX: 100,
	houseNearCY: 150,
	houseRadii: [80, 50, 25, 8] as [number, number, number, number],
	deliveryX: 50,
	deliveryY: 150,
	hogX: 450,
	hogY: 150,
	orientation: "horizontal" as const,
	scale: 1,
} satisfies RectArenaPixels;

function createRuntime(): CurlingPowerRuntime {
	let nextId = 10;
	const registry = new PowerRegistry();
	for (const type of Object.values(PowerType))
		registry.register(ALL_POWERS[type]);
	return new CurlingPowerRuntime(registry, () => nextId++);
}

function createStone(overrides: Partial<StoneState> = {}): StoneState {
	return {
		id: 1,
		teamId: 0,
		x: 100,
		y: 150,
		vx: 120,
		vy: 0,
		r: 20,
		power: PowerType.NONE,
		stopped: false,
		curlBias: 0,
		...overrides,
	};
}

describe("CurlingPowerRuntime", () => {
	it("applies registered stone powers through a shared runtime", () => {
		const runtime = createRuntime();
		const stone = createStone();

		runtime.applyPower(PowerType.HEAVY, stone, arena);

		expect(stone.power).toBe(PowerType.HEAVY);
		expect(stone.vx).toBeLessThan(120);
	});

	it("steps curling stones through the shared runtime", () => {
		const runtime = createRuntime();
		const stone = createStone();

		const moving = runtime.stepStone(stone, 16.67, arena);

		expect(moving).toBe(true);
		expect(stone.x).toBeGreaterThan(100);
	});

	it("materialises split and mirror spawn requests outside the scene", () => {
		const runtime = createRuntime();
		const splitSource = createStone({ splitterPending: true });
		const mirrorSource = createStone({
			mirrorPending: true,
			y: 75,
			vy: 30,
		});

		const split = runtime.consumeSpawnRequests(splitSource, arena);
		const mirror = runtime.consumeSpawnRequests(mirrorSource, arena);

		expect(split.removeSource).toBe(true);
		expect(split.children).toHaveLength(3);
		expect(split.children.map((stone) => stone.id)).toEqual([10, 11, 12]);
		expect(mirror.removeSource).toBe(false);
		expect(mirror.children).toEqual([
			expect.objectContaining({
				id: 13,
				y: 225,
				vy: -30,
			}),
		]);
	});

	it("resolves stone collisions and triggers active collision powers", () => {
		const runtime = createRuntime();
		const active = createStone({
			power: PowerType.GHOST,
			x: 100,
			y: 150,
			vx: 50,
		});
		const other = createStone({
			id: 2,
			x: 130,
			y: 150,
			vx: 0,
			teamId: 1,
		});

		runtime.resolveCollisions([active, other], arena, {
			activeStone: active,
			triggerActiveCollisionPower: true,
		});

		expect(active.ghostUsed).toBe(true);
	});
});
