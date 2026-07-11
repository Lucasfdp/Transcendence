import { describe, expect, it } from "vitest";

import {
	buildReplayProjectileEntities,
	buildReplayBallEntities,
} from "../runtime/ReplayEntities";

describe("ReplayEntities", () => {
	it("maps projectile snapshots through the common replay entity boundary", () => {
		expect(
			buildReplayProjectileEntities(
				[
					{
						id: "ball-1",
						side: 0,
						x: 0.4,
						y: 0.5,
						vx: 1,
						vy: 2,
						power: "giant",
						moving: true,
					},
				],
				"fallback-shell",
			),
		).toEqual([
			expect.objectContaining({
				id: "ball-1",
				type: "projectile",
				spriteKey: "fallback-shell",
				scale: 2,
				stateFlags: expect.arrayContaining(["moving", "power:giant"]),
			}),
		]);
	});

	it("maps ball snapshots through the common replay entity boundary", () => {
		expect(
			buildReplayBallEntities([
				{
					id: 3,
					side: 1,
					x: 0.5,
					y: 0.7,
					power: "ghost",
					moving: false,
				},
			]),
		).toEqual([
			expect.objectContaining({
				id: 3,
				type: "ball",
				side: 1,
				alpha: 0.52,
				stateFlags: expect.arrayContaining(["settled", "power:ghost"]),
			}),
		]);
	});
});
