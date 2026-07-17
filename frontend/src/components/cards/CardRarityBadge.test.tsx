import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CardRarity } from "../../features/cards";
import { CardRarityBadge } from "./CardRarityBadge";

const EXPECTED_GLYPH: Record<CardRarity, string> = {
	stone: "▪",
	bronze: "◆",
	jade: "⬡",
	gold: "★",
};

describe("CardRarityBadge", () => {
	it.each(Object.entries(EXPECTED_GLYPH) as [CardRarity, string][])(
		"should render the %s glyph for %s rarity",
		(rarity, glyph) => {
			render(<CardRarityBadge rarity={rarity} />);
			expect(screen.getByText(glyph)).toBeInTheDocument();
		},
	);

	it("should hide the badge from assistive tech, since rarity is announced via the card's own aria-label", () => {
		render(<CardRarityBadge rarity="gold" />);
		expect(screen.getByText("★")).toHaveAttribute("aria-hidden", "true");
	});

	it("should apply the rarity-badge class used for the border-colour-independent shape styling", () => {
		render(<CardRarityBadge rarity="jade" />);
		expect(screen.getByText("⬡")).toHaveClass("hub-cards__rarity-badge");
	});
});
