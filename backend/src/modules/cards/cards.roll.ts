import {
	CARD_RARITIES,
	FOIL_CHANCE,
	RARITY_ODDS,
	cardsByRarity,
	type CardRarity,
} from "./cards.constants";

/** Source of randomness in [0, 1). Injectable so rolls are testable. */
export type Rng = () => number;

/** A single rolled card outcome. */
export interface RolledCard {
	cardId: string;
	foil: boolean;
}

/**
 * Roll one rarity tier against RARITY_ODDS. The odds sum to 1 (asserted in
 * cards.constants.spec.ts); the final return guards against floating-point
 * drift so a roll never falls through unassigned.
 */
export function rollRarity(rng: Rng): CardRarity {
	const r = rng();
	let cumulative = 0;
	for (const rarity of CARD_RARITIES) {
		cumulative += RARITY_ODDS[rarity];
		if (r < cumulative) return rarity;
	}
	return CARD_RARITIES[CARD_RARITIES.length - 1];
}

/**
 * Roll a single card: a rarity tier, then a uniform card within that tier,
 * then a foil check. Consumes three draws from `rng` in that order.
 */
export function rollCard(rng: Rng): RolledCard {
	const rarity = rollRarity(rng);
	const pool = cardsByRarity(rarity);
	const index = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
	const foil = rng() < FOIL_CHANCE;
	return { cardId: pool[index].id, foil };
}
