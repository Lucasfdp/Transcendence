import { describe, expect, it } from "vitest";

import {
	TOURNAMENT_BOARD_PATH,
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
			x: 50,
			y: 91,
		});
		expect(tournamentTilePosition("unknown")).toBeNull();
		expect(tournamentTilePosition(null)).toBeNull();
	});
});
