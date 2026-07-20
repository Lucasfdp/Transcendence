import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoneButton } from "./StoneButton";

describe("StoneButton", () => {
	it("renders the base variant and forwards button attributes", () => {
		const onClick = vi.fn();
		const { container } = render(
			<StoneButton className="custom-button" onClick={onClick} type="button">
				Join
			</StoneButton>,
		);
		const button = screen.getByRole("button", { name: "Join" });

		expect(button).toHaveClass(
			"stone-button",
			"stone-button--base",
			"custom-button",
		);
		expect(container.querySelector("img")).toHaveAttribute(
			"src",
			"/assets/ui/baseButton.png",
		);
		fireEvent.click(button);
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("renders the back variant as a disabled native button", () => {
		const { container } = render(
			<StoneButton variant="back" disabled>
				Back to mode selector
			</StoneButton>,
		);

		expect(
			screen.getByRole("button", { name: "Back to mode selector" }),
		).toBeDisabled();
		expect(container.querySelector("img")).toHaveAttribute(
			"src",
			"/assets/ui/backButton.png",
		);
	});
});
