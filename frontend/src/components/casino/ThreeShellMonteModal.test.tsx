import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type MonteConfig, type MonteRoundStart } from "../../features/hub/api";
import { ThreeShellMonteModal } from "./ThreeShellMonteModal";
import { monteSwapDurations } from "./monte";

vi.mock("../../features/hub/api", () => ({
	api: {
		getMonte: vi.fn(),
		startMonteRound: vi.fn(),
		resolveMonteRound: vi.fn(),
		getCsrfToken: vi.fn(),
	},
}));

const config: MonteConfig = {
	shellOptions: [3],
	defaultShells: 3,
	rtp: 1,
	minWager: 10,
	maxWager: 1000,
	coins: 500,
};

const started: MonteRoundStart = {
	roundId: "round-1",
	cupIds: ["cup-a", "cup-b", "cup-c"],
	ballCupId: "cup-b",
	serverSeedHash: "hash",
	winningCupHash: "cup-hash",
	clientSeed: "",
	nonce: 7,
	stake: 10,
	expiresAt: new Date(Date.now() + 60_000).toISOString(),
	coins: 490,
};

function matchMediaStub(): typeof window.matchMedia {
	return vi.fn().mockReturnValue({
		matches: false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});
}

describe("ThreeShellMonteModal", () => {
	beforeEach(() => {
		vi.stubGlobal("matchMedia", matchMediaStub());
		vi.mocked(api.getMonte).mockResolvedValue(config);
		vi.mocked(api.getCsrfToken).mockResolvedValue("token");
		vi.mocked(api.startMonteRound).mockResolvedValue(started);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("moves through preview, covering, shuffling and choosing after start", async () => {
		const { container } = render(
			<ThreeShellMonteModal coins={500} onCoinsChange={vi.fn()} />,
		);
		const root = () => container.querySelector(".hub-monte");
		const startButton = await screen.findByRole("button", {
			name: /Start game/,
		});

		vi.useFakeTimers();
		fireEvent.click(startButton);
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(root()).toHaveAttribute("data-phase", "preview");
		expect(screen.getByText(/Watch the pearl/)).toBeInTheDocument();

		act(() => {
			vi.advanceTimersByTime(1200);
		});
		expect(root()).toHaveAttribute("data-phase", "covering");

		act(() => {
			vi.advanceTimersByTime(450);
		});
		expect(root()).toHaveAttribute("data-phase", "shuffling");

		const shuffleMs = monteSwapDurations(8).reduce(
			(total, duration) => total + duration,
			0,
		);
		const finalSwapMs = monteSwapDurations(8).at(-1) ?? 0;
		act(() => {
			vi.advanceTimersByTime(shuffleMs + finalSwapMs);
		});
		expect(root()).toHaveAttribute("data-phase", "choosing");
		expect(screen.getByText("Choose a cup.")).toBeInTheDocument();
	});
});
