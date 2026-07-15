import { describe, expect, it } from "vitest";
import {
	interpolateBellPhysics,
	ONLINE_PHYSICS_MAX_EXTRAPOLATION_MS,
	type BellPhysicsSample,
} from "./bell-clash-interpolation";

const sample = (overrides: Partial<BellPhysicsSample>): BellPhysicsSample => ({
	x: 0,
	y: 0,
	vx: 0,
	vy: 0,
	radius: 52,
	stopped: false,
	serverTime: 0,
	...overrides,
});

describe("interpolateBellPhysics", () => {
	it("keeps a constant-velocity trajectory straight", () => {
		const state = interpolateBellPhysics(
			[
				sample({ x: 0, y: 10, vx: 300, serverTime: 0 }),
				sample({ x: 30, y: 10, vx: 300, serverTime: 100 }),
			],
			50,
		);

		expect(state).toMatchObject({ x: 15, y: 10, vx: 300, vy: 0 });
	});

	it("uses the authoritative sample directly when no bracketing sample exists", () => {
		const state = interpolateBellPhysics(
			[sample({ x: 42, y: -8, vx: 120, serverTime: 100 })],
			50,
		);

		expect(state).toMatchObject({ x: 42, y: -8, vx: 120 });
	});

	it("extrapolates a moving sample across a short projection gap", () => {
		const state = interpolateBellPhysics(
			[sample({ x: 10, y: 20, vx: 200, vy: -100, serverTime: 1_000 })],
			1_075,
		);

		expect(state).toMatchObject({ x: 25, y: 12.5, serverTime: 1_075 });
	});

	it("caps extrapolation and never extrapolates settled entities", () => {
		const moving = interpolateBellPhysics(
			[sample({ x: 10, vx: 200, serverTime: 1_000 })],
			1_500,
		);
		const settled = interpolateBellPhysics(
			[sample({ x: 10, vx: 200, stopped: true, serverTime: 1_000 })],
			1_500,
		);

		expect(moving).toMatchObject({
			x: 10 + 200 * (ONLINE_PHYSICS_MAX_EXTRAPOLATION_MS / 1_000),
			serverTime: 1_000 + ONLINE_PHYSICS_MAX_EXTRAPOLATION_MS,
		});
		expect(settled).toMatchObject({ x: 10, serverTime: 1_000 });
	});
});
