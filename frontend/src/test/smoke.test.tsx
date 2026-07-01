import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function Hello(): JSX.Element {
	return <p>harness online</p>;
}

describe("test harness", () => {
	it("should render a component into jsdom when the runner is configured", () => {
		render(<Hello />);
		expect(screen.getByText("harness online")).toBeInTheDocument();
	});
});
