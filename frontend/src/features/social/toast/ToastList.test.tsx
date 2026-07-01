import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastList } from "./ToastList";

describe("ToastList", () => {
	it("should render each toast message", () => {
		render(
			<ToastList
				toasts={[{ id: "1", message: "Hello", variant: "info" }]}
				onDismiss={() => undefined}
			/>,
		);
		expect(screen.getByText("Hello")).toBeInTheDocument();
	});

	it("should render nothing when there are no toasts", () => {
		const { container } = render(
			<ToastList toasts={[]} onDismiss={() => undefined} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("should call onAction then dismiss when the action button is clicked", () => {
		const onAction = vi.fn();
		const onDismiss = vi.fn();
		render(
			<ToastList
				toasts={[
					{
						id: "7",
						message: "Removed",
						variant: "info",
						action: { label: "Undo", onAction },
					},
				]}
				onDismiss={onDismiss}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(onAction).toHaveBeenCalledTimes(1);
		expect(onDismiss).toHaveBeenCalledWith("7");
	});

	it("should call onDismiss with the toast id when the close button is clicked", () => {
		const onDismiss = vi.fn();
		render(
			<ToastList
				toasts={[{ id: "9", message: "Done", variant: "success" }]}
				onDismiss={onDismiss}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
		expect(onDismiss).toHaveBeenCalledWith("9");
	});
});
