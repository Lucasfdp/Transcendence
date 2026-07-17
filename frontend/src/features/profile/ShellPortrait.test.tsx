import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShellPortrait } from "./ShellPortrait";

describe("ShellPortrait", () => {
	it("uses the equipped shell as the default portrait", () => {
		render(
			<ShellPortrait displayName="Kame" shellSkin="dragon" level={12} />,
		);

		const portrait = screen.getByRole("img", {
			name: "Kame's shell portrait",
		});
		expect(portrait).toHaveClass("shell-portrait--shell");
		expect(portrait.querySelector("img")).toHaveAttribute(
			"src",
			"/assets/character/shells/dragonShell.png",
		);
		expect(screen.getByText("12")).toBeInTheDocument();
	});

	it("shows a custom avatar when one is available", () => {
		render(
			<ShellPortrait
				displayName="Kame"
				avatar="/uploads/avatars/kame.png"
				shellSkin="rune"
			/>,
		);

		const portrait = screen.getByRole("img", { name: "Kame's avatar" });
		expect(portrait).toHaveClass("shell-portrait--custom");
		expect(portrait.querySelector("img")).toHaveAttribute(
			"src",
			"/uploads/avatars/kame.png",
		);
	});

	it("falls back to the equipped shell when the custom image fails", () => {
		render(
			<ShellPortrait
				displayName="Kame"
				avatar="/uploads/avatars/missing.png"
				shellSkin="rune"
			/>,
		);

		fireEvent.error(
			screen
				.getByRole("img", { name: "Kame's avatar" })
				.querySelector("img")!,
		);

		const fallback = screen.getByRole("img", {
			name: "Kame's shell portrait",
		});
		expect(fallback.querySelector("img")).toHaveAttribute(
			"src",
			"/assets/character/shells/runeShell.png",
		);
	});

	it("assigns the same visual tone to the same player", () => {
		const { rerender } = render(<ShellPortrait displayName="Kame" />);
		const firstTone = screen
			.getByRole("img", { name: "Kame's shell portrait" })
			.getAttribute("data-tone");

		rerender(<ShellPortrait displayName="Kame" shellSkin="rune" />);
		expect(
			screen
				.getByRole("img", { name: "Kame's shell portrait" })
				.getAttribute("data-tone"),
		).toBe(firstTone);
	});
});
