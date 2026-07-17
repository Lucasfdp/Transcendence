/**
 * Regression coverage for the "balance updates too early" bug: every casino
 * modal except Three-Shell Monte used to sync the hub's coin balance the
 * moment the server settled a wager, before the cosmetic spin/roll/shuffle/
 * drop animation had shown the player whether they won or lost. That let the
 * balance change on screen before the outcome did, spoiling the result.
 *
 * The fix holds `onCoinsChange` back until each animation's own
 * `finish()`/`onComplete` handler runs (i.e. until the result is actually
 * revealed), while still guaranteeing the balance is flushed if the modal is
 * closed mid-animation (via a "sync on unmount if not yet settled" fallback
 * — otherwise closing early would silently desync the hub header).
 *
 * Every test below freezes the cosmetic animation mid-flight by stubbing
 * `requestAnimationFrame` to never invoke its callback, so each modal's own
 * `finish()`/`onComplete` handler can never run through the normal path.
 * That lets each test assert `onCoinsChange` has NOT fired yet once the
 * server has responded, then unmount the modal (simulating the player
 * closing it) and assert the fallback still flushes the correct balance.
 * Canvas-backed boards (Shell Drop, Slots) additionally need a
 * real-looking `getContext`/`getBoundingClientRect` since jsdom implements
 * neither by default.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../features/hub/api";
import {
	gamblingApi,
	type DiceConfig,
	type FlipConfig,
	type MonteConfig,
	type MonteRoundStart,
	type PlinkoView,
	type SlotsView,
	type SpinFairness,
	type SpinResolution,
	type SpinResult,
	type WheelView,
} from "../../features/gambling";
import { FortuneWheelModal } from "./FortuneWheelModal";
import { KoiDiceModal } from "./KoiDiceModal";
import { ShellDropModal } from "./ShellDropModal";
import { ShellFlipModal } from "./ShellFlipModal";
import { ShrineSlotsModal } from "./ShrineSlotsModal";
import { ThreeShellMonteModal } from "./ThreeShellMonteModal";

vi.mock("../../features/hub/api", () => ({
	api: {
		getCsrfToken: vi.fn(),
	},
}));

vi.mock("../../features/gambling", async () => {
	const actual =
		await vi.importActual<typeof import("../../features/gambling")>(
			"../../features/gambling",
		);
	return {
		...actual,
		gamblingApi: {
			getWheel: vi.fn(),
			spinWheel: vi.fn(),
			spinFreeWheel: vi.fn(),
			getDice: vi.fn(),
			dice: vi.fn(),
			getFlip: vi.fn(),
			flip: vi.fn(),
			getMonte: vi.fn(),
			startMonteRound: vi.fn(),
			getMonteSteps: vi.fn(),
			resolveMonteRound: vi.fn(),
			getSlots: vi.fn(),
			spinSlots: vi.fn(),
			getPlinko: vi.fn(),
			dropPlinko: vi.fn(),
		},
	};
});

function fairness(rolls: number[] = [0.42]): SpinFairness {
	return {
		serverSeed: "server-seed",
		serverSeedHash: "hash",
		clientSeed: "",
		nonce: 1,
		roll: rolls[0],
		rolls,
	};
}

describe("casino modals hold the coin sync until the outcome animation reveals the result", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(api.getCsrfToken).mockResolvedValue("token");

		// Freeze every cosmetic animation mid-flight: `runBoardAnimation`
		// schedules one initial frame and never gets another, so its
		// `onComplete` (each modal's `finish()`) can never run through the
		// normal path — only the unmount fallback can flush the balance.
		vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
		vi.stubGlobal("cancelAnimationFrame", vi.fn());

		// jsdom implements neither a real canvas 2D context nor real layout
		// boxes. Stub both so Shell Drop / Slots take their real
		// (canvas-driven) animation path instead of silently short-circuiting.
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			{
				clearRect: vi.fn(),
				fillRect: vi.fn(),
				beginPath: vi.fn(),
				arc: vi.fn(),
				fill: vi.fn(),
				stroke: vi.fn(),
				fillText: vi.fn(),
				drawImage: vi.fn(),
				save: vi.fn(),
				restore: vi.fn(),
				translate: vi.fn(),
				scale: vi.fn(),
				setTransform: vi.fn(),
			} as unknown as CanvasRenderingContext2D,
		);
		vi.spyOn(
			HTMLElement.prototype,
			"getBoundingClientRect",
		).mockReturnValue({
			width: 300,
			height: 150,
			top: 0,
			left: 0,
			right: 300,
			bottom: 150,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		});

		// jsdom's `Image` never fires load/error for a `src` it can't actually
		// fetch, which would otherwise hang ShrineSlotsModal's symbol preload
		// forever. Resolve immediately, as a real browser would for a cached
		// asset.
		class FakeImage {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			naturalWidth = 10;
			naturalHeight = 10;
			complete = true;
			set src(_value: string) {
				queueMicrotask(() => this.onload?.());
			}
		}
		vi.stubGlobal("Image", FakeImage);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("FortuneWheelModal: does not sync coins until the spin animation reveals the result", async () => {
		const segment = { id: "x2", label: "2x", multiplier: 2, weight: 1 };
		const wheel: WheelView = {
			segments: [{ ...segment, probability: 1 }],
			rtp: 1,
			freeStake: 10,
			minWager: 10,
			maxWager: 100,
			coins: 500,
			freeSpinAvailable: false,
		};
		vi.mocked(gamblingApi.getWheel).mockResolvedValue(wheel);
		const spin: SpinResult = {
			game: "wheel",
			mode: "wagered",
			outcomeId: "x2",
			multiplier: 2,
			stake: 10,
			paid: 10,
			payout: 20,
			net: 10,
			coins: 510,
			fairness: fairness(),
			segment,
		};
		vi.mocked(gamblingApi.spinWheel).mockResolvedValue(spin);

		const onCoinsChange = vi.fn();
		const { unmount } = render(
			<FortuneWheelModal coins={500} onCoinsChange={onCoinsChange} />,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Spin" }));

		// The server has settled the wager, but the wheel hasn't landed yet
		// (requestAnimationFrame is frozen) — the balance must not move.
		await waitFor(() => expect(gamblingApi.spinWheel).toHaveBeenCalled());
		expect(onCoinsChange).not.toHaveBeenCalled();

		// Closing the modal mid-spin must still flush the true balance.
		unmount();
		expect(onCoinsChange).toHaveBeenCalledWith(510);
	});

	it("KoiDiceModal: does not sync coins until the odometer animation reveals the result", async () => {
		const config: DiceConfig = {
			range: 100,
			minTargetUnder: 1,
			maxTargetUnder: 98,
			minTargetOver: 1,
			maxTargetOver: 98,
			minWager: 10,
			maxWager: 1000,
			coins: 500,
		};
		vi.mocked(gamblingApi.getDice).mockResolvedValue(config);
		const outcome: SpinResolution = {
			game: "dice",
			mode: "wagered",
			outcomeId: "roll-12",
			multiplier: 2,
			stake: 10,
			paid: 10,
			payout: 20,
			net: 10,
			coins: 510,
			fairness: fairness(),
		};
		vi.mocked(gamblingApi.dice).mockResolvedValue(outcome);

		const onCoinsChange = vi.fn();
		const { unmount } = render(
			<KoiDiceModal coins={500} onCoinsChange={onCoinsChange} />,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Roll" }));

		await waitFor(() => expect(gamblingApi.dice).toHaveBeenCalled());
		expect(onCoinsChange).not.toHaveBeenCalled();

		unmount();
		expect(onCoinsChange).toHaveBeenCalledWith(510);
	});

	it("ShellFlipModal: does not sync coins until the flip animation reveals the result", async () => {
		const config: FlipConfig = {
			multiplier: 2,
			rtp: 1,
			minWager: 10,
			maxWager: 1000,
			coins: 500,
		};
		vi.mocked(gamblingApi.getFlip).mockResolvedValue(config);
		const outcome: SpinResolution = {
			game: "flip",
			mode: "wagered",
			outcomeId: "heads",
			multiplier: 2,
			stake: 10,
			paid: 10,
			payout: 20,
			net: 10,
			coins: 510,
			fairness: fairness(),
		};
		vi.mocked(gamblingApi.flip).mockResolvedValue(outcome);

		const onCoinsChange = vi.fn();
		const { unmount } = render(
			<ShellFlipModal coins={500} onCoinsChange={onCoinsChange} />,
		);

		fireEvent.click(await screen.findByRole("button", { name: /Flip for/ }));

		await waitFor(() => expect(gamblingApi.flip).toHaveBeenCalled());
		expect(onCoinsChange).not.toHaveBeenCalled();

		unmount();
		expect(onCoinsChange).toHaveBeenCalledWith(510);
	});

	it("ShrineSlotsModal: does not sync coins until the reel animation reveals the result", async () => {
		const symbols = [
			{ id: "shell", label: "Shell", weight: 1, probability: 1, payout: 5 },
		];
		const view: SlotsView = {
			symbols,
			reelCount: 3,
			rtp: 1,
			minWager: 10,
			maxWager: 1000,
			coins: 500,
		};
		vi.mocked(gamblingApi.getSlots).mockResolvedValue(view);
		const outcome: SpinResolution = {
			game: "slots",
			mode: "wagered",
			outcomeId: "shell|shell|shell",
			multiplier: 5,
			stake: 10,
			paid: 10,
			payout: 50,
			net: 40,
			coins: 540,
			fairness: fairness([0.1, 0.1, 0.1]),
		};
		vi.mocked(gamblingApi.spinSlots).mockResolvedValue(outcome);

		const onCoinsChange = vi.fn();
		const { unmount } = render(
			<ShrineSlotsModal coins={500} onCoinsChange={onCoinsChange} />,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Spin" }));

		await waitFor(() => expect(gamblingApi.spinSlots).toHaveBeenCalled());
		expect(onCoinsChange).not.toHaveBeenCalled();

		unmount();
		expect(onCoinsChange).toHaveBeenCalledWith(540);
	});

	it("ShellDropModal: does not sync coins until the board animation reveals the result", async () => {
		const view: PlinkoView = {
			rowOptions: [8, 12],
			defaultRows: 8,
			tiers: [
				{
					rows: 8,
					buckets: Array.from({ length: 9 }, (_, index) => ({
						index,
						multiplier: index === 4 ? 0.5 : 1.2,
						probability: 1 / 9,
					})),
					rtp: 1,
				},
			],
			minWager: 10,
			maxWager: 1000,
			coins: 500,
		};
		vi.mocked(gamblingApi.getPlinko).mockResolvedValue(view);
		const outcome: SpinResolution = {
			game: "drop",
			mode: "wagered",
			outcomeId: "bucket-4",
			multiplier: 0.5,
			stake: 10,
			paid: 10,
			payout: 5,
			net: -5,
			coins: 495,
			fairness: fairness(new Array(8).fill(0.5)),
		};
		vi.mocked(gamblingApi.dropPlinko).mockResolvedValue(outcome);

		const onCoinsChange = vi.fn();
		const { unmount } = render(
			<ShellDropModal coins={500} onCoinsChange={onCoinsChange} />,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Drop" }));

		await waitFor(() => expect(gamblingApi.dropPlinko).toHaveBeenCalled());
		expect(onCoinsChange).not.toHaveBeenCalled();

		unmount();
		expect(onCoinsChange).toHaveBeenCalledWith(495);
	});

	it("ThreeShellMonteModal: still syncs the stake deduction immediately on start (no outcome to spoil yet)", async () => {
		// Unlike the other five games, starting a Monte round only takes the
		// stake — it doesn't reveal a win/loss outcome, so there's nothing to
		// spoil by syncing immediately here. The actual result (`resolveRound`)
		// already syncs coins in the same tick as revealing the pearl, which is
		// the behaviour the other games were fixed to match.
		const config: MonteConfig = {
			shellOptions: [3],
			defaultShells: 3,
			rtp: 1,
			minWager: 10,
			maxWager: 1000,
			coins: 500,
		};
		vi.mocked(gamblingApi.getMonte).mockResolvedValue(config);
		const started: MonteRoundStart = {
			roundId: "round-1",
			cupIds: ["cup-a", "cup-b", "cup-c"],
			ballStartSlot: 1,
			stepCount: 8,
			stepDurations: [],
			shuffleLeadMs: 1650,
			totalShuffleMs: 0,
			serverSeedHash: "hash",
			commitHash: "commit",
			clientSeed: "",
			nonce: 1,
			stake: 10,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			coins: 490,
		};
		vi.mocked(gamblingApi.startMonteRound).mockResolvedValue(started);
		vi.mocked(gamblingApi.getMonteSteps).mockResolvedValue({
			roundId: "round-1",
			steps: [],
			stepCount: 8,
			ready: false,
		});

		const onCoinsChange = vi.fn();
		render(<ThreeShellMonteModal coins={500} onCoinsChange={onCoinsChange} />);

		fireEvent.click(
			await screen.findByRole("button", { name: /Start game/ }),
		);

		await waitFor(() => expect(onCoinsChange).toHaveBeenCalledWith(490));
	});
});
