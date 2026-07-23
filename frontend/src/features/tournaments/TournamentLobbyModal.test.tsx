import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../hub/api";
import { tournamentApi } from "./api";
import { TournamentLobbyModal } from "./TournamentLobbyModal";

vi.mock("../hub/api", async (importOriginal) => {
	const original = await importOriginal<typeof import("../hub/api")>();
	return {
		...original,
		api: { ...original.api, getMe: vi.fn() },
	};
});

vi.mock("./api", () => ({
	tournamentApi: {
		getMine: vi.fn(),
		joinByPin: vi.fn(),
	},
}));

function renderLobby(): void {
	render(
		<MemoryRouter
			future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
		>
			<TournamentLobbyModal isOpen onClose={() => undefined} />
		</MemoryRouter>,
	);
}

describe("TournamentLobbyModal", () => {
	beforeEach(() => {
		vi.mocked(api.getMe).mockReset().mockResolvedValue({ id: 7 } as never);
		vi.mocked(tournamentApi.getMine).mockReset().mockResolvedValue(null);
		vi.mocked(tournamentApi.joinByPin).mockReset();
	});

	it("rejects an invalid PIN locally without sending a bad request", async () => {
		renderLobby();
		const input = await screen.findByLabelText("Tournament PIN");

		fireEvent.change(input, { target: { value: "BAD" } });
		fireEvent.click(screen.getByRole("button", { name: "Join" }));

		expect(
			screen.getByText("Enter a 6-character PIN beginning with T."),
		).toBeInTheDocument();
		expect(tournamentApi.joinByPin).not.toHaveBeenCalled();
	});

	it("normalises a pasted PIN before joining", async () => {
		vi.mocked(tournamentApi.joinByPin).mockRejectedValue(
			new Error("Lobby not found"),
		);
		renderLobby();
		const input = await screen.findByLabelText("Tournament PIN");

		fireEvent.change(input, { target: { value: "t-ab 2c9" } });
		expect(input).toHaveValue("TAB2C9");
		fireEvent.click(screen.getByRole("button", { name: "Join" }));

		await waitFor(() =>
			expect(tournamentApi.joinByPin).toHaveBeenCalledWith("TAB2C9"),
		);
	});
});
