/**
 * Regression coverage for two Bug Audit findings scoped to Shell Drop:
 *
 * - 2.2: `Math.floor` payouts can settle a "win" at exactly the stake back
 *   (net 0). The result line must read this as a neutral push, not a loss.
 * - 2.3: switching row tiers after a drop must clear the stale result —
 *   otherwise the result line (and the idle board redraw) keep referencing a
 *   bucket index that doesn't exist in the newly selected tier's paytable.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../features/hub/api";
import {
	gamblingApi,
	type PlinkoView,
	type SpinFairness,
	type SpinResolution,
} from "../../features/gambling";
import { ShellDropModal } from "./ShellDropModal";

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
			getPlinko: vi.fn(),
			dropPlinko: vi.fn(),
		},
	};
});

function fairness(rolls: number[]): SpinFairness {
	return {
		serverSeed: "server-seed",
		serverSeedHash: "hash",
		clientSeed: "",
		nonce: 1,
		roll: rolls[0],
		rolls,
	};
}

function twoTierView(): PlinkoView {
	return {
		rowOptions: [8, 4],
		defaultRows: 8,
		tiers: [
			{
				rows: 8,
				buckets: Array.from({ length: 9 }, (_, index) => ({
					index,
					multiplier: index === 4 ? 1 : 1.4,
					probability: 1 / 9,
				})),
				rtp: 1,
			},
			{
				rows: 4,
				buckets: Array.from({ length: 5 }, (_, index) => ({
					index,
					multiplier: index === 2 ? 1 : 1.4,
					probability: 1 / 5,
				})),
				rtp: 1,
			},
		],
		minWager: 10,
		maxWager: 1000,
		coins: 500,
	};
}

describe("ShellDropModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(api.getCsrfToken).mockResolvedValue("token");

		// Force `useReducedMotion` to report true so the drop settles
		// synchronously right after the server responds, without needing to
		// drive a `requestAnimationFrame` loop in jsdom.
		vi.stubGlobal(
			"matchMedia",
			vi.fn().mockReturnValue({
				matches: true,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			}),
		);

		// The reduced-motion path still unconditionally asks the canvas for a
		// 2D context before checking the reduced-motion flag (see
		// `ShellDropModal`'s active-drop effect) — jsdom doesn't implement one.
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			{
				clearRect: vi.fn(),
				fillRect: vi.fn(),
				beginPath: vi.fn(),
				arc: vi.fn(),
				fill: vi.fn(),
				stroke: vi.fn(),
				fillText: vi.fn(),
				save: vi.fn(),
				restore: vi.fn(),
				translate: vi.fn(),
				scale: vi.fn(),
				setTransform: vi.fn(),
			} as unknown as CanvasRenderingContext2D,
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("should show a neutral push, not a loss, when a drop settles at net 0", async () => {
		vi.mocked(gamblingApi.getPlinko).mockResolvedValue(twoTierView());
		const outcome: SpinResolution = {
			game: "drop",
			mode: "wagered",
			outcomeId: "bucket-4",
			multiplier: 1,
			stake: 10,
			paid: 10,
			payout: 10,
			net: 0,
			coins: 500,
			fairness: fairness(new Array(8).fill(0.5)),
		};
		vi.mocked(gamblingApi.dropPlinko).mockResolvedValue(outcome);

		render(<ShellDropModal coins={500} onCoinsChange={() => undefined} />);
		fireEvent.click(await screen.findByRole("button", { name: "Drop" }));

		const result = await screen.findByText(/Push — stake returned/);
		expect(result).toBeInTheDocument();
		expect(result.className).toContain("is-push");
		expect(result.className).not.toContain("is-loss");
	});

	it("should clear a landed result when the player switches row tiers afterward", async () => {
		vi.mocked(gamblingApi.getPlinko).mockResolvedValue(twoTierView());
		const outcome: SpinResolution = {
			game: "drop",
			mode: "wagered",
			outcomeId: "bucket-4",
			multiplier: 1.4,
			stake: 10,
			paid: 10,
			payout: 14,
			net: 4,
			coins: 504,
			fairness: fairness(new Array(8).fill(0.5)),
		};
		vi.mocked(gamblingApi.dropPlinko).mockResolvedValue(outcome);

		render(<ShellDropModal coins={500} onCoinsChange={() => undefined} />);
		fireEvent.click(await screen.findByRole("button", { name: "Drop" }));

		await screen.findByText(/Bucket 4/);

		fireEvent.click(screen.getByRole("button", { name: "4 rows" }));

		await waitFor(() =>
			expect(screen.queryByText(/Bucket 4/)).not.toBeInTheDocument(),
		);
		expect(screen.getByText(/Balance: 500/)).toBeInTheDocument();
	});
});
