import { describe, expect, it } from "vitest";

import { TurnManager } from "./turn-manager";

describe("TurnManager", () => {
	it("tracks the remaining balls for every player", () => {
		const manager = new TurnManager({
			totalEnds: 3,
			ballsPerTeam: 3,
			playerCount: 3,
		});

		expect(manager.state.ballsLeft).toEqual([3, 3, 3]);

		manager.nextThrow();

		expect(manager.state.ballsLeft).toEqual([2, 3, 3]);
		expect(manager.state.currentTeam).toBe(1);
	});

	it("resets the ball allowance when an end finishes", () => {
		const manager = new TurnManager({
			totalEnds: 2,
			ballsPerTeam: 2,
		});
		manager.nextThrow();

		manager.endEnd(0, 1);

		expect(manager.state).toMatchObject({
			currentEnd: 1,
			ballsLeft: [2, 2],
			score: [1, 0],
		});
	});
});
