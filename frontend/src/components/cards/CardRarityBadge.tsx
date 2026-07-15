import { RARITY_GLYPH, type CardRarity } from "../../features/cards";

/** Small shape badge reinforcing a card's rarity beyond its border colour. */
export function CardRarityBadge({ rarity }: { rarity: CardRarity }): JSX.Element {
	return (
		<span className="hub-cards__rarity-badge" aria-hidden="true">
			{RARITY_GLYPH[rarity]}
		</span>
	);
}
