/**
 * minigame-catalog.ts — a generic catalog port over the EXISTING minigames
 * (SPEC-015 "Catálogo": obtained from the existing system, never duplicated).
 *
 * This module holds NO hardcoded minigame ids: the real ids and their player
 * bounds come from the matchmaking `GameEngineRegistry` via the adapter that
 * constructs this catalog at the NestJS layer. `createMinigameCatalog` just
 * filters the supplied entries by "supports exactly this player count" (SPEC-015
 * "Selección"). The coordinator defaults to `EMPTY_MINIGAME_CATALOG` when none
 * is wired, so a standalone tournament simply skips the minigame.
 */

import { MinigameCatalogPort } from "./minigame.types";

/** One catalog entry: a minigame id and the player counts it supports. */
export interface MinigameCatalogEntry {
	readonly gameId: string;
	readonly minPlayers: number;
	readonly maxPlayers: number;
}

/**
 * Builds a catalog port that returns the ids supporting EXACTLY `playerCount`
 * (i.e. `minPlayers <= playerCount <= maxPlayers`). The order of `entries` is
 * preserved so selection is deterministic given the seed.
 */
export const createMinigameCatalog = (
	entries: readonly MinigameCatalogEntry[],
): MinigameCatalogPort => ({
	candidates: (playerCount: number): readonly string[] =>
		entries
			.filter((e) => playerCount >= e.minPlayers && playerCount <= e.maxPlayers)
			.map((e) => e.gameId),
});

/** The inert default: no minigame ever runs (used when no catalog is wired). */
export const EMPTY_MINIGAME_CATALOG: MinigameCatalogPort = {
	candidates: () => [],
};
