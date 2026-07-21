import { describe, expect, it } from "vitest";

import { seatAtDisplaySlot, TurnManager } from "./turn-manager";

describe("seatAtDisplaySlot", () => {
	it("defaults to identity (raw side order) when no first player is given", () => {
		// No turn order (Bell Clash/Bamboo Bash) or a local match: the
		// scoreboard must render exactly as it always has, seat N at slot N.
		for (let slot = 0; slot < 5; slot++) {
			expect(seatAtDisplaySlot(slot, 5)).toBe(slot);
		}
	});

	it("shows players starting from the match's first-turn player, wrapping around", () => {
		// A match where seat 2 (of 4) went first: the scoreboard reads
		// left-to-right in ACTUAL play order — 2, 3, 0, 1 — not raw side order.
		const firstPlayer = 2;
		const playerCount = 4;
		const displayed = Array.from({ length: playerCount }, (_v, slot) =>
			seatAtDisplaySlot(slot, playerCount, firstPlayer),
		);
		expect(displayed).toEqual([2, 3, 0, 1]);
	});
});

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
