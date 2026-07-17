import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExperienceProgress } from "./ExperienceProgress";

describe("ExperienceProgress", () => {
	it("shows progress towards the next level", () => {
		render(<ExperienceProgress level={7} xp={4850} />);

		const progress = screen.getByRole("progressbar", {
			name: "Experience towards level 8",
		});
		expect(progress).toHaveAttribute("aria-valuenow", "4850");
		expect(progress).toHaveAttribute("aria-valuemax", "7000");
		expect(screen.getByText("4,850 / 7,000")).toBeInTheDocument();
		expect(progress.querySelector(".experience-progress__fill")).toHaveStyle({
			"--experience-progress": "69.28571428571428%",
		});
	});

	it("clamps invalid progress values to the available range", () => {
		const { rerender } = render(<ExperienceProgress level={0} xp={-50} />);

		let progress = screen.getByRole("progressbar");
		expect(progress).toHaveAttribute("aria-valuenow", "0");
		expect(progress).toHaveAttribute("aria-valuemax", "1000");

		rerender(<ExperienceProgress level={2} xp={2500} compact />);
		progress = screen.getByRole("progressbar");
		expect(progress).toHaveAttribute("aria-valuenow", "2000");
		expect(progress).toHaveClass("experience-progress--compact");
	});
});
