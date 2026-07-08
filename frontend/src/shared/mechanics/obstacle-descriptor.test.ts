import { describe, expect, it } from "vitest";

import {
	buildCircularObstacleDescriptor,
	hitsCircularObstacle,
	obstacleToBlocker,
	resolveObstaclePosition,
	resolveObstacleRadius,
} from "./obstacle-descriptor";
import {
	type TimedTarget,
	timedTargetObstacleDescriptor,
} from "./timed-targets";
import {
	type Bamboo,
	bambooObstacleDescriptor,
} from "../../games/bamboo-bash/bamboo";

const arena = {
	cx: 100,
	cy: 80,
	rx: 50,
	ry: 40,
	scale: 2,
};

describe("obstacle-descriptor", () => {
	it("resolves normalised circular obstacles against an arena", () => {
		const obstacle = buildCircularObstacleDescriptor({
			id: "centre-left",
			type: "test",
			position: { mode: "normalised", x: -0.5, y: 0.25 },
			radius: 12,
			radiusUnit: "source",
			scoreValue: 100,
			collision: { breaks: true, awardsPoints: true },
		});

		expect(resolveObstaclePosition(obstacle, arena)).toEqual({
			x: 75,
			y: 90,
		});
		expect(resolveObstacleRadius(obstacle, arena)).toBe(24);
		expect(hitsCircularObstacle(obstacle, arena, 80, 90, 2)).toBe(true);
		expect(hitsCircularObstacle(obstacle, arena, 130, 90, 2)).toBe(false);
	});

	it("builds pickup blockers from circular obstacles", () => {
		const obstacle = buildCircularObstacleDescriptor({
			id: 1,
			type: "solid-target",
			position: { mode: "absolute", x: 20, y: 30 },
			radius: 10,
			radiusUnit: "pixels",
		});

		expect(obstacleToBlocker(obstacle, arena, 4)).toEqual({
			x: 20,
			y: 30,
			r: 14,
		});
	});

	it("resolves absolute pixel obstacles without an arena frame", () => {
		const obstacle = buildCircularObstacleDescriptor({
			id: "bumper",
			type: "bumper",
			position: { mode: "absolute", x: 42, y: 64 },
			radius: 16,
			radiusUnit: "pixels",
			collision: { blocks: true, bounces: true },
		});

		expect(resolveObstaclePosition(obstacle)).toEqual({ x: 42, y: 64 });
		expect(resolveObstacleRadius(obstacle)).toBe(16);
		expect(hitsCircularObstacle(obstacle, undefined, 50, 64, 4)).toBe(true);
		expect(obstacleToBlocker(obstacle)).toEqual({ x: 42, y: 64, r: 16 });
	});

	it("describes bamboo as breakable score obstacles", () => {
		const bamboo: Bamboo = { nx: 0.2, ny: -0.5, stage: 3, ageMs: 12_000 };
		const descriptor = bambooObstacleDescriptor(bamboo, "bamboo-1");

		expect(descriptor).toMatchObject({
			id: "bamboo-1",
			type: "bamboo",
			position: { mode: "normalised", x: 0.2, y: -0.5 },
			scoreValue: 250,
			collision: { breaks: true, awardsPoints: true },
			rendering: { stage: 3, ageMs: 12_000 },
		});
		expect(resolveObstacleRadius(descriptor, arena)).toBeCloseTo(84);
	});

	it("describes timed targets as breakable or bouncing obstacles", () => {
		const breakableTarget: TimedTarget = {
			id: 7,
			kind: "daruma",
			breakable: true,
			nx: 0,
			ny: 0,
			ageMs: 100,
			lifetimeMs: 5000,
			radiusSrc: 18,
			points: 50,
		};
		const solidTarget = { ...breakableTarget, id: 8, breakable: false };

		expect(timedTargetObstacleDescriptor(breakableTarget)).toMatchObject({
			id: 7,
			type: "timed-target",
			scoreValue: 50,
			collision: { breaks: true, awardsPoints: true },
			rendering: { kind: "daruma", breakable: true },
		});
		expect(timedTargetObstacleDescriptor(solidTarget).collision).toEqual({
			blocks: true,
			bounces: true,
			breaks: false,
			awardsPoints: false,
		});
	});
});
