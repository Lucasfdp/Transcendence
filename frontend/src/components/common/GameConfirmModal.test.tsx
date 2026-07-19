import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameConfirmModal } from "./GameConfirmModal";

describe("GameConfirmModal", () => {
	it("confirms or cancels without using a native browser dialog", () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		render(
			<GameConfirmModal
				isOpen
				title="Leave tournament?"
				description="This counts as a loss."
				confirmLabel="Leave tournament"
				onConfirm={onConfirm}
				onCancel={onCancel}
			/>,
		);

		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
		fireEvent.click(
			screen.getByRole("button", { name: "Leave tournament" }),
		);
		expect(onConfirm).toHaveBeenCalledTimes(1);

		fireEvent.keyDown(window, { key: "Escape" });
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});
