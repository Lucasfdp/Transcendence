import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	api,
	type MonteConfig,
	type MonteRoundStart,
	type MonteRoundSteps,
} from "../../features/hub/api";
import { ThreeShellMonteModal } from "./ThreeShellMonteModal";
import { monteSwapDurations } from "./monte";

vi.mock("../../features/hub/api", () => ({
	api: {
		getMonte: vi.fn(),
		startMonteRound: vi.fn(),
		getMonteSteps: vi.fn(),
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

const stepDurations = monteSwapDurations(8);

const started: MonteRoundStart = {
	roundId: "round-1",
	cupIds: ["cup-a", "cup-b", "cup-c"],
	ballStartSlot: 1,
	stepCount: 8,
	stepDurations,
	shuffleLeadMs: 1650,
	totalShuffleMs: stepDurations.reduce((total, ms) => total + ms, 0),
	serverSeedHash: "hash",
	commitHash: "commit",
	clientSeed: "",
	nonce: 7,
	stake: 10,
	expiresAt: new Date(Date.now() + 60_000).toISOString(),
	coins: 490,
};

const allDelivered: MonteRoundSteps = {
	roundId: "round-1",
	steps: stepDurations.map((_, index) => ({
		index,
		pair: [0, 1] as [number, number],
	})),
	stepCount: 8,
	ready: true,
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
		vi.mocked(api.getMonteSteps).mockResolvedValue(allDelivered);
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

		// The server reports the shuffle complete and the gate open, so the first
		// poll flips the board to "choosing" — no client-side timer decides this.
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(root()).toHaveAttribute("data-phase", "choosing");
		expect(screen.getByText("Choose a cup.")).toBeInTheDocument();
	});

	it("resumes an in-flight round reported by the server on load", async () => {
		vi.mocked(api.getMonte).mockResolvedValue({ ...config, activeRound: started });

		const { container } = render(
			<ThreeShellMonteModal coins={490} onCoinsChange={vi.fn()} />,
		);

		// No Start click: the open round is resumed straight into the choice once
		// the server reports its steps delivered and gate open.
		await screen.findByText("Choose a cup.");
		expect(container.querySelector(".hub-monte")).toHaveAttribute(
			"data-phase",
			"choosing",
		);
	});
});
