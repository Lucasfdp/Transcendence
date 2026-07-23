import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createStars,
	createStarSprites,
	detectSoftwareRenderer,
	drawStarField,
	MAX_STAR_COUNT,
	MAX_STAR_COUNT_SOFTWARE,
	MIN_STAR_COUNT,
	resetSoftwareRendererCache,
	resolveBackdropQuality,
	STAR_COLORS,
	twinkleFactor,
} from "./starField";

/** Deterministic pseudo-random sequence for reproducible star generation. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

describe("resolveBackdropQuality", () => {
	const base = {
		viewportWidth: 1440,
		viewportHeight: 900,
		devicePixelRatio: 1,
		softwareRenderer: false,
		reducedMotion: false,
	};

	it("caps the star count on large hardware-rendered viewports", () => {
		const quality = resolveBackdropQuality({
			...base,
			viewportWidth: 3840,
			viewportHeight: 2160,
		});
		expect(quality.starCount).toBe(MAX_STAR_COUNT);
		expect(quality.glow).toBe(true);
		expect(quality.twinkle).toBe(true);
	});

	it("halves the budget and disables glow on software renderers", () => {
		const quality = resolveBackdropQuality({
			...base,
			viewportWidth: 3840,
			viewportHeight: 2160,
			softwareRenderer: true,
		});
		expect(quality.starCount).toBe(MAX_STAR_COUNT_SOFTWARE);
		expect(quality.glow).toBe(false);
		expect(quality.maxPixelRatio).toBe(1);
	});

	it("keeps a readable minimum on tiny viewports", () => {
		const quality = resolveBackdropQuality({
			...base,
			viewportWidth: 320,
			viewportHeight: 568,
		});
		expect(quality.starCount).toBe(MIN_STAR_COUNT);
	});

	it("disables twinkle and cloud drift under reduced motion", () => {
		const quality = resolveBackdropQuality({ ...base, reducedMotion: true });
		expect(quality.twinkle).toBe(false);
		expect(quality.animateClouds).toBe(false);
	});

	it("caps the canvas pixel ratio at 1.5 on HiDPI hardware", () => {
		const quality = resolveBackdropQuality({
			...base,
			devicePixelRatio: 3,
		});
		expect(quality.maxPixelRatio).toBe(1.5);
	});

	it("stays far below the previous 420-star DOM implementation", () => {
		expect(MAX_STAR_COUNT).toBeLessThan(420 / 2);
	});
});

describe("createStars", () => {
	it("generates the requested number of stars within bounds", () => {
		const stars = createStars(120, seededRandom(42));
		expect(stars).toHaveLength(120);
		for (const star of stars) {
			expect(star.x).toBeGreaterThanOrEqual(0);
			expect(star.x).toBeLessThan(1);
			expect(star.y).toBeGreaterThanOrEqual(0.02);
			expect(star.y).toBeLessThan(0.66);
			expect(star.radius).toBeGreaterThan(0);
			expect(star.opacity).toBeGreaterThan(0);
			expect(star.opacity).toBeLessThanOrEqual(1);
			expect(star.colorIndex).toBeLessThan(STAR_COLORS.length);
			expect(star.twinklePeriodMs).toBeGreaterThanOrEqual(3500);
			expect(star.twinklePeriodMs).toBeLessThanOrEqual(8000);
		}
	});

	it("is deterministic for a fixed random source", () => {
		expect(createStars(10, seededRandom(7))).toEqual(
			createStars(10, seededRandom(7)),
		);
	});
});

describe("twinkleFactor", () => {
	it("oscillates within the old CSS keyframes' brightness range", () => {
		const [star] = createStars(1, seededRandom(3));
		for (let t = 0; t < 20000; t += 250) {
			const factor = twinkleFactor(star, t);
			expect(factor).toBeGreaterThanOrEqual(0.72);
			expect(factor).toBeLessThanOrEqual(1.24);
		}
	});
});

describe("drawStarField", () => {
	function fakeContext(): CanvasRenderingContext2D & {
		drawImageCalls: number;
	} {
		const ctx = {
			drawImageCalls: 0,
			globalAlpha: 1,
			clearRect: vi.fn(),
			drawImage(): void {
				ctx.drawImageCalls += 1;
			},
		};
		return ctx as unknown as CanvasRenderingContext2D & {
			drawImageCalls: number;
		};
	}

	it("draws exactly one sprite per star and restores globalAlpha", () => {
		const stars = createStars(25, seededRandom(9));
		const sprites = STAR_COLORS.map(() =>
			document.createElement("canvas"),
		);
		const ctx = fakeContext();
		drawStarField(ctx, 800, 600, stars, sprites, 1234, true);
		expect(ctx.drawImageCalls).toBe(25);
		expect(ctx.globalAlpha).toBe(1);
	});
});

describe("createStarSprites", () => {
	it("creates one glowing sprite per palette colour", () => {
		// jsdom's global canvas stub lacks path/gradient methods, so give the
		// sprite prerender a recording context of its own.
		const gradients: number[] = [];
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			createRadialGradient: () => {
				gradients.push(1);
				return { addColorStop: vi.fn() };
			},
			fillRect: vi.fn(),
			beginPath: vi.fn(),
			arc: vi.fn(),
			fill: vi.fn(),
			fillStyle: "",
		} as unknown as CanvasRenderingContext2D);

		const sprites = createStarSprites(true);
		expect(sprites).toHaveLength(STAR_COLORS.length);
		// The glow gradient is paid once per sprite here, never per frame.
		expect(gradients).toHaveLength(STAR_COLORS.length);
		vi.restoreAllMocks();
	});
});

describe("detectSoftwareRenderer", () => {
	afterEach(() => {
		resetSoftwareRendererCache();
		vi.restoreAllMocks();
	});

	it("reports true for a software renderer string and caches the probe", () => {
		const getParameter = vi.fn(() => "llvmpipe (LLVM 20.1.2, 256 bits)");
		const getContext = vi
			.spyOn(HTMLCanvasElement.prototype, "getContext")
			.mockReturnValue({
				getExtension: (name: string) =>
					name === "WEBGL_debug_renderer_info"
						? { UNMASKED_RENDERER_WEBGL: 0x9246 }
						: null,
				getParameter,
			} as unknown as RenderingContext);

		expect(detectSoftwareRenderer()).toBe(true);
		expect(detectSoftwareRenderer()).toBe(true);
		expect(getContext).toHaveBeenCalledTimes(1);
	});

	it("reports false when WebGL is unavailable", () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			null,
		);
		expect(detectSoftwareRenderer()).toBe(false);
	});
});
