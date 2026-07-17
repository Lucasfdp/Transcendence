import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Achievement } from "../hub/api";
import { PlayerProfilePreview } from "./PlayerProfilePreview";

const achievement: Achievement = {
	id: "first-win",
	title: "First Victory",
	description: "Win your first match.",
	unlockDescription: "Win once.",
	reward: { type: "none" },
	progressCurrent: 1,
	progressTarget: 1,
	unlocked: true,
	unlockedAt: "2026-07-17T00:00:00.000Z",
};

describe("PlayerProfilePreview", () => {
	it("renders the live identity, showcase slots, and statistics", () => {
		render(
			<PlayerProfilePreview
				displayName="Max"
				shellSkin="dragon"
				level={7}
				xp={4850}
				backgroundId="night_bg"
				tag={{ emoji: "🛡️", label: "Shell First" }}
				achievements={[achievement, null, null]}
				statistics={[
					{ label: "Matches", value: 142 },
					{ label: "Wins", value: 81 },
					{ label: "Gold earned", value: 8500 },
				]}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Max" })).toBeInTheDocument();
		expect(screen.getByLabelText("Player card preview")).toHaveClass(
			"profile-preview--with-background",
			"profile-preview--night",
		);
		expect(screen.queryByText("Player card preview")).not.toBeInTheDocument();
		expect(screen.getByText("🛡️ Shell First")).toBeInTheDocument();
		expect(
			screen.getByRole("progressbar", { name: "Experience towards level 8" }),
		).toHaveAttribute("aria-valuenow", "4850");
		expect(screen.getByText("First Victory")).toBeInTheDocument();
		expect(screen.getAllByText("Empty showcase slot")).toHaveLength(2);
		expect(screen.getByText("142")).toBeInTheDocument();
		expect(screen.getByText("81")).toBeInTheDocument();
		expect(screen.getByText("8,500")).toBeInTheDocument();
	});
});
