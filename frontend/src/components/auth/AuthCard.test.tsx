import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthCard, type AuthMode } from "./AuthCard";
import { registrationPrefill } from "./registrationPrefill";

function renderCard(mode: AuthMode, onModeChange = vi.fn()) {
	return render(
		<AuthCard
			mode={mode}
			identifier=""
			username=""
			email=""
			password=""
			error=""
			isSubmitting={false}
			onModeChange={onModeChange}
			onIdentifierChange={vi.fn()}
			onUsernameChange={vi.fn()}
			onEmailChange={vi.fn()}
			onPasswordChange={vi.fn()}
			onSubmit={vi.fn()}
			onOAuthLogin={vi.fn()}
			onGuestLogin={vi.fn()}
		/>,
	);
}

describe("AuthCard", () => {
	it("labels the local login identifier as email or username", () => {
		renderCard("login");

		expect(screen.getByLabelText("Email or username")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Create account" }),
		).not.toBeInTheDocument();
	});

	it("shows valid email and username fields in registration mode", () => {
		renderCard("register");

		expect(screen.getByLabelText("Username")).toBeInTheDocument();
		expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
		expect(
			screen.getByRole("button", { name: "Create account" }),
		).toBeInTheDocument();
	});

	it("switches from login to registration", () => {
		const onModeChange = vi.fn();
		renderCard("login", onModeChange);

		fireEvent.click(screen.getByRole("button", { name: "Register" }));
		expect(onModeChange).toHaveBeenCalledWith("register");
	});

	it("preserves the login identifier in the matching registration field", () => {
		expect(registrationPrefill("  turtle_player  ")).toEqual({
			username: "turtle_player",
			email: "",
		});
		expect(registrationPrefill("  turtle@example.com  ")).toEqual({
			username: "",
			email: "turtle@example.com",
		});
	});
});
