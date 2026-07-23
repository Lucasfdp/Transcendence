/**
 * Regression coverage for the imperative wheel rotation (performance plan,
 * Phase 7): while the spin animation runs, the rotation must be written
 * straight to the SVG face element — never through React state — and only
 * the settled angle is committed once the spin finishes. Frames are driven
 * manually through a captured `requestAnimationFrame` callback queue.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../features/hub/api";
import {
	gamblingApi,
	type SpinResult,
	type WheelView,
} from "../../features/gambling";
import { FortuneWheelModal } from "./FortuneWheelModal";

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
		},
	};
});

describe("FortuneWheelModal imperative rotation", () => {
	let frameQueue: FrameRequestCallback[];

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(api.getCsrfToken).mockResolvedValue("token");
		frameQueue = [];
		let handle = 1;
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn((callback: FrameRequestCallback) => {
				frameQueue.push(callback);
				return handle++;
			}),
		);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("rotates the face element per frame and commits state only on landing", async () => {
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
			fairness: {
				serverSeed: "server-seed",
				serverSeedHash: "hash",
				clientSeed: "",
				nonce: 1,
				roll: 0.42,
				rolls: [0.42],
			},
			segment,
		};
		vi.mocked(gamblingApi.spinWheel).mockResolvedValue(spin);

		const { container } = render(
			<FortuneWheelModal coins={500} onCoinsChange={vi.fn()} />,
		);
		fireEvent.click(await screen.findByRole("button", { name: "Spin" }));
		await waitFor(() => expect(gamblingApi.spinWheel).toHaveBeenCalled());
		await waitFor(() => expect(frameQueue.length).toBeGreaterThan(0));

		const face = container.querySelector(
			".hub-wheel__face",
		) as SVGGElement | null;
		expect(face).not.toBeNull();
		if (!face) return;
		expect(face.style.transform).toBe("rotate(0deg)");

		// First frame anchors the animation clock; the second is mid-spin.
		await act(async () => {
			frameQueue.shift()?.(1000);
		});
		await act(async () => {
			frameQueue.shift()?.(3000);
		});
		const midSpinTransform = face.style.transform;
		expect(midSpinTransform).not.toBe("rotate(0deg)");
		// The result must not be revealed while the wheel is still turning.
		expect(screen.queryByRole("status")).toBeNull();

		// Advancing past the full duration lands the wheel: the settled angle
		// is committed to React and the result appears.
		await act(async () => {
			frameQueue.shift()?.(1000 + 5000);
		});
		expect(await screen.findByRole("status")).toBeInTheDocument();
		expect(face.style.transform).toMatch(/^rotate\([\d.]+deg\)$/);
		expect(face.style.transform).not.toBe("rotate(0deg)");
	});
});
