import { describe, expect, it } from "vitest";

import {
	appendAuthoritativeSample,
	AuthoritativeProjectionTimeline,
	interpolateAuthoritativePhysics,
	type AuthoritativePhysicsSample,
} from "./authoritative-projection";

const sample = (
	overrides: Partial<AuthoritativePhysicsSample>,
): AuthoritativePhysicsSample => ({
	x: 0,
	y: 0,
	vx: 0,
	vy: 0,
	radius: 20,
	stopped: false,
	serverTime: 0,
	...overrides,
});

describe("AuthoritativeProjectionTimeline", () => {
	it("keeps a bounded, ordered sample history", () => {
		let samples: AuthoritativePhysicsSample[] = [];
		for (let index = 0; index < 14; index++)
			samples = appendAuthoritativeSample(samples, sample({ serverTime: index }));

		expect(samples).toHaveLength(12);
		expect(samples[0].serverTime).toBe(2);
		expect(appendAuthoritativeSample(samples, sample({ serverTime: 13 }))).toHaveLength(12);
	});

	it("interpolates between authoritative samples", () => {
		const state = interpolateAuthoritativePhysics(
			[
				sample({ x: 0, vx: 300, serverTime: 0 }),
				sample({ x: 30, vx: 300, serverTime: 100 }),
			],
			50,
		);

		expect(state).toMatchObject({ x: 15, vx: 300 });
	});

	it("extrapolates briefly instead of freezing when the next packet is late", () => {
		const state = interpolateAuthoritativePhysics(
			[sample({ x: 10, vx: 200, serverTime: 100 })],
			140,
		);

		expect(state).toMatchObject({ x: 18, serverTime: 140 });
	});

	it("raises the interpolation delay after a sequence gap", () => {
		const timeline = new AuthoritativeProjectionTimeline();
		timeline.accept(1, 1_000, 1_020);
		timeline.accept(3, 1_066, 1_150);

		expect(timeline.interpolationDelayMs).toBeGreaterThan(100);
		expect(timeline.accept(3, 1_099, 1_180)).toBe(false);
	});
});
