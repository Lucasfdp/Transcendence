/**
 * board-registry.ts — the immutable board definition registry (SPEC-002) plus a
 * v1 PLACEHOLDER catalog.
 *
 * Board definitions are pure, immutable content, so they live in the generic
 * deep-freezing `Registry<T>` (SPEC-025) exactly like items/dice — never a
 * bespoke store. The whole board is data (SPEC-002 "Board Configuration": never
 * built by code), so `createBoardRegistry()` builds a registry, optionally
 * pre-seeded with the v1 placeholder board below.
 *
 * The v1 board is NOT content (that is a later phase). It is a minimal RING of
 * eight tiles composed purely of Actions from config (SPEC-002 "Composición de
 * casillas v1" / SPEC-006 data-driven), with NO artistic names anywhere — ids
 * like `tile-0`…`tile-7` and `metadata.theme = "placeholder"` only (SPEC-002
 * "Restricciones"). A ring (last tile connects back to the first) keeps movement
 * total, so every roll lands somewhere well-defined.
 */

import { Registry } from "../registry/registry";
import { BoardDefinition, Tile } from "./board.types";

/**
 * Validator for the board registry (SPEC-025 "validate" / SPEC-002 "Casos
 * límite": an invalid board never initializes): non-empty id/name, a
 * `startingTile` that exists, unique tile ids, and — v1 single-successor —
 * exactly one connection per tile pointing at an existing tile.
 */
export const validateBoardDefinition = (definition: BoardDefinition): string[] => {
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
			errors.push(`tile "${tile.id}" must have exactly one connection in v1`);
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
 * the v1 placeholder board below.
 */
export const createBoardRegistry = (
	options: { seed?: boolean } = {},
): Registry<BoardDefinition> => {
	const registry = new Registry<BoardDefinition>(
		"BoardRegistry",
		validateBoardDefinition,
	);
	if (options.seed) {
		registry.register(V1_PLACEHOLDER_BOARD);
	}
	return registry;
};

// ── v1 placeholder board (SPEC-002 "Composición de casillas v1") ────────────

/** Id of the v1 placeholder board, exported for tests/integration. */
export const V1_BOARD_ID = "placeholder-ring-8";

const RING_SIZE = 8;

/**
 * A tile of the placeholder ring. Tile `i` connects to tile `i+1` (mod 8).
 * Behaviour is expressed only through `actions` (SPEC-006 data-driven): most
 * tiles do `nothing` (a placeholder Action — an unregistered action type
 * resolves/skips cleanly today, SPEC-008); a couple award points via the
 * existing `awardPoints` Action. No artistic names — theme is "placeholder".
 */
const ringTile = (index: number): Tile => {
	const next = `tile-${(index + 1) % RING_SIZE}`;
	// tile-2 and tile-5 are bonus tiles; the rest are empty placeholders.
	const isBonus = index === 2 || index === 5;
	return {
		id: `tile-${index}`,
		connections: [next],
		actions: isBonus
			? [
					{
						type: "awardPoints",
						parameters: { amount: 25, reason: "tile:bonus", source: "tile" },
					},
			  ]
			: [{ type: "nothing", parameters: {} }],
		metadata: { theme: "placeholder", index },
	};
};

/** The v1 placeholder ring board (fixtures / bootstrap only). */
export const V1_PLACEHOLDER_BOARD: BoardDefinition = {
	id: V1_BOARD_ID,
	name: "Placeholder Ring",
	startingTile: "tile-0",
	tiles: Array.from({ length: RING_SIZE }, (_, i) => ringTile(i)),
	metadata: { theme: "placeholder" },
};
