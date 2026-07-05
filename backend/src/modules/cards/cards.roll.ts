import {
	CARD_RARITIES,
	PRISMATIC_CHANCE_FRACTION,
	RARITY_ODDS,
	cardsByRarity,
	type CardRarity,
	type PackTierDefinition,
} from "./cards.constants";

/** Source of randomness in [0, 1). Injectable so rolls are testable. */
export type Rng = () => number;

/** A single rolled card outcome. */
export interface RolledCard {
	cardId: string;
	foil: boolean;
	/**
	 * The rarer-than-foil cosmetic state. Only reachable by a gold-rarity,
	 * already-foil pull (see PRISMATIC_CHANCE_FRACTION) — never true unless
	 * `foil` is also true.
	 */
	prismatic: boolean;
}

/**
 * Roll one rarity tier against an odds table (defaults to the basic tier's
 * RARITY_ODDS). Odds must sum to 1 (asserted in cards.constants.spec.ts for
 * every tier); the final return guards against floating-point drift so a
 * roll never falls through unassigned.
 */
export function rollRarity(
	rng: Rng,
	odds: Readonly<Record<CardRarity, number>> = RARITY_ODDS,
): CardRarity {
	const r = rng();
	let cumulative = 0;
	for (const rarity of CARD_RARITIES) {
		cumulative += odds[rarity];
		if (r < cumulative) return rarity;
	}
	return CARD_RARITIES[CARD_RARITIES.length - 1];
}

/**
 * Roll a single card against a pack tier's own odds: a rarity tier from
 * `tier.rarityOdds`, then a uniform card within that tier, then a foil check
 * against `tier.foilChance`. Consumes three draws from `rng` in that order —
 * plus a conditional 4th "is this prismatic?" draw, but ONLY when the roll
 * already landed gold + foil (see PRISMATIC_CHANCE_FRACTION). This must stay
 * conditional, not unconditional: an unconditional 4th draw would shift the
 * draw-cycling offset for every existing fixed-sequence test in
 * cards.roll.spec.ts / cards.service.spec.ts that assumes 3 draws per card.
 */
export function rollCard(rng: Rng, tier: PackTierDefinition): RolledCard {
	const rarity = rollRarity(rng, tier.rarityOdds);
	const pool = cardsByRarity(rarity);
	const index = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
	const foil = rng() < tier.foilChance;
	const prismatic =
		rarity === "gold" && foil && rng() < PRISMATIC_CHANCE_FRACTION;
	return { cardId: pool[index].id, foil, prismatic };
}

/**
 * Roll a single card restricted to rarities at or above `minRarity` on the
 * ladder, still weighted by the tier's own odds among the eligible rarities
 * and still foil-checked against `tier.foilChance`. This is what makes a
 * tier's guaranteed slot an actual guarantee rather than "usually" — the
 * ineligible (below-minRarity) rarities are never in the draw at all.
 * Consumes three draws from `rng`, matching {@link rollCard}'s pattern — plus
 * the same conditional 4th "is this prismatic?" draw when the roll lands
 * gold + foil (see {@link rollCard}'s doc comment on why it must stay
 * conditional).
 */
export function rollGuaranteedCard(
	rng: Rng,
	tier: PackTierDefinition,
	minRarity: CardRarity,
): RolledCard {
	const minIndex = CARD_RARITIES.indexOf(minRarity);
	const eligibleRarities = CARD_RARITIES.slice(minIndex);
	const eligibleWeight = eligibleRarities.reduce(
		(sum, rarity) => sum + tier.rarityOdds[rarity],
		0,
	);

	const r = rng() * eligibleWeight;
	let cumulative = 0;
	let rarity: CardRarity = eligibleRarities[eligibleRarities.length - 1];
	for (const candidate of eligibleRarities) {
		cumulative += tier.rarityOdds[candidate];
		if (r < cumulative) {
			rarity = candidate;
			break;
		}
	}

	const pool = cardsByRarity(rarity);
	const index = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
	const foil = rng() < tier.foilChance;
	const prismatic =
		rarity === "gold" && foil && rng() < PRISMATIC_CHANCE_FRACTION;
	return { cardId: pool[index].id, foil, prismatic };
}
