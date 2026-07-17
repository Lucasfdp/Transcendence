/**
 * Regression coverage for Bug Audit finding 2.2: `Math.floor` payouts can
 * settle a "win" at exactly the stake back (net 0) — e.g. betting "under 99"
 * pays 100/99 ≈ 1.0101×, so every stake from 10 to 98 floors back to the
 * stake itself. The result line must read this as a neutral push, not a
 * loss.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../features/hub/api";
import {
	gamblingApi,
	type DiceConfig,
	type SpinFairness,
	type SpinResolution,
} from "../../features/gambling";
import { KoiDiceModal } from "./KoiDiceModal";

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
			getDice: vi.fn(),
			dice: vi.fn(),
		},
	};
});

function fairness(): SpinFairness {
	return {
		serverSeed: "server-seed",
		serverSeedHash: "hash",
		clientSeed: "",
		nonce: 1,
		roll: 0.5,
		rolls: [0.5],
	};
}

function config(): DiceConfig {
	return {
		range: 100,
		minTargetUnder: 1,
		maxTargetUnder: 98,
		minTargetOver: 1,
		maxTargetOver: 98,
		minWager: 10,
		maxWager: 1000,
		coins: 500,
	};
}

describe("KoiDiceModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(api.getCsrfToken).mockResolvedValue("token");
		// Reduced motion isn't required for Koi Dice's odometer effect to
		// settle synchronously (it only needs `strip`/`marker` refs, which are
		// always mounted), but forcing it keeps this test focused on the
		// result copy rather than animation timing.
		vi.stubGlobal(
			"matchMedia",
			vi.fn().mockReturnValue({
				matches: true,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("should show a neutral push, not a loss, when a roll settles at net 0", async () => {
		vi.mocked(gamblingApi.getDice).mockResolvedValue(config());
		const outcome: SpinResolution = {
			game: "dice",
			mode: "wagered",
			outcomeId: "roll-12",
			multiplier: 1.0101,
			stake: 50,
			paid: 50,
			payout: 50,
			net: 0,
			coins: 500,
			fairness: fairness(),
		};
		vi.mocked(gamblingApi.dice).mockResolvedValue(outcome);

		render(<KoiDiceModal coins={500} onCoinsChange={() => undefined} />);
		fireEvent.click(await screen.findByRole("button", { name: "Roll" }));

		const result = await screen.findByText(/Push — stake returned/);
		expect(result).toBeInTheDocument();
		expect(result.className).toContain("is-push");
		expect(result.className).not.toContain("is-loss");
	});

	it("should still show a loss for a genuine net-negative roll", async () => {
		vi.mocked(gamblingApi.getDice).mockResolvedValue(config());
		const outcome: SpinResolution = {
			game: "dice",
			mode: "wagered",
			outcomeId: "roll-87",
			multiplier: 0,
			stake: 50,
			paid: 50,
			payout: 0,
			net: -50,
			coins: 450,
			fairness: fairness(),
		};
		vi.mocked(gamblingApi.dice).mockResolvedValue(outcome);

		render(<KoiDiceModal coins={500} onCoinsChange={() => undefined} />);
		fireEvent.click(await screen.findByRole("button", { name: "Roll" }));

		const result = await screen.findByText(/-50 ⬡/);
		expect(result.className).toContain("is-loss");
		expect(result.className).not.toContain("is-push");
	});
});
