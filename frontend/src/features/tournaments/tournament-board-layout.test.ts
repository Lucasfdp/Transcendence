import { describe, expect, it } from "vitest";

import {
	TOURNAMENT_BOARD_PATH,
	TOURNAMENT_START_POSITIONS,
	tournamentPlayerPosition,
	tournamentTilePosition,
} from "./tournament-board-layout";

describe("tournament board layout", () => {
	it("maps every one of the 28 server tiles to a unique in-bounds point", () => {
		expect(TOURNAMENT_BOARD_PATH).toHaveLength(28);
		expect(
			new Set(TOURNAMENT_BOARD_PATH.map((point) => point.tileId)).size,
		).toBe(28);
		for (const [index, point] of TOURNAMENT_BOARD_PATH.entries()) {
			expect(point.tileId).toBe(`tile-${index}`);
			expect(point.x).toBeGreaterThanOrEqual(0);
			expect(point.x).toBeLessThanOrEqual(100);
			expect(point.y).toBeGreaterThanOrEqual(0);
			expect(point.y).toBeLessThanOrEqual(100);
		}
	});

	it("starts on the lower dirt clearing and safely rejects unknown tiles", () => {
		expect(tournamentTilePosition("tile-0")).toMatchObject({
			x: 47.7,
			y: 87.8,
		});
		expect(tournamentTilePosition("tile-1")).toMatchObject({
			x: 44.7,
			y: 79,
		});
		expect(tournamentTilePosition("tile-27")).toMatchObject({
			x: 52.6,
			y: 77.7,
		});
		expect(tournamentTilePosition("unknown")).toBeNull();
		expect(tournamentTilePosition(null)).toBeNull();
	});

	it("spreads the five starting players evenly across the lower platform", () => {
		expect(TOURNAMENT_START_POSITIONS).toHaveLength(5);
		expect(
			TOURNAMENT_START_POSITIONS.map((position) => position.x),
		).toEqual([38, 43.5, 49, 54.5, 60]);
		expect(
			TOURNAMENT_START_POSITIONS.every((position) => position.y === 92),
		).toBe(true);
		for (const [seat, position] of TOURNAMENT_START_POSITIONS.entries()) {
			expect(tournamentPlayerPosition("tile-0", seat)).toEqual(position);
		}
		expect(tournamentPlayerPosition("tile-1", 0)).toEqual(
			tournamentTilePosition("tile-1"),
		);
	});
});
