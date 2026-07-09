import { describe, expect, it } from "vitest";

import {
	ArenaBallTrailRuntime,
	buildArenaPowerBallTrailObjects,
} from "../runtime/ArenaBallTrailRuntime";

describe("ArenaBallTrailRuntime", () => {
	it("records arena ball trails and reads them in normalised arena space", () => {
		const runtime = new ArenaBallTrailRuntime();
		const arena = { cx: 100, cy: 200, rx: 50, ry: 25, scale: 2 };
		const ball = { x: 100, y: 200, vx: 1, vy: 0, r: 8 };

		runtime.reset("local", ball.x, ball.y);
		ball.x = 150;
		ball.y = 225;
		runtime.recordSet({
			balls: [{ id: "local", player: 0, ball }],
			isMoving: () => true,
			trailOptions: { minDistance: 1 },
		});

		expect(runtime.readNormalisedTrail("local", arena)).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		]);
	});

	it("builds stable trail objects for arena power balls", () => {
		const objects = buildArenaPowerBallTrailObjects(
			[
				{ player: 1, ball: { x: 10, y: 20, vx: 1, vy: 0, r: 4 } },
				{ player: 2, ball: { x: 30, y: 40, vx: 0, vy: 0, r: 4 } },
			],
			(ball) => ball.vx !== 0 || ball.vy !== 0,
		);

		expect(objects).toEqual([
			{
				id: "power-0",
				player: 1,
				x: 10,
				y: 20,
				moving: true,
			},
			{
				id: "power-1",
				player: 2,
				x: 30,
				y: 40,
				moving: false,
			},
		]);
	});

	it("reads rectangular arena trails for curling-style projectiles", () => {
		const runtime = new ArenaBallTrailRuntime();
		const arena = {
			sheetX: 50,
			sheetY: 100,
			sheetW: 200,
			sheetH: 400,
			houseFarCX: 0,
			houseFarCY: 0,
			houseNearCX: 0,
			houseNearCY: 0,
			houseRadii: [1, 1, 1, 1] as [number, number, number, number],
			deliveryX: 0,
			deliveryY: 0,
			hogX: 0,
			hogY: 0,
			orientation: "vertical" as const,
			scale: 1,
		};

		runtime.set("stone", [
			{ x: 50, y: 100 },
			{ x: 250, y: 500 },
			{ x: 300, y: 700 },
		]);

		expect(
			runtime.readRectNormalisedTrail("stone", arena, { clamp: true }),
		).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
			{ x: 1, y: 1 },
		]);
	});
});
