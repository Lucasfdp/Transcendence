import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ViewProfileLink } from "./ViewProfileLink";

function Destination(): JSX.Element {
	return <output>{useLocation().pathname}</output>;
}

describe("ViewProfileLink social navigation", () => {
	it("opens another user's encoded public profile route", () => {
		render(
			<MemoryRouter
				future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
			>
				<div aria-label="Social friend actions">
					<ViewProfileLink username="turtle rival" />
				</div>
				<Routes>
					<Route path="/" element={null} />
					<Route path="/profile/:username" element={<Destination />} />
				</Routes>
			</MemoryRouter>,
		);

		const link = screen.getByRole("link", { name: "View profile" });
		expect(link).toHaveAttribute("href", "/profile/turtle%20rival");
		fireEvent.click(link);
		expect(screen.getByText("/profile/turtle%20rival")).toBeInTheDocument();
	});
});
