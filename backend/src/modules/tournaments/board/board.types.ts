/**
 * board.types.ts — Board System contracts (SPEC-002) + Tile data model (shared
 * with SPEC-006).
 *
 * A Tile is PURE DATA (SPEC-002 "Tile" / SPEC-006 "Definición de una Tile"): an
 * id, its outgoing connection(s), a list of Actions and presentation metadata —
 * nothing else. A Tile has NO behaviour and NO type: all behaviour lives in its
 * `actions`, which are ordinary `ActionConfig`s run through the ONE Action
 * Engine (SPEC-006). The Board only STORES tiles + player positions, computes
 * movement, and DELEGATES tile resolution — it never runs an Action itself.
 *
 * This file imports ONLY the public Action Engine TYPES (`ActionConfig`/
 * `ActionContext`/`ExecutionResult`) — never the concrete engine (SPEC-002
 * "Restricciones"): resolution is delegated through the `TileActionRunner` port
 * below, identical in shape to the Reward/Inventory runners so ONE concrete
 * adapter satisfies them all at integration.
 */

import {
	ActionConfig,
	ActionContext,
	ExecutionResult,
} from "../actions/action.interface";

// ── Tile + Board definition (SPEC-002 "Estructura") ─────────────────────────

/**
 * A tile — pure data (SPEC-002 "Tile"). `connections` holds the outgoing edges;
 * v1 is a SINGLE-SUCCESSOR board, so exactly ONE connection per tile (branching
 * with player choice is a future extension, D13). Behaviour is entirely in
 * `actions` (SPEC-006). `metadata` may carry presentation keys (theme, icon) the
 * Board NEVER interprets (SPEC-002 "Restricciones").
 */
export interface Tile {
	readonly id: string;
	/** Outgoing edges; v1 = exactly one (single-successor board). */
	readonly connections: readonly string[];
	/** Actions run through the Action Engine on entry (SPEC-006). */
	readonly actions: readonly ActionConfig[];
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A board — an ordered, fully data-driven collection of tiles (SPEC-002
 * "Board"). No hardcoded logic for a concrete board; the whole board is
 * replaceable through configuration.
 */
export interface BoardDefinition {
	readonly id: string;
	readonly name: string;
	readonly tiles: readonly Tile[];
	/** The tile every player spawns on (SPEC-002 "Spawn Position"). */
	readonly startingTile: string;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

// ── Tile-action-runner port (dependency inversion, SPEC-002 "Tile Resolution") ─

/**
 * The seam through which the Board delegates tile-Action execution to the Action
 * Engine WITHOUT importing it (SPEC-002 "Tile Resolution": Board delegates,
 * never executes). Structurally identical to the Reward/Inventory runners on
 * purpose — ONE concrete adapter (ActionFactory + ActionEngine) satisfies all of
 * them at integration. `run` returns one `ExecutionResult` per Action, in order,
 * and never throws.
 */
export interface TileActionRunner {
	run(
		actions: readonly ActionConfig[],
		context: ActionContext,
	): ExecutionResult[];
}

/** Builds the `ActionContext` a tile's Actions run against (SPEC-008 "Context").
 * The real one (with wired Services) is injected at integration; a minimal one
 * is used standalone. */
export type BoardContextFactory = (input: {
	playerId: number;
	tileId: string;
}) => ActionContext;

// ── Command results (SPEC-002 "API pública") ────────────────────────────────

/** Terminal status of one tile Action (mirrors SPEC-008 `ExecutionStatus`). */
export type TileActionStatusValue = "success" | "skipped" | "failed";

/** Why a movement command was rejected (SPEC-002 "Casos límite"). */
export type MovementRejectionReason =
	| "unknown_player"
	| "unknown_tile"
	| "no_successor"
	| "relocation_limit";

/**
 * Result of `movePlayer` / `teleportPlayer` (SPEC-002 "API pública"): a
 * synchronous command result, never an event. On success the per-Action statuses
 * of the resolved tile are returned; `forced` is true for a teleport / forced
 * relocation (SPEC-002 "Teleports").
 */
export type MovementResult =
	| {
			readonly status: "moved";
			readonly playerId: number;
			readonly fromTileId: string;
			readonly toTileId: string;
			readonly steps: number;
			readonly forced: boolean;
			readonly actionStatuses: readonly TileActionStatusValue[];
	  }
	| { readonly status: "rejected"; readonly reason: MovementRejectionReason };

// ── Snapshot (SPEC-002 "Persistencia") ──────────────────────────────────────

/** One player's position (SPEC-002): position is just the tile they occupy. */
export interface PlayerPositionSnapshot {
	readonly playerId: number;
	readonly tileId: string;
}

/**
 * JSON-safe snapshot of the Board embedded in the Runtime snapshot (SPEC-002
 * "Persistencia": the Runtime serializes Board state; the Board doesn't persist).
 */
export interface BoardSnapshot {
	readonly tournamentId: string;
	readonly boardId: string;
	readonly positions: readonly PlayerPositionSnapshot[];
}
