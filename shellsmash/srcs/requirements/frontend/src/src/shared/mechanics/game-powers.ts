/**
 * shared/mechanics/game-powers.ts
 *
 * Defines which PowerType values are mechanically meaningful in each minigame.
 * The pre-game ShellPickerScene uses this map to filter the shell grid to only
 * powers that do something useful in the selected game.
 *
 * NONE is always implicitly available at no cost and must NOT appear in these lists.
 */

import { PowerType } from './power-system';

export type GameId = 'shell-curl' | 'bamboo-bash' | 'bell-clash' | 'kame-knock';

/**
 * Per-game list of selectable shell powers (excludes NONE, which is always free).
 *
 * shell-curl    — full physics set: all 21 powers have curling-physics hooks.
 * bamboo-bash   — curated subset where the power modifies the throw/impact.
 * bell-clash    — curated subset where the power modifies the swing scoring.
 * kame-knock    — curated subset where the power modifies the knock physics.
 */
export const GAME_POWERS: Record<GameId, PowerType[]> = {
  'shell-curl': [
    PowerType.HEAVY,     PowerType.BOMB,     PowerType.SPLITTER,
    PowerType.GHOST,     PowerType.MAGNET,   PowerType.SPINNING,
    PowerType.BOUNCER,   PowerType.SHIELD,   PowerType.FREEZE,    PowerType.SLICK,
    PowerType.ROCKET,    PowerType.GIANT,    PowerType.TINY,
    PowerType.BOOMERANG, PowerType.REPEL,    PowerType.STICKY,
    PowerType.LIGHTNING, PowerType.VORTEX,   PowerType.CLONE,
    PowerType.RICOCHET,  PowerType.PHANTOM,
  ],
  'bamboo-bash': [
    PowerType.HEAVY,    PowerType.BOMB,    PowerType.GHOST,
    PowerType.SPINNING, PowerType.SLICK,
    PowerType.ROCKET,   PowerType.GIANT,   PowerType.TINY,
    PowerType.RICOCHET, PowerType.PHANTOM,
  ],
  'bell-clash': [
    PowerType.HEAVY,    PowerType.GHOST,   PowerType.SPINNING,
    PowerType.SLICK,    PowerType.ROCKET,  PowerType.GIANT,
    PowerType.TINY,     PowerType.PHANTOM,
  ],
  'kame-knock': [
    PowerType.HEAVY,   PowerType.BOMB,    PowerType.GHOST,
    PowerType.MAGNET,  PowerType.SHIELD,  PowerType.FREEZE,
    PowerType.REPEL,   PowerType.STICKY,  PowerType.GIANT,  PowerType.TINY,
  ],
};
