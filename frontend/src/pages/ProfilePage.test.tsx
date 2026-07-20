import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, AuthError, type Achievement, type PublicUserView } from "../features/hub/api";
import { ProfilePage } from "./ProfilePage";

vi.mock("../features/hub/api", async (importOriginal) => {
	const original = await importOriginal<typeof import("../features/hub/api")>();
	return {
		...original,
		api: {
			...original.api,
			getUser: vi.fn(),
			getAchievements: vi.fn(),
		},
	};
});

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

const publicUser: PublicUserView = {
	id: 7,
	username: "kame",
	turtleName: "Kame Master",
	shellSkin: "dragon",
	hubBackground: "sunset_bg",
	avatar: null,
	level: 12,
	accountAgeDays: 198,
	isOnline: true,
	mostPlayedGame: {
		gameId: "bamboo-bash",
		gameName: "Bamboo Bash",
		gamesPlayed: 13,
		winRate: 77,
	},
	profile: {
		totalWins: 10,
		totalLosses: 3,
		gamesPlayed: 13,
		totalCoinsEarned: 12500,
		tag: "shell-first",
		showcasedAchievements: ["first-win"],
	},
};

function Location(): JSX.Element {
	return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderPage(): void {
	render(
		<MemoryRouter
			initialEntries={["/profile/kame"]}
			future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
		>
			<Routes>
				<Route path="/profile/:username" element={<ProfilePage />} />
				<Route path="/" element={<Location />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("ProfilePage", () => {
	beforeEach(() => {
		vi.mocked(api.getUser).mockReset();
		vi.mocked(api.getAchievements).mockReset();
	});

	it("shows a clear loading state while the profile request is pending", () => {
		vi.mocked(api.getUser).mockReturnValue(new Promise(() => undefined));
		vi.mocked(api.getAchievements).mockReturnValue(new Promise(() => undefined));

		renderPage();

		expect(screen.getByRole("status")).toHaveTextContent("Loading turtle profile");
	});

	it("renders the public profile and resolves known showcase achievements", async () => {
		vi.mocked(api.getUser).mockResolvedValue(publicUser);
		vi.mocked(api.getAchievements).mockResolvedValue([achievement]);

		renderPage();

		expect(await screen.findByRole("heading", { name: "Kame Master" })).toBeInTheDocument();
		expect(screen.getByText("@kame")).toBeInTheDocument();
		expect(screen.getByText("Online")).toBeInTheDocument();
		expect(screen.getByText("🛡️ Shell First")).toBeInTheDocument();
		expect(screen.getByText("Bamboo Bash")).toBeInTheDocument();
		expect(screen.getByText("Total matches")).toBeInTheDocument();
		expect(screen.getByText("Gold earned")).toBeInTheDocument();
		expect(screen.getByText("12,500")).toBeInTheDocument();
		expect(screen.getByText("Account age")).toBeInTheDocument();
		expect(screen.getByText("198 days")).toBeInTheDocument();
		expect(screen.getByText("Total losses")).toBeInTheDocument();
		const preview = screen.getByLabelText("Player card preview");
		expect(preview).toHaveClass(
			"profile-preview--with-background",
			"profile-preview--sunset",
		);
		expect(within(preview).getByText("First Victory")).toBeInTheDocument();
		expect(within(preview).queryByRole("progressbar")).not.toBeInTheDocument();
		expect(screen.getByRole("img", { name: "Kame Master's shell portrait" })).toBeInTheDocument();
	});

	it("shows the full achievement catalog below the showcase, not a page-local copy", async () => {
		const lockedAchievement: Achievement = {
			id: "matches-5-played",
			title: "Getting Started",
			description: "Play 5 matches.",
			unlockDescription: "Play 5 matches.",
			reward: { type: "none" },
			progressCurrent: 2,
			progressTarget: 5,
			unlocked: false,
			unlockedAt: null,
		};
		vi.mocked(api.getUser).mockResolvedValue(publicUser);
		vi.mocked(api.getAchievements).mockResolvedValue([achievement, lockedAchievement]);

		renderPage();

		const section = await screen.findByRole("heading", { name: "Achievements" });
		const achievementsSection = section.closest("section") as HTMLElement;
		expect(within(achievementsSection).getByText("First Victory")).toBeInTheDocument();
		expect(within(achievementsSection).getByText("Getting Started")).toBeInTheDocument();
		expect(within(achievementsSection).getByText("1/2 unlocked")).toBeInTheDocument();
	});

	it("uses safe placeholders for no tag, no matches, and unknown achievement IDs", async () => {
		vi.mocked(api.getUser).mockResolvedValue({
			...publicUser,
			turtleName: null,
			isOnline: false,
			mostPlayedGame: null,
			profile: {
				...publicUser.profile!,
				tag: null,
				showcasedAchievements: ["removed-achievement"],
			},
		});
		vi.mocked(api.getAchievements).mockResolvedValue([achievement]);

		renderPage();

		expect(await screen.findByRole("heading", { name: "kame" })).toBeInTheDocument();
		expect(screen.getByText("No dojo tag")).toBeInTheDocument();
		expect(screen.getAllByText("Empty showcase slot")).toHaveLength(3);
		expect(screen.getByText("No games yet")).toBeInTheDocument();
		expect(screen.getByText("12,500")).toBeInTheDocument();
		expect(screen.getByText("198 days")).toBeInTheDocument();
		expect(screen.getByText("Offline")).toBeInTheDocument();
	});

	it("shows useful messages for missing and invalid profiles", async () => {
		vi.mocked(api.getUser).mockRejectedValueOnce(new AuthError(404, "User not found"));
		vi.mocked(api.getAchievements).mockResolvedValue([]);

		renderPage();
		expect(await screen.findByText("This turtle profile does not exist.")).toBeInTheDocument();

		vi.mocked(api.getUser).mockResolvedValueOnce({ username: "broken" } as PublicUserView);
		renderPage();
		expect(await screen.findByText(/invalid response/i)).toBeInTheDocument();
	});

	it("reports a network failure without exposing transport details", async () => {
		vi.mocked(api.getUser).mockRejectedValue(new Error("socket credentials"));
		vi.mocked(api.getAchievements).mockResolvedValue([]);

		renderPage();

		expect(await screen.findByText(/check your connection/i)).toBeInTheDocument();
		expect(screen.queryByText(/socket credentials/i)).not.toBeInTheDocument();
	});

	it("does not render private fields and navigates back to the hub", async () => {
		vi.mocked(api.getUser).mockResolvedValue({
			...publicUser,
			email: "secret@example.com",
			coins: 999,
			passwordHash: "salt:hash",
		} as PublicUserView);
		vi.mocked(api.getAchievements).mockResolvedValue([achievement]);

		renderPage();
		await screen.findByRole("heading", { name: "Kame Master" });

		expect(screen.queryByText("secret@example.com")).not.toBeInTheDocument();
		expect(screen.queryByText("salt:hash")).not.toBeInTheDocument();
		expect(screen.queryByText("999")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("link", { name: "Back to hub" }));
		await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/"));
	});
});
