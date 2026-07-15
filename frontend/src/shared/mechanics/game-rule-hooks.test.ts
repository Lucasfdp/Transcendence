import { describe, expect, it } from "vitest";

import {
	buildTurnStateFromGameRuleHooks,
	computeGameRuleWinner,
	notifyGameRuleProjectileSettled,
	notifyGameRuleRelease,
	notifyGameRuleRoundComplete,
} from "./game-rule-hooks";
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
			ballsLeft: [0, 1],
			score: [120, 160],
			phase: "aiming",
			hasHammer: false,
		});
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
