/**
 * Global test setup — runs once before each test file.
 *
 * - Extends `expect` with jest-dom matchers (toBeInTheDocument, etc.)
 * - Unmounts React trees after every test to prevent cross-test leakage.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

if (typeof HTMLCanvasElement !== "undefined") {
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
		fillStyle: "",
		fillRect: vi.fn(),
		getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
		putImageData: vi.fn(),
	} as unknown as CanvasRenderingContext2D);
}

afterEach(() => {
	cleanup();
});
