import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OAuthButtons } from "./OAuthButtons";

describe("OAuthButtons", () => {
	it("shows only 42 without a provider toggle", () => {
		render(<OAuthButtons isSubmitting={false} onOAuthLogin={vi.fn()} />);

		expect(screen.getAllByRole("button")).toHaveLength(1);
		expect(
			screen.getByRole("button", { name: "Continue with 42" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /OAuth providers/i }),
		).not.toBeInTheDocument();
	});

	it("starts the selected provider flow", () => {
		const onOAuthLogin = vi.fn();
		render(
			<OAuthButtons
				isSubmitting={false}
				onOAuthLogin={onOAuthLogin}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Continue with 42" }),
		);
		expect(onOAuthLogin).toHaveBeenCalledWith("/api/auth/42");
	});
});
