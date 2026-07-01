import type { CardRarity, CardView } from "../../features/hub/api";

/** Ascending rarity progression, used both for sorting and for filter chip order. */
export const RARITY_ORDER: readonly CardRarity[] = [
	"stone",
	"bronze",
	"jade",
	"gold",
];

export type BinderSortOrder = "collection" | "rarity-asc" | "rarity-desc";

export interface BinderFilterOptions {
	rarity: CardRarity | "all";
	missingOnly: boolean;
	sort: BinderSortOrder;
}

/**
 * Filters and sorts a binder's cards for display. Pure and DOM-free so the
 * filter chips, missing-only toggle, and sort control in `ShellCardsModal`
 * can share and unit test the same logic. Never mutates the input array —
 * always sorts a copy, per the project's array-safety convention.
 */
export function filterAndSortCards(
	cards: readonly CardView[],
	options: BinderFilterOptions,
): CardView[] {
	const filtered = cards.filter((card) => {
		if (options.rarity !== "all" && card.rarity !== options.rarity) {
			return false;
		}
		if (options.missingOnly && card.owned) return false;
		return true;
	});

	if (options.sort === "collection") return filtered;

	const direction = options.sort === "rarity-desc" ? -1 : 1;
	return [...filtered].sort(
		(a, b) =>
			(RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)) *
			direction,
	);
}
