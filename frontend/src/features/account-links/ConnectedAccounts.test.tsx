import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedAccounts } from "./ConnectedAccounts";
import { useAccountLinks } from "./useAccountLinks";

vi.mock("./useAccountLinks", () => ({ useAccountLinks: vi.fn() }));

const baseHook = {
	state: {
		prefill: { username: "dojo_user", email: "dojo@example.com" },
		methods: [
			{ method: "shellsmash" as const, linked: false },
			{ method: "google" as const, linked: true },
			{ method: "forty_two" as const, linked: false },
		],
		conflict: null,
	},
	loading: false,
	error: "",
	submitting: false,
	conflictOpen: false,
	setConflictOpen: vi.fn(),
	refresh: vi.fn(),
	createShellsmash: vi.fn(),
	linkShellsmash: vi.fn(),
	startOAuth: vi.fn(),
	unlink: vi.fn(),
	unlinkDuplicate: vi.fn(),
	resolve: vi.fn(),
};

describe("ConnectedAccounts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useAccountLinks).mockReturnValue(baseHook);
	});

	it("shows all three methods and the linked state", () => {
		render(<ConnectedAccounts />);
		expect(screen.getByText("ShellSmash account")).toBeInTheDocument();
		expect(screen.getByText("Google")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "42" })).toBeInTheDocument();
		expect(screen.getByText("1/3 linked")).toBeInTheDocument();
	});

	it("prefills the ShellSmash creation form with available account data", async () => {
		const user = userEvent.setup();
		render(<ConnectedAccounts />);
		await user.click(screen.getByRole("button", { name: "Create account" }));
		expect(screen.getByLabelText("Username")).toHaveValue("dojo_user");
		expect(screen.getByLabelText("Email")).toHaveValue("dojo@example.com");
	});

	it("keeps a visible alert after a pending conflict modal is closed", async () => {
		const setConflictOpen = vi.fn();
		vi.mocked(useAccountLinks).mockReturnValue({
			...baseHook,
			setConflictOpen,
			state: {
				...baseHook.state,
				conflict: { id: "conflict" } as never,
			},
		});
		const user = userEvent.setup();
		render(<ConnectedAccounts />);
		await user.click(
			screen.getByRole("button", {
				name: "Account conflict pending — resolve it now",
			}),
		);
		expect(setConflictOpen).toHaveBeenCalledWith(true);
	});
});
