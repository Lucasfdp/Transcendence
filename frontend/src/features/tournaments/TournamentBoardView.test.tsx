import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TournamentMinigameStartPayload } from "./TournamentBoardView";
import { TournamentBoardView } from "./TournamentBoardView";

const mocks = vi.hoisted(() => {
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	const socket = {
		on: vi.fn((event: string, handler: (payload: unknown) => void) => {
			const handlers = listeners.get(event) ?? new Set();
			handlers.add(handler);
			listeners.set(event, handlers);
		}),
		off: vi.fn((event: string, handler: (payload: unknown) => void) => {
			listeners.get(event)?.delete(handler);
		}),
		emit: vi.fn(),
	};
	return { listeners, socket };
});

vi.mock("../../services/network/gameSocket", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../../services/network/gameSocket")>();
	return { ...original, getGameSocket: () => mocks.socket };
});

vi.mock("../hub/api", async (importOriginal) => {
	const original = await importOriginal<typeof import("../hub/api")>();
	return {
		...original,
		api: {
			...original.api,
			getMe: vi.fn().mockResolvedValue({
				id: 1,
				username: "kame",
				hubBackground: "night_bg",
				hubBackgroundAlter: null,
			}),
		},
	};
});

/** Reads the navigation this app landed on, so we can inspect its state. */
function LocationProbe(): JSX.Element {
	const location = useLocation();
	return (
		<div data-testid="probe">
			{location.pathname}
			{"|"}
			{JSON.stringify(location.state)}
		</div>
	);
}

describe("TournamentBoardView — minigame launch handoff", () => {
	beforeEach(() => {
		mocks.listeners.clear();
		mocks.socket.on.mockClear();
		mocks.socket.off.mockClear();
		mocks.socket.emit.mockClear();
	});

	it("carries the full tournament:minigame-start payload through navigation instead of discarding it", async () => {
		render(
			<MemoryRouter
				initialEntries={["/tournament/t-1"]}
				future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
			>
				<Routes>
					<Route
						path="/tournament/:tournamentId"
						element={
							<TournamentBoardView tournamentId="t-1" onExit={() => undefined} />
						}
					/>
					<Route path="/play/:gameId" element={<LocationProbe />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() =>
			expect(mocks.listeners.get("tournament:minigame-start")?.size).toBe(1),
		);

		const payload: TournamentMinigameStartPayload = {
			matchId: "match-9",
			side: 1,
			gameId: "kame-knock",
			tournamentId: "t-1",
			snapshot: { matchId: "match-9", gameId: "kame-knock" } as never,
		};
		act(() => {
			for (const handler of mocks.listeners.get("tournament:minigame-start") ??
				[])
				handler(payload);
		});

		// Lands on the arena route with the FULL payload available — not just
		// the old `{ autoJoinMatch: true }`, which forced GamePage to
		// rediscover the match through a match:status → match:rejoin round
		// trip (see GamePage.tsx). That round trip could outrun the arena's
		// "every real seat is in" gate (BotPlayerService / game:arena-ready),
		// landing the player mid-match with the CPUs already playing.
		const probe = await screen.findByTestId("probe");
		expect(probe.textContent).toContain("/play/kame-knock");
		const state = JSON.parse(probe.textContent!.split("|")[1]) as {
			autoJoinMatch?: boolean;
			tournamentMinigame?: TournamentMinigameStartPayload;
		};
		expect(state.autoJoinMatch).toBe(true);
		expect(state.tournamentMinigame).toEqual(payload);
	});
});
