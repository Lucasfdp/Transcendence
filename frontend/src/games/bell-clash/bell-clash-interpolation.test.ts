import { describe, expect, it } from "vitest";
import {
	interpolateBellPhysics,
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
});
