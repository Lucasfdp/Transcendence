/**
 * Arena 01 — sumo ring vector data.
 *
 * Measured by pixel-analysing the shared arena texture `arena01.png` (1920×1080):
 *   ellipse bbox  x: 256–1667  y: 49–1032
 *   → cx=961 cy=540  rx=705 ry=491
 *
 * Geometry helpers and rendering live in game/arenas/arena.ts.
 */

import { ArenaDef } from "./arena";

export const ARENA_01: ArenaDef = {
	srcW: 1920,
	srcH: 1080,
	cx: 961,
	cy: 540,
	rx: 705,
	ry: 491,
};
