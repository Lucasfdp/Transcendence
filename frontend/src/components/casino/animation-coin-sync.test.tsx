/**
 * Regression coverage for Bug Audit finding 1.1: every casino modal must sync
 * the hub's coin balance the moment the server settles a wager, not once the
 * purely-cosmetic spin/roll/shuffle/drop animation finishes. Before the fix,
 * `onCoinsChange` lived inside each animation's `onComplete` callback, so
 * closing (unmounting) a modal — or, as simulated here, an animation that
 * simply never gets to finish — permanently desynced the hub header's
 * balance from what the server actually settled.
 *
 * Every test below freezes the cosmetic animation mid-flight by stubbing
 * `requestAnimationFrame` to never invoke its callback, so each modal's own
 * `finish()`/`onComplete` handler can never run. If `onCoinsChange` still
 * fired, it proves the sync happens immediately after the server responds,
 * independent of the animation. Canvas-backed boards (Shell Drop, Monte,
 * Slots) additionally need a real-looking `getContext`/`getBoundingClientRect`
 * since jsdom implements neither by default.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	api,
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
} from "../../features/hub/api";
import { FortuneWheelModal } from "./FortuneWheelModal";
import { KoiDiceModal } from "./KoiDiceModal";
import { ShellDropModal } from "./ShellDropModal";
import { ShellFlipModal } from "./ShellFlipModal";
import { ShrineSlotsModal } from "./ShrineSlotsModal";
import { ThreeShellMonteModal } from "./ThreeShellMonteModal";

vi.mock("../../features/hub/api", () => ({
	api: {
		getWheel: vi.fn(),
		spinWheel: vi.fn(),
		spinFreeWheel: vi.fn(),
		getDice: vi.fn(),
		dice: vi.fn(),
		getFlip: vi.fn(),
		flip: vi.fn(),
		getMonte: vi.fn(),
		startMonteRound: vi.fn(),
		resolveMonteRound: vi.fn(),
		getSlots: vi.fn(),
		spinSlots: vi.fn(),
		getPlinko: vi.fn(),
		dropPlinko: vi.fn(),
		getCsrfToken: vi.fn(),
	},
}));

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

describe("casino modals sync coins immediately, independent of the cosmetic animation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(api.getCsrfToken).mockResolvedValue("token");

		// Freeze every cosmetic animation mid-flight: `runBoardAnimation`
		// schedules one initial frame and never gets another, so its
		// `onComplete` (each modal's `finish()`) can never run.
		vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
		vi.stubGlobal("cancelAnimationFrame", vi.fn());

		// jsdom implements neither a real canvas 2D context nor real layout
		// boxes. Stub both so Shell Drop / Monte / Slots take their real
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

	it("FortuneWheelModal: calls onCoinsChange with the server balance before the spin animation completes", async () => {
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
		vi.mocked(api.getWheel).mockResolvedValue(wheel);
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
		vi.mocked(api.spinWheel).mockResolvedValue(spin);

		const onCoinsChange = vi.fn();
		render(<FortuneWheelModal coins={500} onCoinsChange={onCoinsChange} />);

		fireEvent.click(await screen.findByRole("button", { name: "Spin" }));

		await waitFor(() => expect(onCoinsChange).toHaveBeenCalledWith(510));
	});

	it("KoiDiceModal: calls onCoinsChange with the server balance before the odometer animation completes", async () => {
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
		vi.mocked(api.getDice).mockResolvedValue(config);
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
		vi.mocked(api.dice).mockResolvedValue(outcome);

		const onCoinsChange = vi.fn();
		render(<KoiDiceModal coins={500} onCoinsChange={onCoinsChange} />);

		fireEvent.click(await screen.findByRole("button", { name: "Roll" }));

		await waitFor(() => expect(onCoinsChange).toHaveBeenCalledWith(510));
	});

	it("ShellFlipModal: calls onCoinsChange with the server balance before the flip animation completes", async () => {
		const config: FlipConfig = {
			multiplier: 2,
			rtp: 1,
			minWager: 10,
			maxWager: 1000,
			coins: 500,
		};
		vi.mocked(api.getFlip).mockResolvedValue(config);
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
		vi.mocked(api.flip).mockResolvedValue(outcome);

		const onCoinsChange = vi.fn();
		render(<ShellFlipModal coins={500} onCoinsChange={onCoinsChange} />);

		fireEvent.click(await screen.findByRole("button", { name: /Flip for/ }));

		await waitFor(() => expect(onCoinsChange).toHaveBeenCalledWith(510));
	});

	it("ThreeShellMonteModal: calls onCoinsChange with the server balance before the shuffle animation completes", async () => {
		const config: MonteConfig = {
			shellOptions: [3],
			defaultShells: 3,
			rtp: 1,
			minWager: 10,
			maxWager: 1000,
			coins: 500,
		};
		vi.mocked(api.getMonte).mockResolvedValue(config);
		const started: MonteRoundStart = {
			roundId: "round-1",
			cupIds: ["cup-a", "cup-b", "cup-c"],
			ballCupId: "cup-b",
			serverSeedHash: "hash",
			winningCupHash: "cup-hash",
			clientSeed: "",
			nonce: 1,
			stake: 10,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			coins: 490,
		};
		vi.mocked(api.startMonteRound).mockResolvedValue(started);

		const onCoinsChange = vi.fn();
		render(<ThreeShellMonteModal coins={500} onCoinsChange={onCoinsChange} />);

		fireEvent.click(
			await screen.findByRole("button", { name: /Start game/ }),
		);

		await waitFor(() => expect(onCoinsChange).toHaveBeenCalledWith(490));
	});

	it("ShrineSlotsModal: calls onCoinsChange with the server balance before the reel animation completes", async () => {
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
		vi.mocked(api.getSlots).mockResolvedValue(view);
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
		vi.mocked(api.spinSlots).mockResolvedValue(outcome);

		const onCoinsChange = vi.fn();
		render(<ShrineSlotsModal coins={500} onCoinsChange={onCoinsChange} />);

		fireEvent.click(await screen.findByRole("button", { name: "Spin" }));

		await waitFor(() => expect(onCoinsChange).toHaveBeenCalledWith(540));
	});

	it("ShellDropModal: calls onCoinsChange with the server balance before the board animation completes", async () => {
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
		vi.mocked(api.getPlinko).mockResolvedValue(view);
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
		vi.mocked(api.dropPlinko).mockResolvedValue(outcome);

		const onCoinsChange = vi.fn();
		render(<ShellDropModal coins={500} onCoinsChange={onCoinsChange} />);

		fireEvent.click(await screen.findByRole("button", { name: "Drop" }));

		await waitFor(() => expect(onCoinsChange).toHaveBeenCalledWith(495));
	});
});
