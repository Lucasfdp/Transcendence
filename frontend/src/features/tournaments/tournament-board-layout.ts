export interface TournamentBoardPoint {
	readonly tileId: string;
	/** Percentage of the 16:9 map width. */
	readonly x: number;
	/** Percentage of the 16:9 map height. */
	readonly y: number;
}

/**
 * Presentation-only anchors following the visible dirt path clockwise. The
 * backend owns successor order; these coordinates only decide where each
 * authoritative tile is drawn over tournamentMap.png.
 */
export const TOURNAMENT_BOARD_PATH: readonly TournamentBoardPoint[] = [
	{ tileId: "tile-0", x: 50, y: 91 },
	{ tileId: "tile-1", x: 43, y: 88 },
	{ tileId: "tile-2", x: 36, y: 85 },
	{ tileId: "tile-3", x: 29, y: 84 },
	{ tileId: "tile-4", x: 22, y: 84 },
	{ tileId: "tile-5", x: 15, y: 81 },
	{ tileId: "tile-6", x: 9, y: 76 },
	{ tileId: "tile-7", x: 7, y: 69 },
	{ tileId: "tile-8", x: 11, y: 64 },
	{ tileId: "tile-9", x: 18, y: 61 },
	{ tileId: "tile-10", x: 25, y: 58 },
	{ tileId: "tile-11", x: 32, y: 55 },
	{ tileId: "tile-12", x: 39, y: 51 },
	{ tileId: "tile-13", x: 46, y: 47 },
	{ tileId: "tile-14", x: 53, y: 44 },
	{ tileId: "tile-15", x: 60, y: 41 },
	{ tileId: "tile-16", x: 67, y: 38 },
	{ tileId: "tile-17", x: 74, y: 38 },
	{ tileId: "tile-18", x: 81, y: 41 },
	{ tileId: "tile-19", x: 87, y: 46 },
	{ tileId: "tile-20", x: 90, y: 52 },
	{ tileId: "tile-21", x: 88, y: 58 },
	{ tileId: "tile-22", x: 83, y: 63 },
	{ tileId: "tile-23", x: 78, y: 68 },
	{ tileId: "tile-24", x: 73, y: 73 },
	{ tileId: "tile-25", x: 67, y: 78 },
	{ tileId: "tile-26", x: 60, y: 83 },
	{ tileId: "tile-27", x: 55, y: 88 },
] as const;

const POSITION_BY_TILE = new Map(
	TOURNAMENT_BOARD_PATH.map((point) => [point.tileId, point]),
);

export function tournamentTilePosition(
	tileId: string | null,
): TournamentBoardPoint | null {
	return tileId === null ? null : (POSITION_BY_TILE.get(tileId) ?? null);
}
