import { describe, expect, it } from "vitest";

import { buildCommonLocalReplayPlayers } from "../runtime/LocalReplayPlayers";

describe("LocalReplayPlayers", () => {
	it("builds replay player metadata from a scene registry-like source", () => {
		const values = new Map<string, unknown>([
			[
				"user",
				{
					id: 7,
					username: "user",
					turtleName: "turtle",
					shellSkin: "red-shell",
				},
			],
			["shellSkins", { player1: "blue-shell" }],
		]);

		const players = buildCommonLocalReplayPlayers(
			{ get: (key) => values.get(key) },
			2,
		);

		expect(players).toEqual([
			expect.objectContaining({
				side: 0,
				userId: 7,
				username: "turtle",
				shellSkin: "red-shell",
			}),
			expect.objectContaining({
				side: 1,
				userId: null,
				username: "Player 2",
				shellSkin: "blue-shell",
			}),
		]);
	});
});
