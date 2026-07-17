// ── XP & coin rewards per game outcome ────────────────────────────────────────
export const XP_PER_WIN = 150;
export const XP_PER_LOSS = 50;
export const XP_PER_DRAW = 80;
export const XP_PER_COMPLETED = 30;
export const COINS_PER_WIN = 50;
export const COINS_PER_LOSS = 30;
export const COINS_PER_DRAW = 30;
export const COINS_PER_COMPLETED = 20;

/**
 * XP required to advance from `currentLevel` to `currentLevel + 1`.
 *
 * Formula: `currentLevel * 1_000`
 *   Level 1 → needs 1 000 XP to reach level 2.
 *   Level 2 → needs 2 000 XP to reach level 3.
 *   …and so on.
 *
 * IMPORTANT: the frontend ExperienceProgress XP-bar max uses the same formula.
 * Keep both in sync if this progression curve changes.
 */
export function xpForNextLevel(currentLevel: number): number {
	return currentLevel * 1_000;
}
