import { describe, expect, it } from "vitest";

import { buildTurnStateFromGameRuleHooks } from "./game-rule-hooks";
import type { TurnState } from "./turn-manager";

describe("game-rule-hooks", () => {
	it("builds a TurnState from generic game rule hooks", () => {
		expect(
			buildTurnStateFromGameRuleHooks({
				getPlayerCount: () => 2,
				getCurrentPlayer: () => 1,
				getCurrentRound: () => 3,
				getRemainingTurns: () => [0, 1],
				getScore: () => [120, 160],
				getPhase: () => "aiming",
			}),
		).toEqual({
			currentTeam: 1,
			currentEnd: 3,
			stonesLeft: [0, 1],
			score: [120, 160],
			phase: "aiming",
			hasHammer: false,
		});
	});

	it("lets games override HUD construction when their rule model is special", () => {
		const hudState: TurnState = {
			currentTeam: 0,
			currentEnd: 2,
			stonesLeft: [1],
			score: [500],
			phase: "scoring",
			hasHammer: true,
		};

		expect(
			buildTurnStateFromGameRuleHooks({
				buildHudState: () => hudState,
				getPlayerCount: () => 99,
				getCurrentPlayer: () => 98,
				getCurrentRound: () => 97,
				getRemainingTurns: () => [96],
				getScore: () => [95],
				getPhase: () => "gameover",
			}),
		).toBe(hudState);
	});
});
