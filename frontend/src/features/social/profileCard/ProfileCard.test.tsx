import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileCard, type ProfileCardUser } from "./ProfileCard";

const baseUser: ProfileCardUser = {
	level: 12,
	profile: {
		totalWins: 5,
		totalLosses: 3,
		tag: "Shell Sensei",
	},
	mostPlayedGame: {
		gameName: "Bamboo Bash",
		winRate: 62,
	},
};

describe("ProfileCard", () => {
	it("should show a loading message while loading", () => {
		render(<ProfileCard user={null} loading={true} />);
		expect(screen.getByText(/loading/i)).toBeInTheDocument();
	});

	it("should show an error message when not loading and there is no user", () => {
		render(<ProfileCard user={null} loading={false} />);
		expect(screen.getByText(/could not load profile/i)).toBeInTheDocument();
	});

	it("should render level, tag, most-played game and win/loss record", () => {
		render(<ProfileCard user={baseUser} loading={false} />);
		expect(screen.getByText(/level 12/i)).toBeInTheDocument();
		expect(screen.getByText("Shell Sensei")).toBeInTheDocument();
		expect(screen.getByText(/bamboo bash/i)).toBeInTheDocument();
		expect(screen.getByText(/62% wr/i)).toBeInTheDocument();
		expect(screen.getByText(/5\s*-\s*3/)).toBeInTheDocument();
	});

	it("should fall back gracefully when tag and mostPlayedGame are null", () => {
		render(
			<ProfileCard
				user={{
					level: 1,
					profile: { totalWins: 0, totalLosses: 0, tag: null },
					mostPlayedGame: null,
				}}
				loading={false}
			/>,
		);
		expect(screen.getByText(/level 1/i)).toBeInTheDocument();
		expect(screen.getByText(/no games played yet/i)).toBeInTheDocument();
	});

	it("should fall back gracefully when profile is undefined (e.g. guest account)", () => {
		render(
			<ProfileCard
				user={{ level: 1, profile: undefined, mostPlayedGame: null }}
				loading={false}
			/>,
		);
		expect(screen.getByText(/level 1/i)).toBeInTheDocument();
		expect(screen.getByText(/0\s*-\s*0/)).toBeInTheDocument();
	});
});
