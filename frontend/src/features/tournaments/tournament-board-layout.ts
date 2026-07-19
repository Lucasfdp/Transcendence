export interface TournamentBoardPoint {
	readonly tileId: string;
	/** Percentage of the 16:9 map width. */
	readonly x: number;
	/** Percentage of the 16:9 map height. */
	readonly y: number;
}

export type TournamentBoardPosition = Pick<TournamentBoardPoint, "x" | "y">;

/** Fixed, evenly spaced bays for the five players on the lower platform. */
export const TOURNAMENT_START_POSITIONS: readonly TournamentBoardPosition[] = [
	{ x: 38, y: 92 },
	{ x: 43.5, y: 92 },
	{ x: 49, y: 92 },
	{ x: 54.5, y: 92 },
	{ x: 60, y: 92 },
] as const;

/**
 * Presentation-only anchors following the visible dirt path clockwise. The
 * backend owns successor order; these coordinates only decide where each
 * authoritative tile is drawn over tournamentMap.png.
 */
export const TOURNAMENT_BOARD_PATH: readonly TournamentBoardPoint[] = [
	{ tileId: "tile-0", x: 47.7, y: 87.8 },
	{ tileId: "tile-1", x: 44.7, y: 79 },
	{ tileId: "tile-2", x: 36, y: 82.5 },
	{ tileId: "tile-3", x: 29.3, y: 86 },
	{ tileId: "tile-4", x: 22, y: 88 },
	{ tileId: "tile-5", x: 14, y: 86 },
	{ tileId: "tile-6", x: 9, y: 80 },
	{ tileId: "tile-7", x: 7.7, y: 70 },
	{ tileId: "tile-8", x: 10, y: 59 },
	{ tileId: "tile-9", x: 17, y: 54 },
	{ tileId: "tile-10", x: 23.5, y: 53 },
	{ tileId: "tile-11", x: 33, y: 63 },
	{ tileId: "tile-12", x: 39, y: 51 },
	{ tileId: "tile-13", x: 46, y: 50 },
	{ tileId: "tile-14", x: 53.5, y: 48 },
	{ tileId: "tile-15", x: 60, y: 41 },
	{ tileId: "tile-16", x: 68, y: 43 },
	{ tileId: "tile-17", x: 74, y: 38 },
	{ tileId: "tile-18", x: 80.5, y: 36 },
	{ tileId: "tile-19", x: 87, y: 43 },
	{ tileId: "tile-20", x: 90, y: 52 },
	{ tileId: "tile-21", x: 88, y: 67 },
	{ tileId: "tile-22", x: 83, y: 63 },
	{ tileId: "tile-23", x: 75.5, y: 61 },
	{ tileId: "tile-24", x: 66.8, y: 66 },
	{ tileId: "tile-25", x: 63.5, y: 72 },
	{ tileId: "tile-26", x: 58, y: 75 },
	{ tileId: "tile-27", x: 52.6, y: 77.7 },
] as const;

const POSITION_BY_TILE = new Map(
	TOURNAMENT_BOARD_PATH.map((point) => [point.tileId, point]),
);

export function tournamentTilePosition(
	tileId: string | null,
): TournamentBoardPoint | null {
	return tileId === null ? null : (POSITION_BY_TILE.get(tileId) ?? null);
}

export function tournamentPlayerPosition(
	tileId: string | null,
	seat: number,
): TournamentBoardPosition | null {
	if (tileId === "tile-0") {
		return (
			TOURNAMENT_START_POSITIONS[seat] ?? tournamentTilePosition(tileId)
		);
	}
	return tournamentTilePosition(tileId);
}
