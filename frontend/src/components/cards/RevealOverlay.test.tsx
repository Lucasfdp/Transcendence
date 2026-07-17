import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RevealOverlay } from "./RevealOverlay";
import type { PackPull } from "../../features/cards";

function makePulls(): PackPull[] {
	return [
		{
			card: {
				id: "power-heavy",
				family: "power_shell",
				rarity: "gold",
				name: "Heavy Shell",
				flavor: "",
				sourceRef: "power_shell:heavy",
			},
			foil: false,
			prismatic: false,
			isNew: true,
		},
		{
			card: {
				id: "power-bomb",
				family: "power_shell",
				rarity: "stone",
				name: "Bomb Shell",
				flavor: "",
				sourceRef: "power_shell:bomb",
			},
			foil: false,
			prismatic: false,
			isNew: false,
		},
	];
}

// ── Bug Audit M3: RevealOverlay had no focus management at all ──────────────
// Mirrors CardLightbox.test.tsx's focus specs — the two dialogs now share the
// same useDialogFocusTrap hook.
describe("RevealOverlay", () => {
	it("should move focus to the first face-down card when the overlay opens", () => {
		render(<RevealOverlay pulls={makePulls()} onDismiss={() => undefined} />);

		expect(
			screen.getAllByRole("button", { name: "Tap to reveal card" })[0],
		).toHaveFocus();
	});

	it("should call onDismiss when the Escape key is pressed", () => {
		const onDismiss = vi.fn();
		render(<RevealOverlay pulls={makePulls()} onDismiss={onDismiss} />);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("should not call onDismiss for unrelated key presses", () => {
		const onDismiss = vi.fn();
		render(<RevealOverlay pulls={makePulls()} onDismiss={onDismiss} />);

		fireEvent.keyDown(document, { key: "Enter" });

		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("should remove its keydown listener on unmount", () => {
		const onDismiss = vi.fn();
		const { unmount } = render(
			<RevealOverlay pulls={makePulls()} onDismiss={onDismiss} />,
		);

		unmount();
		fireEvent.keyDown(document, { key: "Escape" });

		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("should restore focus to whatever triggered the overlay once it unmounts", () => {
		const trigger = document.createElement("button");
		trigger.textContent = "open pack";
		document.body.appendChild(trigger);
		trigger.focus();
		expect(trigger).toHaveFocus();

		const { unmount } = render(
			<RevealOverlay pulls={makePulls()} onDismiss={() => undefined} />,
		);
		expect(trigger).not.toHaveFocus();

		unmount();
		expect(trigger).toHaveFocus();

		trigger.remove();
	});

	it("should call onDismiss when Continue is clicked", () => {
		const onDismiss = vi.fn();
		render(<RevealOverlay pulls={makePulls()} onDismiss={onDismiss} />);

		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
