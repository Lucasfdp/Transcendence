/**
 * shared/mechanics/game-powers.ts
 *
 * Defines the full set of shell powers available in the pre-game ShellPickerScene.
 * All 21 special powers are selectable in every minigame — the player chooses freely
 * regardless of whether the power has a bespoke physics hook in that game.
 *
 * NONE is always implicitly available and must NOT appear in this list.
 */

import { PowerType } from './power-system';

export type GameId = 'shell-curl' | 'bamboo-bash' | 'bell-clash' | 'kame-knock';

/** All 21 special shell powers (excludes NONE, which is always free). */
export const ALL_SPECIAL_POWERS: PowerType[] = [
  PowerType.HEAVY,     PowerType.BOMB,     PowerType.SPLITTER,
  PowerType.GHOST,     PowerType.MAGNET,   PowerType.SPINNING,
  PowerType.BOUNCER,   PowerType.SHIELD,   PowerType.FREEZE,    PowerType.SLICK,
  PowerType.ROCKET,    PowerType.GIANT,    PowerType.TINY,
  PowerType.BOOMERANG, PowerType.REPEL,    PowerType.STICKY,
  PowerType.LIGHTNING, PowerType.VORTEX,   PowerType.CLONE,
  PowerType.RICOCHET,  PowerType.PHANTOM,
];

/**
 * Every game exposes the full power roster.
 * Kept as a Record<GameId, ...> so existing call-sites (scene fallback pools,
 * type-checks) continue to compile without changes.
 */
export const GAME_POWERS: Record<GameId, PowerType[]> = {
  'shell-curl':  ALL_SPECIAL_POWERS,
  'bamboo-bash': ALL_SPECIAL_POWERS,
  'bell-clash':  ALL_SPECIAL_POWERS,
  'kame-knock':  ALL_SPECIAL_POWERS,
};
