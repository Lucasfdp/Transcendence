/**
 * game/arenas/curl-sheet.ts — arena definition for Shell Curl.
 *
 * The sheet is portrait-oriented (tall) centred in a landscape canvas.
 * All measurements are in source pixels at 1920×1080 reference resolution.
 * Tune sheetX/sheetY/sheetW/sheetH so the sheet sits visually centred.
 */

import { RectArenaDef } from '../mechanics/rect-arena';

export const CURL_SHEET: RectArenaDef = {
  srcW: 1920,
  srcH: 1080,

  // Sheet rectangle — centred horizontally, nearly full height
  sheetX: 560,
  sheetY: 40,
  sheetW: 800,
  sheetH: 1000,

  // House geometry
  houseRadius: 180,          // outermost ring in source px
  houseCentreOffset: 120,    // distance from sheet end-line to house centre
};
