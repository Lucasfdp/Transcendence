/**
 * Behavioural coverage for the extracted backdrop runtime: one canvas
 * replaces the per-star DOM, the twinkle loop only runs while stars are
 * visible and the backdrop is uncovered, and suspension pauses everything.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CycleBackdrop } from "./CycleBackdrop";
import { resetSoftwareRendererCache } from "./starField";

/** Quality override shared by the tests: tiny field, no glow, twinkling. */
const TEST_QUALITY = { starCount: 8, glow: false, maxPixelRatio: 1 };

const MIDNIGHT = 0;
const NOON = 12 * 60;

describe("CycleBackdrop", () => {
	let rafSpy: ReturnType<typeof vi.fn>;
	let cancelSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		resetSoftwareRendererCache();
		let nextHandle = 1;
		rafSpy = vi.fn(() => nextHandle++);
		cancelSpy = vi.fn();
		vi.stubGlobal("requestAnimationFrame", rafSpy);
		vi.stubGlobal("cancelAnimationFrame", cancelSpy);

		// jsdom has no real canvas nor layout: give the star layer a working
		// 2D-ish context and a non-empty host box.
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			setTransform: vi.fn(),
			clearRect: vi.fn(),
			drawImage: vi.fn(),
			createRadialGradient: () => ({ addColorStop: vi.fn() }),
			fillRect: vi.fn(),
			beginPath: vi.fn(),
			arc: vi.fn(),
			fill: vi.fn(),
			fillStyle: "",
			globalAlpha: 1,
		} as unknown as CanvasRenderingContext2D);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
			width: 800,
			height: 600,
			top: 0,
			left: 0,
			right: 800,
			bottom: 600,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("renders one star canvas and zero per-star DOM elements", () => {
		const { container } = render(
			<CycleBackdrop
				theme="night"
				manualMinutes={MIDNIGHT}
				quality={TEST_QUALITY}
			/>,
		);
		expect(container.querySelectorAll("canvas")).toHaveLength(1);
		expect(container.querySelectorAll(".hub-cycle__star")).toHaveLength(0);
		// Static layers keep the shared hub.css classes so art and theme
		// overrides stay identical.
		expect(container.querySelector(".hub-cycle--night")).not.toBeNull();
		expect(container.querySelector(".hub-cycle__foreground")).not.toBeNull();
		expect(
			container.querySelector(".cycle-backdrop__clouds-strip"),
		).not.toBeNull();
	});

	it("drives the cycle CSS custom properties on the host", () => {
		const { container } = render(
			<CycleBackdrop
				theme="night"
				manualMinutes={MIDNIGHT}
				quality={TEST_QUALITY}
			/>,
		);
		const host = container.querySelector(".hub-cycle") as HTMLElement;
		expect(host.style.getPropertyValue("--cycle-moon-opacity")).toBe("1");
		expect(host.style.getPropertyValue("--cycle-stars-opacity")).toBe(
			"1.000",
		);
	});

	it("runs the twinkle loop at night", () => {
		render(
			<CycleBackdrop
				theme="night"
				manualMinutes={MIDNIGHT}
				quality={TEST_QUALITY}
			/>,
		);
		expect(rafSpy).toHaveBeenCalled();
	});

	it("does not run the twinkle loop while stars are invisible (day)", () => {
		render(
			<CycleBackdrop
				theme="night"
				manualMinutes={NOON}
				quality={TEST_QUALITY}
			/>,
		);
		expect(rafSpy).not.toHaveBeenCalled();
	});

	it("suspends the loop while covered and resumes when uncovered", () => {
		const { container, rerender } = render(
			<CycleBackdrop
				theme="night"
				manualMinutes={MIDNIGHT}
				covered
				quality={TEST_QUALITY}
			/>,
		);
		expect(rafSpy).not.toHaveBeenCalled();
		expect(
			container.querySelector(".cycle-backdrop--suspended"),
		).not.toBeNull();

		rerender(
			<CycleBackdrop
				theme="night"
				manualMinutes={MIDNIGHT}
				covered={false}
				quality={TEST_QUALITY}
			/>,
		);
		expect(rafSpy).toHaveBeenCalled();
		expect(container.querySelector(".cycle-backdrop--suspended")).toBeNull();
	});

	it("suspends when the document becomes hidden", () => {
		const { container } = render(
			<CycleBackdrop
				theme="night"
				manualMinutes={MIDNIGHT}
				quality={TEST_QUALITY}
			/>,
		);
		expect(rafSpy).toHaveBeenCalledTimes(1);

		vi.spyOn(document, "hidden", "get").mockReturnValue(true);
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(
			container.querySelector(".cycle-backdrop--suspended"),
		).not.toBeNull();
		expect(cancelSpy).toHaveBeenCalled();
	});

	it("cancels the twinkle loop on unmount", () => {
		const { unmount } = render(
			<CycleBackdrop
				theme="night"
				manualMinutes={MIDNIGHT}
				quality={TEST_QUALITY}
			/>,
		);
		expect(rafSpy).toHaveBeenCalled();
		unmount();
		expect(cancelSpy).toHaveBeenCalled();
	});
});
