import { describe, expect, it } from "vitest";
import type { ReplayFrameSnapshot } from "../../../features/hub/api";
import {
	resolveActiveReplayBackground,
	resolveActiveReplaySide,
} from "../replayVisuals";

const players: ReplayFrameSnapshot["players"] = [
	{
		side: 0,
		userId: 1,
		username: "A",
		hubBackground: "night_bg",
		hubBackgroundAlter: null,
	},
	{
		side: 1,
		userId: 2,
		username: "B",
		hubBackground: "sunset_bg",
		hubBackgroundAlter: "cycle_bg",
	},
];

describe("replayVisuals", () => {
	it("resolves active side from currentTurn first", () => {
		expect(resolveActiveReplaySide({ players, currentTurn: 1 }, 0)).toBe(1);
	});

	it("resolves active side from active stone entity", () => {
		const snapshot: ReplayFrameSnapshot = {
			players,
			activeStoneId: "stone-2",
			entities: [
				{ id: "stone-1", type: "stone", side: 0, x: 0, y: 0 },
				{ id: "stone-2", type: "stone", side: 1, x: 0, y: 0 },
			],
		};

		expect(resolveActiveReplaySide(snapshot, 0)).toBe(1);
	});

	it("resolves active side from active ball id and falls back to id index", () => {
		expect(
			resolveActiveReplaySide(
				{
					players,
					activeBallIdBySide: [null, "missing"],
					entities: [],
				},
				0,
			),
		).toBe(1);
	});

	it("keeps previous side when no active marker exists", () => {
		expect(resolveActiveReplaySide({ players }, 1)).toBe(1);
	});

	it("prefers player background alter and normalises cycle_bg", () => {
		expect(resolveActiveReplayBackground({ players }, 1)).toBe("night_cycle_bg");
	});

	it("falls back to night_bg for unknown backgrounds", () => {
		expect(
			resolveActiveReplayBackground(
				{
					players: [
						{
							side: 0,
							userId: 1,
							username: "A",
							hubBackground: "unknown",
						},
					],
				},
				0,
			),
		).toBe("night_bg");
	});
});
