/**
 * features/cards/labels.ts — the single Cards-owned source for rarity/family
 * display labels, glyphs, and ordering.
 *
 * Previously RARITY_GLYPH was defined twice (ShellCardsModal.tsx and
 * shared/card-drop-popup.ts, the latter explicitly commented as "mirrored
 * from ShellCardsModal's RARITY_GLYPH"). Consolidated here so the binder UI
 * and the Phaser card-drop toast can never drift out of sync.
 */

import type { CardFamily, CardRarity } from "./contracts";

/**
 * Distinct shapes per rarity, layered on top of the existing border-colour
 * accent so rarity reads even without colour perception (colorblind-safe).
 * Shared by the binder's CardRarityBadge and the Phaser card-drop toast.
 */
export const RARITY_GLYPH: Record<CardRarity, string> = {
	stone: "▪",
	bronze: "◆",
	jade: "⬡",
	gold: "★",
};

/** Display label for each rarity, used in the pack tier odds summary. */
export const RARITY_LABEL: Record<CardRarity, string> = {
	stone: "Stone",
	bronze: "Bronze",
	jade: "Jade",
	gold: "Gold",
};

/** Human-readable titles for each card set (family). */
export const FAMILY_LABELS: Record<CardFamily, string> = {
	power_shell: "Power Shells",
	shrine: "Shrines",
	shell_skin: "Shell Skins",
	character: "Characters",
};

/** Display order of the sets in the binder. */
export const FAMILY_ORDER: readonly CardFamily[] = [
	"character",
	"power_shell",
	"shrine",
	"shell_skin",
];
