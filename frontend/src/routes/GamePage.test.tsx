import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TournamentMinigameStartPayload } from "../features/tournaments/TournamentBoardView";
import type { GameSnapshot } from "../services/network/gameSocket";

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
	const createShellSmashGame = vi.fn((..._args: unknown[]) => ({
		destroy: vi.fn(),
	}));
	const user = {
		id: 1,
		username: "kame",
		turtleName: null,
		shellSkin: "base",
		trailEffect: "trail_classic",
		hubBackground: "night_bg",
		hubBackgroundAlter: null,
		level: 1,
		xp: 0,
		coins: 0,
		isGuest: false,
		isDevAccount: false,
		avatar: null,
		mostPlayedGame: null,
	};
	return { listeners, socket, createShellSmashGame, user };
});

vi.mock("../services/network/gameSocket", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../services/network/gameSocket")>();
	return { ...original, getGameSocket: () => mocks.socket };
});

vi.mock("../features/hub/api", async (importOriginal) => {
	const original = await importOriginal<typeof import("../features/hub/api")>();
	return {
		...original,
		api: {
			...original.api,
			getMe: vi.fn(),
		},
	};
});

vi.mock("../app/session/SessionContext", () => ({
	useSession: () => ({ user: mocks.user, status: "authenticated" }),
}));

vi.mock("../lib/createShellSmashGame", () => ({
	createShellSmashGame: mocks.createShellSmashGame,
}));
// GamePage also pulls in Phaser indirectly (hud.ts, ReturnToHubScene.ts) even
// with createShellSmashGame mocked above — Phaser's WebGL renderer reaches
// for an optional peer dep (phaser3spectorjs) that isn't installed, and
// ReturnToHubScene extends Phaser.Scene at module-load time, so a bare `{}`
// stub (as used in online-rematch.test.ts, which never loads that class)
// isn't enough here — a minimal extendable Scene stub is needed too.
vi.mock("phaser", () => ({ default: { Scene: class {} } }));

// eslint-disable-next-line import/first -- must follow the vi.mock calls above
import GamePage from "./GamePage";
// eslint-disable-next-line import/first -- must follow the vi.mock calls above
import { api } from "../features/hub/api";

function kameKnockSnapshot(): GameSnapshot {
	return {
		matchId: "match-1",
		seq: 1,
		gameId: "kame-knock",
		mode: "casual",
		powerupsEnabled: false,
		phase: "active",
		players: [
			{
				side: 0,
				userId: 1,
				username: "kame",
				connected: true,
				ready: true,
				reconnectExpiresAt: null,
			},
			{
				side: 1,
				userId: 2,
				username: "bot-2",
				connected: true,
				ready: true,
				reconnectExpiresAt: null,
			},
		],
	} as unknown as GameSnapshot;
}

function renderAtMinigameStart(payload: TournamentMinigameStartPayload) {
	return render(
		<MemoryRouter
			initialEntries={[
				{
					pathname: "/play/kame-knock",
					state: { autoJoinMatch: true, tournamentMinigame: payload },
				},
			]}
			future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
		>
			<Routes>
				<Route path="/play/:gameId" element={<GamePage />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("GamePage — tournament minigame direct launch", () => {
	beforeEach(() => {
		mocks.listeners.clear();
		mocks.socket.on.mockClear();
		mocks.socket.off.mockClear();
		mocks.socket.emit.mockClear();
		mocks.createShellSmashGame.mockClear();
		vi.mocked(api.getMe).mockClear();
	});

	it("launches straight into the arena from the tournament:minigame-start payload, with no round trip", async () => {
		const payload: TournamentMinigameStartPayload = {
			matchId: "match-1",
			side: 0,
			gameId: "kame-knock",
			tournamentId: "t-1",
			snapshot: kameKnockSnapshot(),
		};

		renderAtMinigameStart(payload);

		// The Phaser host mounts directly — the "selecting queue" panel
		// (PowerupMatchmakingPanel's online-search UI) never shows on the way
		// in, unlike the old { autoJoinMatch: true }-only path.
		await waitFor(() =>
			expect(
				screen.getByLabelText("Shell Smash game canvas"),
			).toBeInTheDocument(),
		);
		expect(
			screen.queryByText(/Power-ups are off by default/i),
		).not.toBeInTheDocument();

		expect(mocks.createShellSmashGame).toHaveBeenCalledTimes(1);
		expect(api.getMe).not.toHaveBeenCalled();
		const launchData = mocks.createShellSmashGame.mock.calls[0]?.[1] as {
			onlineMatch?: { matchId: string; side: number; tournamentId?: string };
		};
		expect(launchData.onlineMatch?.matchId).toBe("match-1");
		expect(launchData.onlineMatch?.side).toBe(0);
		expect(launchData.onlineMatch?.tournamentId).toBe("t-1");

		// The server hears the client is genuinely in — the signal
		// BotPlayerService waits on before letting CPUs move (game:arena-ready).
		expect(mocks.socket.emit).toHaveBeenCalledWith("game:arena-ready", {
			matchId: "match-1",
		});

		// No round trip through match:rejoin: the old indirect path (discarding
		// this payload and re-fetching it via match:status → match:rejoin →
		// game:physics-request) is what let a slow client race the CPUs' 20s
		// arena-entry backstop and land mid-match.
		expect(mocks.socket.emit).not.toHaveBeenCalledWith(
			"match:rejoin",
			expect.anything(),
		);
		expect(mocks.socket.emit).not.toHaveBeenCalledWith("match:rejoin");
	});

	it("falls back to the auto-join round trip when the carried payload is for a different game (stale navigation state)", async () => {
		const payload: TournamentMinigameStartPayload = {
			matchId: "match-1",
			side: 0,
			gameId: "bell-clash",
			tournamentId: "t-1",
			snapshot: kameKnockSnapshot(),
		};

		renderAtMinigameStart(payload);

		// Still shows the matchmaking panel (the round-trip fallback) instead
		// of launching directly with mismatched data.
		await waitFor(() =>
			expect(
				screen.getByText(/Power-ups are off by default/i),
			).toBeInTheDocument(),
		);
		expect(mocks.createShellSmashGame).not.toHaveBeenCalled();
	});
});
