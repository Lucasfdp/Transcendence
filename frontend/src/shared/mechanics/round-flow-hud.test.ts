import { describe, expect, it } from "vitest";

import { buildHudStateFromRoundFlow } from "./round-flow-hud";

describe("round-flow-hud", () => {
	it("defaults hasHammer to false", () => {
		expect(
			buildHudStateFromRoundFlow({
				playerCount: 2,
				currentTeam: 0,
				currentRound: 1,
				stonesLeft: [4, 4],
				score: [0, 0],
				phase: "aiming",
			}),
		).toMatchObject({ hasHammer: false });
	});

	it("passes through explicit hasHammer", () => {
		expect(
			buildHudStateFromRoundFlow({
				playerCount: 2,
				currentTeam: 1,
				currentRound: 2,
				stonesLeft: [2, 1],
				score: [4, 6],
				phase: "settling",
				hasHammer: true,
			}),
		).toMatchObject({
			currentTeam: 1,
			currentEnd: 2,
			hasHammer: true,
		});
	});
});
