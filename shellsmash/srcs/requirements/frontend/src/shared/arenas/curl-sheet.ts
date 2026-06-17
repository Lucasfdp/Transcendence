/**
 * game/arenas/curl-sheet.ts — arena definition for Shell Curl.
 *
 * The sheet is landscape-oriented (wide) filling almost the full canvas.
 * Stones are delivered from the LEFT and travel RIGHTWARD toward the house.
 * All measurements are in source pixels at 1920×1080 reference resolution.
 */

import { RectArenaDef } from '../mechanics/rect-arena';

export const CURL_SHEET: RectArenaDef = {
  srcW: 1920,
  srcH: 1080,

  // Sheet rectangle — right margin widened to 230 src-px so the power-guide
  // side panel can fit in the right strip at typical screen resolutions.
  // Left margin stays at 120 (original). Total: 120 + 1570 + 230 = 1920. ✓
  sheetX: 120,
  sheetY: 100,
  sheetW: 1570,
  sheetH:  880,

  // House geometry — scoring house is at the RIGHT end
  houseRadius:       220,    // outermost ring in source px
  houseCentreOffset: 380,    // distance from sheet end-line to house centre

  orientation: 'horizontal',
};
