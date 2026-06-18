// ── XP & coin rewards per game outcome ────────────────────────────────────────
export const XP_PER_WIN    = 150;
export const XP_PER_LOSS   = 40;
export const COINS_PER_WIN  = 50;
export const COINS_PER_LOSS = 0;

/**
 * XP required to advance from `currentLevel` to `currentLevel + 1`.
 *
 * Formula: `currentLevel * 1_000`
 *   Level 1 → needs 1 000 XP to reach level 2.
 *   Level 2 → needs 2 000 XP to reach level 3.
 *   …and so on.
 *
 * IMPORTANT: the frontend ProfilePanel.ts XP-bar max uses the same formula:
 *   `(user.level ?? 1) * 1000`
 * Keep both in sync — if you change this formula, update ProfilePanel too.
 */
export function xpForNextLevel(currentLevel: number): number {
  return currentLevel * 1_000;
}
