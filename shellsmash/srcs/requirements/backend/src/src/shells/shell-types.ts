/**
 * shells/shell-types.ts — backend canonical set of valid shell type identifiers.
 *
 * This must be kept in sync with the PowerType enum in the frontend.
 * The 'none' type is intentionally included in VALID_SHELL_TYPES for
 * validation purposes but is excluded from SEEDED_SHELL_TYPES because
 * it is always available for free and never stored in the inventory.
 */

export const VALID_SHELL_TYPES = new Set<string>([
  'none',
  // Original 10 shells
  'heavy', 'bomb', 'splitter', 'ghost', 'magnet',
  'spinning', 'bouncer', 'shield', 'freeze', 'slick',
  // New shells
  'rocket', 'giant', 'tiny', 'boomerang', 'repel',
  'sticky', 'lightning', 'vortex', 'clone', 'ricochet', 'phantom',
]);

/**
 * Shells seeded at quantity 999 for every new user.
 * Does NOT include 'none' — that's free and unstorable.
 */
export const SEEDED_SHELL_TYPES: readonly string[] = [
  'heavy', 'bomb', 'splitter', 'ghost', 'magnet',
  'spinning', 'bouncer', 'shield', 'freeze', 'slick',
  'rocket', 'giant', 'tiny', 'boomerang', 'repel',
  'sticky', 'lightning', 'vortex', 'clone', 'ricochet', 'phantom',
] as const;
