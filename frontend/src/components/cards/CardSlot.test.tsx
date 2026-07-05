import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardSlot } from "./ShellCardsModal";
import type { CardView } from "../../features/hub/api";

function makeCard(overrides: Partial<CardView> = {}): CardView {
	return {
		id: "power_shell-1",
		family: "power_shell",
		rarity: "gold",
		name: "Blazing Shell",
		flavor: "It hums with heat.",
		sourceRef: "power_shell:1",
		owned: true,
		count: 1,
		foilCount: 0,
		prismaticCount: 0,
		...overrides,
	};
}

describe("CardSlot", () => {
	it("should expose an accessible button and call onSelect when an owned card is clicked", () => {
		const onSelect = vi.fn();
		const card = makeCard();
		render(<CardSlot card={card} onSelect={onSelect} />);

		const button = screen.getByRole("button", { name: /Blazing Shell/ });
		fireEvent.click(button);

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith(card);
	});

	it("should call onSelect when Enter is pressed on a focused owned card", () => {
		const onSelect = vi.fn();
		render(<CardSlot card={makeCard()} onSelect={onSelect} />);

		fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

		expect(onSelect).toHaveBeenCalledTimes(1);
	});

	it("should call onSelect when Space is pressed on a focused owned card", () => {
		const onSelect = vi.fn();
		render(<CardSlot card={makeCard()} onSelect={onSelect} />);

		fireEvent.keyDown(screen.getByRole("button"), { key: " " });

		expect(onSelect).toHaveBeenCalledTimes(1);
	});

	it("should not call onSelect for unrelated key presses", () => {
		const onSelect = vi.fn();
		render(<CardSlot card={makeCard()} onSelect={onSelect} />);

		fireEvent.keyDown(screen.getByRole("button"), { key: "Tab" });

		expect(onSelect).not.toHaveBeenCalled();
	});

	it("should render a locked, non-interactive card for undiscovered cards", () => {
		const onSelect = vi.fn();
		render(
			<CardSlot
				card={makeCard({ owned: false, name: "Hidden Shell" })}
				onSelect={onSelect}
			/>,
		);

		expect(screen.queryByRole("button")).not.toBeInTheDocument();
		expect(screen.getByText("???")).toBeInTheDocument();
	});

	it("should not throw when the pointer moves over a card in a zero-size test layout", () => {
		const onSelect = vi.fn();
		render(<CardSlot card={makeCard()} onSelect={onSelect} />);
		const button = screen.getByRole("button");

		expect(() =>
			fireEvent.mouseMove(button, { clientX: 10, clientY: 10 }),
		).not.toThrow();
		expect(() => fireEvent.mouseLeave(button)).not.toThrow();
	});

	it.each([
		["stone", "▪"],
		["bronze", "◆"],
		["jade", "⬡"],
		["gold", "★"],
	] as const)(
		"should render a %s rarity badge glyph distinct from colour alone",
		(rarity, glyph) => {
			const { container } = render(
				<CardSlot card={makeCard({ rarity })} onSelect={vi.fn()} />,
			);
			expect(
				container.querySelector(".hub-cards__rarity-badge"),
			).toHaveTextContent(glyph);
		},
	);

	it("should hide the rarity badge glyph from screen readers since rarity is already in the accessible name", () => {
		const { container } = render(
			<CardSlot card={makeCard()} onSelect={vi.fn()} />,
		);
		expect(
			container.querySelector(".hub-cards__rarity-badge"),
		).toHaveAttribute("aria-hidden", "true");
	});

	it("should show a plain foil badge with no count when exactly one foil is owned", () => {
		render(
			<CardSlot card={makeCard({ foilCount: 1 })} onSelect={vi.fn()} />,
		);
		expect(screen.getByText("✦ foil")).toBeInTheDocument();
	});

	it("should show the foil count when more than one foil copy is owned", () => {
		render(
			<CardSlot card={makeCard({ foilCount: 3 })} onSelect={vi.fn()} />,
		);
		expect(screen.getByText("✦ foil ×3")).toBeInTheDocument();
	});

	it("should render no foil badge at all when the card has no foil copies", () => {
		render(
			<CardSlot card={makeCard({ foilCount: 0 })} onSelect={vi.fn()} />,
		);
		expect(screen.queryByText(/foil/)).not.toBeInTheDocument();
	});

	it("should show a prismatic badge instead of a plain foil badge when prismaticCount > 0", () => {
		render(
			<CardSlot
				card={makeCard({ foilCount: 1, prismaticCount: 1 })}
				onSelect={vi.fn()}
			/>,
		);
		expect(screen.getByText(/Prismatic/)).toBeInTheDocument();
		expect(screen.queryByText("✦ foil")).not.toBeInTheDocument();
	});

	it("should show the plain foil badge when foilCount > 0 but prismaticCount is 0", () => {
		render(
			<CardSlot
				card={makeCard({ foilCount: 1, prismaticCount: 0 })}
				onSelect={vi.fn()}
			/>,
		);
		expect(screen.getByText("✦ foil")).toBeInTheDocument();
		expect(screen.queryByText(/Prismatic/)).not.toBeInTheDocument();
	});

	it("should show the prismatic count when more than one prismatic copy is owned", () => {
		render(
			<CardSlot
				card={makeCard({ foilCount: 3, prismaticCount: 3 })}
				onSelect={vi.fn()}
			/>,
		);
		expect(screen.getByText(/Prismatic ×3/)).toBeInTheDocument();
	});
});
