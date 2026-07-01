import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardLightbox } from "./ShellCardsModal";
import type { CardView } from "../../features/hub/api";

function makeCard(overrides: Partial<CardView> = {}): CardView {
	return {
		id: "shrine-1",
		family: "shrine",
		rarity: "jade",
		name: "Turtle Shrine",
		flavor: "Blessed by the old dojo masters.",
		sourceRef: "shrine:1",
		owned: true,
		count: 2,
		foilCount: 1,
		...overrides,
	};
}

describe("CardLightbox", () => {
	it("should render the card's name, flavor text, and rarity", () => {
		render(<CardLightbox card={makeCard()} onClose={() => undefined} />);

		expect(screen.getByText("Turtle Shrine")).toBeInTheDocument();
		expect(
			screen.getByText("Blessed by the old dojo masters."),
		).toBeInTheDocument();
		expect(screen.getByText(/jade/)).toBeInTheDocument();
	});

	it("should call onClose when the backdrop is clicked", () => {
		const onClose = vi.fn();
		render(<CardLightbox card={makeCard()} onClose={onClose} />);

		fireEvent.click(screen.getByRole("dialog"));

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("should not call onClose when the card itself is clicked", () => {
		const onClose = vi.fn();
		render(<CardLightbox card={makeCard()} onClose={onClose} />);

		fireEvent.click(screen.getByText("Turtle Shrine"));

		expect(onClose).not.toHaveBeenCalled();
	});

	it("should call onClose when the Close button is clicked", () => {
		const onClose = vi.fn();
		render(<CardLightbox card={makeCard()} onClose={onClose} />);

		fireEvent.click(screen.getByRole("button", { name: "Close" }));

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("should call onClose when the Escape key is pressed", () => {
		const onClose = vi.fn();
		render(<CardLightbox card={makeCard()} onClose={onClose} />);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("should not call onClose for unrelated key presses", () => {
		const onClose = vi.fn();
		render(<CardLightbox card={makeCard()} onClose={onClose} />);

		fireEvent.keyDown(document, { key: "Enter" });

		expect(onClose).not.toHaveBeenCalled();
	});

	it("should remove its keydown listener on unmount", () => {
		const onClose = vi.fn();
		const { unmount } = render(
			<CardLightbox card={makeCard()} onClose={onClose} />,
		);

		unmount();
		fireEvent.keyDown(document, { key: "Escape" });

		expect(onClose).not.toHaveBeenCalled();
	});

	it("should move focus to the Close button when the lightbox opens", () => {
		render(<CardLightbox card={makeCard()} onClose={() => undefined} />);

		expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
	});

	it("should restore focus to whatever triggered the lightbox once it unmounts", () => {
		const trigger = document.createElement("button");
		trigger.textContent = "open";
		document.body.appendChild(trigger);
		trigger.focus();
		expect(trigger).toHaveFocus();

		const { unmount } = render(
			<CardLightbox card={makeCard()} onClose={() => undefined} />,
		);
		expect(trigger).not.toHaveFocus();

		unmount();
		expect(trigger).toHaveFocus();

		trigger.remove();
	});

	it("should render the rarity badge glyph on the enlarged card", () => {
		const { container } = render(
			<CardLightbox card={makeCard({ rarity: "gold" })} onClose={() => undefined} />,
		);
		expect(
			container.querySelector(".hub-cards__rarity-badge"),
		).toHaveTextContent("★");
	});

	it("should show the foil count in the meta line when more than one foil is owned", () => {
		render(
			<CardLightbox
				card={makeCard({ foilCount: 4 })}
				onClose={() => undefined}
			/>,
		);
		expect(screen.getByText(/✦ foil ×4/)).toBeInTheDocument();
	});

	it("should render the hybrid holo layer for a gold card with at least one foil", () => {
		const { container } = render(
			<CardLightbox
				card={makeCard({ rarity: "gold", foilCount: 1 })}
				onClose={() => undefined}
			/>,
		);
		expect(
			container.querySelector(".hub-cards__lightbox-holo"),
		).toBeInTheDocument();
	});

	it("should not render the hybrid holo layer for a gold card with no foil copies", () => {
		const { container } = render(
			<CardLightbox
				card={makeCard({ rarity: "gold", foilCount: 0 })}
				onClose={() => undefined}
			/>,
		);
		expect(
			container.querySelector(".hub-cards__lightbox-holo"),
		).not.toBeInTheDocument();
	});

	it("should not render the hybrid holo layer for a non-gold card even if it's foil", () => {
		const { container } = render(
			<CardLightbox
				card={makeCard({ rarity: "jade", foilCount: 2 })}
				onClose={() => undefined}
			/>,
		);
		expect(
			container.querySelector(".hub-cards__lightbox-holo"),
		).not.toBeInTheDocument();
	});
});
