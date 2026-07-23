import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, AuthError, type User } from "../features/hub/api";
import { useSession } from "../app/session/SessionContext";
import { resetSessionStore } from "../app/session/sessionStore";
import { AppRoutes } from "./AppRoutes";

vi.mock("../features/hub/api", async (importOriginal) => {
	const original = await importOriginal<typeof import("../features/hub/api")>();
	return {
		...original,
		api: {
			...original.api,
			getMe: vi.fn(),
			getNotifications: vi.fn().mockResolvedValue([]),
			getUnreadConversations: vi.fn().mockResolvedValue([]),
		},
	};
});

vi.mock("../services/network/gameSocket", () => ({
	getGameSocket: () => ({ on: vi.fn(), off: vi.fn() }),
	disconnectGameSocket: vi.fn(),
}));

vi.mock("../pages/AuthPage", () => ({
	AuthPage: () => {
		const navigate = useNavigate();
		return <button onClick={() => navigate("/")}>Complete login</button>;
	},
}));

vi.mock("../pages/HomePage", () => ({
	HomePage: () => {
		const navigate = useNavigate();
		const { invalidateSession, setCurrentUser } = useSession();
		return (
			<>
				<button onClick={() => navigate("/profile/kame")}>Open profile</button>
				<button
					onClick={() => {
						invalidateSession();
						navigate("/auth");
						queueMicrotask(() => setCurrentUser(user));
					}}
				>
					Logout with late update
				</button>
			</>
		);
	},
}));

vi.mock("../pages/ProfilePage", () => ({
	ProfilePage: () => <div>Profile route</div>,
}));

vi.mock("./GamePage", () => ({ default: () => <div>Game route</div> }));
vi.mock("./TournamentPage", () => ({ default: () => <div>Tournament route</div> }));

const user = { id: 7, username: "kame" } as User;

describe("AppRoutes session ownership", () => {
	beforeEach(() => {
		resetSessionStore();
		vi.mocked(api.getMe).mockReset();
	});

	it("refreshes once after authentication and reuses the session across routes", async () => {
		vi.mocked(api.getMe)
			.mockRejectedValueOnce(new AuthError(401, "Unauthorized"))
			.mockResolvedValueOnce(user);

		render(
			<MemoryRouter
				initialEntries={["/auth"]}
				future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
			>
				<AppRoutes />
			</MemoryRouter>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Complete login" }));
		expect(await screen.findByRole("button", { name: "Open profile" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Open profile" }));
		expect(await screen.findByText("Profile route")).toBeInTheDocument();

		await waitFor(() => expect(api.getMe).toHaveBeenCalledTimes(2));
	});

	it("revalidates a stale session before entering another protected route", async () => {
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		vi.mocked(api.getMe)
			.mockRejectedValueOnce(new AuthError(401, "Unauthorized"))
			.mockResolvedValueOnce(user)
			.mockRejectedValueOnce(new AuthError(401, "Expired"));

		render(
			<MemoryRouter
				initialEntries={["/auth"]}
				future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
			>
				<AppRoutes />
			</MemoryRouter>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Complete login" }));
		expect(await screen.findByRole("button", { name: "Open profile" })).toBeInTheDocument();
		clock.mockReturnValue(now + 31_000);
		fireEvent.click(screen.getByRole("button", { name: "Open profile" }));

		expect(await screen.findByRole("button", { name: "Complete login" })).toBeInTheDocument();
		expect(api.getMe).toHaveBeenCalledTimes(3);
		clock.mockRestore();
	});

	it("retries a transient session failure without redirecting to login", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.mocked(api.getMe)
			.mockRejectedValueOnce(new Error("gateway unavailable"))
			.mockResolvedValueOnce(user);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		render(
			<MemoryRouter
				initialEntries={["/"]}
				future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
			>
				<AppRoutes />
			</MemoryRouter>,
		);

		expect(await screen.findByText("Loading route")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Complete login" }),
		).not.toBeInTheDocument();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_000);
		});
		expect(await screen.findByRole("button", { name: "Open profile" })).toBeInTheDocument();
		warn.mockRestore();
		vi.useRealTimers();
	});

	it("ignores a user update that resolves after explicit logout", async () => {
		vi.mocked(api.getMe)
			.mockRejectedValueOnce(new AuthError(401, "Unauthorized"))
			.mockResolvedValueOnce(user);

		render(
			<MemoryRouter
				initialEntries={["/auth"]}
				future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
			>
				<AppRoutes />
			</MemoryRouter>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Complete login" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Logout with late update" }),
		);

		expect(await screen.findByRole("button", { name: "Complete login" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Open profile" })).not.toBeInTheDocument();
	});
});
