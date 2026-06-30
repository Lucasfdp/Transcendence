/**
 * shared/mechanics/game-powers.ts
 *
 * Defines the active shell powers shown to players.
 * Pending powers stay implemented in power-system.ts but are not exposed here.
 *
 * NONE is always implicitly available and must NOT appear in this list.
 */

import { PowerType } from "./power-system";

export type GameId =
	| "temple-curling"
	| "bamboo-bash"
	| "bell-clash"
	| "kame-knock";

/** Active special shell powers (excludes NONE, which is always implicit). */
export const ALL_SPECIAL_POWERS: PowerType[] = [
	PowerType.HEAVY,
	PowerType.SPLITTER,
	PowerType.SPINNING,
	PowerType.ROCKET,
	PowerType.GIANT,
	PowerType.TINY,
	PowerType.MIRROR,
	PowerType.PHANTOM,
];

/**
 * Every game exposes the active power roster.
 * Kept as a Record<GameId, ...> so existing call-sites (scene fallback pools,
 * type-checks) continue to compile without changes.
 */
export const GAME_POWERS: Record<GameId, PowerType[]> = {
	"temple-curling": ALL_SPECIAL_POWERS,
	"bamboo-bash": ALL_SPECIAL_POWERS,
	"bell-clash": ALL_SPECIAL_POWERS,
	"kame-knock": ALL_SPECIAL_POWERS,
};
