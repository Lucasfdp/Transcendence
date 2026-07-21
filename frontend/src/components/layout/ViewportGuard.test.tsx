import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewportGuard } from "./ViewportGuard";

function setViewport(width: number, height: number): void {
	Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
	Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

describe("ViewportGuard", () => {
	beforeEach(() => {
		setViewport(1_280, 720);
		window.localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		window.localStorage.clear();
	});

	it("warns while the viewport is portrait, and lets the visitor continue anyway", () => {
		setViewport(640, 900);
		render(
			<ViewportGuard>
				<div>Game content</div>
			</ViewportGuard>,
		);

		expect(screen.getByText("Rotate to landscape")).toBeInTheDocument();
		expect(screen.queryByText("Game content")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Continue at your own risk" }));
		expect(screen.getByText("Game content")).toBeInTheDocument();
	});

	it("remembers the orientation warning was dismissed across page loads", () => {
		setViewport(640, 900);
		window.localStorage.setItem("viewport-guard:orientation-warning-dismissed", "1");
		render(
			<ViewportGuard>
				<div>Game content</div>
			</ViewportGuard>,
		);

		expect(screen.queryByText("Rotate to landscape")).not.toBeInTheDocument();
		expect(screen.getByText("Game content")).toBeInTheDocument();
	});

	it("renders desktop content in landscape", () => {
		render(
			<ViewportGuard>
				<div>Game content</div>
			</ViewportGuard>,
		);

		expect(screen.getByText("Game content")).toBeInTheDocument();
	});

	it("requires mobile visitors to acknowledge the desktop-first experience", () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone)");
		render(
			<ViewportGuard>
				<div>Game content</div>
			</ViewportGuard>,
		);

		expect(screen.getByText("Built for a bigger arena")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "I understand, continue" }));
		expect(screen.getByText("Game content")).toBeInTheDocument();
	});
});
