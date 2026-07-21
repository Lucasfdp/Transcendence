import { describe, expect, it } from "vitest";

import {
	buildTurnStateFromGameRuleHooks,
	computeGameRuleWinner,
	notifyGameRuleProjectileSettled,
	notifyGameRuleRelease,
	notifyGameRuleRoundComplete,
	perSeatShotsRemaining,
	turnlessOnlineHighlight,
} from "./game-rule-hooks";
import type { TurnState } from "./turn-manager";

describe("turnlessOnlineHighlight", () => {
	it("always resolves to the local viewer's own seat, not a fixed seat", () => {
		// Regression: Bamboo Bash's online getCurrentPlayer used to hardcode
		// seat 0 instead of the local seat, so in a CPU-filled tournament
		// match where the human sits elsewhere, the ACTIVE/READY HUD chips
		// stayed glued to whichever CPU was in seat 0 — or, if the human WAS
		// seat 0, glued to them regardless of which seat actually just shot,
		// reported as "the throw counter seems to follow the player's shots
		// for everyone". Bell Clash already got this right; Bamboo Bash now
		// shares the same helper so the two can't diverge again.
		expect(turnlessOnlineHighlight(0)).toBe(0);
		expect(turnlessOnlineHighlight(3)).toBe(3);
		expect(turnlessOnlineHighlight(4)).toBe(4);
	});

	it("clamps a spectator's side (-1) to a valid HUD index", () => {
		expect(turnlessOnlineHighlight(-1)).toBe(0);
	});
});

describe("perSeatShotsRemaining", () => {
	it("computes each seat's own remaining shots, not the local viewer's for everyone", () => {
		// Regression: Bell Clash's scoreboard used to repeat ONE number (the
		// local viewer's own shots-taken count) for every seat's "balls left"
		// dots — so with several CPU seats, all of them appeared to burn
		// shots in lockstep with whatever the human just did. Each seat has
		// its own entry in `shotCounts` on the wire; every seat's dots must
		// come from its OWN entry.
		const shotCounts = [3, 0, 1, 2]; // side 0 (human) took all 3 shots already
		expect(perSeatShotsRemaining(shotCounts, 4, 3)).toEqual([0, 3, 2, 1]);
	});

	it("never goes negative and treats a missing entry as zero shots taken", () => {
		expect(perSeatShotsRemaining([5], 2, 3)).toEqual([0, 3]);
		expect(perSeatShotsRemaining(undefined, 2, 3)).toEqual([3, 3]);
	});
});

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
			ballsLeft: [0, 1],
			score: [120, 160],
			phase: "aiming",
			hasHammer: false,
			firstPlayer: 0,
		});
	});

	it("threads a game's own first-turn player through to the HUD state", () => {
		expect(
			buildTurnStateFromGameRuleHooks({
				getPlayerCount: () => 3,
				getCurrentPlayer: () => 2,
				getCurrentRound: () => 0,
				getRemainingTurns: () => [1, 1, 1],
				getScore: () => [0, 0, 0],
				getPhase: () => "aiming",
				getFirstPlayer: () => 2,
			}),
		).toMatchObject({ firstPlayer: 2 });
	});

	it("lets games override HUD construction when their rule model is special", () => {
		const hudState: TurnState = {
			currentTeam: 0,
			currentEnd: 2,
			ballsLeft: [1],
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

	it("routes lifecycle events through optional game rule hooks", () => {
		const calls: string[] = [];
		const projectile = { id: "shell" };

		notifyGameRuleRelease(
			{ onRelease: (value) => calls.push(`release:${value.id}`) },
			projectile,
		);
		notifyGameRuleProjectileSettled(
			{ onProjectileSettled: (value) => calls.push(`settled:${value.id}`) },
			projectile,
		);
		notifyGameRuleRoundComplete({
			onRoundComplete: () => calls.push("round-complete"),
		});

		expect(calls).toEqual([
			"release:shell",
			"settled:shell",
			"round-complete",
		]);
	});

	it("resolves winners through optional game rule hooks", () => {
		expect(computeGameRuleWinner({ computeWinner: () => 1 })).toBe(1);
		expect(computeGameRuleWinner({})).toBeNull();
	});
});
