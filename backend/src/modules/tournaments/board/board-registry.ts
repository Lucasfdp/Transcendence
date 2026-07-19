/**
 * board-registry.ts — the immutable board definition registry (SPEC-002) and
 * The Parrot's Shell board catalogue.
 *
 * Board definitions are pure, immutable content, so they live in the generic
 * deep-freezing `Registry<T>` (SPEC-025) exactly like items/dice — never a
 * bespoke store. The whole board is data (SPEC-002 "Board Configuration": never
 * built by code), so `createBoardRegistry()` builds a registry, optionally
 * pre-seeded with the production v1 board below.
 *
 * The v1 board is a 28-step ring following the paths in The Parrot's Shell map.
 * It remains pure Action-based configuration (SPEC-002 / SPEC-006): the backend
 * owns successor order and tile effects, while visual coordinates stay in the
 * frontend presentation layer. A ring keeps movement total, so every roll lands
 * somewhere well-defined.
 */

import { Registry } from "../registry/registry";
import { BoardDefinition, Tile } from "./board.types";

/**
 * Validator for the board registry (SPEC-025 "validate" / SPEC-002 "Casos
 * límite": an invalid board never initializes): non-empty id/name, a
 * `startingTile` that exists, unique tile ids, and — v1 single-successor —
 * exactly one connection per tile pointing at an existing tile.
 */
export const validateBoardDefinition = (
	definition: BoardDefinition,
): string[] => {
	const errors: string[] = [];
	if (!definition.id || definition.id.trim() === "") {
		errors.push("id must be a non-empty string");
	}
	if (!definition.name || definition.name.trim() === "") {
		errors.push("name must be a non-empty string");
	}
	if (!Array.isArray(definition.tiles) || definition.tiles.length === 0) {
		errors.push("tiles must be a non-empty array");
		return errors;
	}

	const ids = new Set<string>();
	for (const tile of definition.tiles) {
		if (!tile.id || tile.id.trim() === "") {
			errors.push("every tile must have a non-empty id");
			continue;
		}
		if (ids.has(tile.id)) {
			errors.push(`duplicate tile id "${tile.id}"`);
		}
		ids.add(tile.id);
	}
	for (const tile of definition.tiles) {
		// v1: exactly one outgoing connection (single-successor board, SPEC-002).
		if (!Array.isArray(tile.connections) || tile.connections.length !== 1) {
			errors.push(
				`tile "${tile.id}" must have exactly one connection in v1`,
			);
			continue;
		}
		if (!ids.has(tile.connections[0])) {
			errors.push(
				`tile "${tile.id}" connects to unknown tile "${tile.connections[0]}"`,
			);
		}
	}
	if (!ids.has(definition.startingTile)) {
		errors.push(`startingTile "${definition.startingTile}" is not a tile`);
	}
	return errors;
};

/**
 * Builds a fresh board registry (SPEC-025). Pass `seed: true` to pre-register
 * The Parrot's Shell v1 board below.
 */
export const createBoardRegistry = (
	options: { seed?: boolean } = {},
): Registry<BoardDefinition> => {
	const registry = new Registry<BoardDefinition>(
		"BoardRegistry",
		validateBoardDefinition,
	);
	if (options.seed) {
		registry.register(PARROTS_SHELL_BOARD);
	}
	return registry;
};

// ── The Parrot's Shell v1 board (SPEC-002) ──────────────────────────────────

/** Id of the production v1 board, exported for tests and integration. */
export const PARROTS_SHELL_BOARD_ID = "parrots-shell-path-28";

const PATH_SIZE = 28;
const BONUS_TILE_INDICES = new Set([5, 12, 19, 25]);

/**
 * A tile of the map path. Tile `i` connects to tile `i+1` (mod 28).
 * Behaviour is expressed only through `actions` (SPEC-006 data-driven): most
 * tiles do `nothing` (a placeholder Action — an unregistered action type
 * resolves/skips cleanly today, SPEC-008); four evenly distributed stops award
 * points through the existing `awardPoints` Action.
 */
const pathTile = (index: number): Tile => {
	const next = `tile-${(index + 1) % PATH_SIZE}`;
	const isBonus = BONUS_TILE_INDICES.has(index);
	return {
		id: `tile-${index}`,
		connections: [next],
		actions: isBonus
			? [
					{
						type: "awardPoints",
						parameters: {
							amount: 25,
							reason: "tile:bonus",
							source: "tile",
						},
					},
				]
			: [{ type: "nothing", parameters: {} }],
		// `kind` is a PRESENTATION hint for the wire snapshot (SPEC-022) — the
		// Board never interprets metadata (SPEC-002 "Restricciones").
		metadata: {
			theme: "parrots-shell",
			index,
			kind: index === 0 ? "start" : isBonus ? "bonus" : "path",
		},
	};
};

/** The production v1 board. Visual coordinates are keyed by these tile ids. */
export const PARROTS_SHELL_BOARD: BoardDefinition = {
	id: PARROTS_SHELL_BOARD_ID,
	name: "The Parrot's Shell",
	startingTile: "tile-0",
	tiles: Array.from({ length: PATH_SIZE }, (_, i) => pathTile(i)),
	metadata: { theme: "parrots-shell" },
};
