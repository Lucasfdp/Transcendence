/**
 * Bounded canvas star field for the hub cycle backdrop.
 *
 * Replaces the previous 420 individually animated DOM stars (each with an
 * infinite CSS animation, a blurred box-shadow, and `will-change`) with one
 * canvas layer. Glow is baked into a handful of tiny prerendered sprites at
 * start-up, so a frame is only `drawImage` calls — no per-star gradients,
 * shadows, or compositor layers.
 *
 * Pure logic (quality resolution, star generation, twinkle maths) is kept
 * separate from drawing so it can be unit-tested without a canvas.
 */

/** How much work the backdrop is allowed to do on this device. */
export interface BackdropQuality {
	/** Number of stars to generate — bounded, viewport- and renderer-scaled. */
	starCount: number;
	/** Whether star sprites get a baked glow halo (off on software rendering). */
	glow: boolean;
	/** Whether stars twinkle over time (off under reduced motion). */
	twinkle: boolean;
	/** Whether the cloud layer drifts (off under reduced motion). */
	animateClouds: boolean;
	/** Backing-store pixel ratio cap for the star canvas. */
	maxPixelRatio: number;
}

export interface BackdropQualityInputs {
	viewportWidth: number;
	viewportHeight: number;
	devicePixelRatio: number;
	/** True when the browser reports a software (llvmpipe/SwiftShader…) renderer. */
	softwareRenderer: boolean;
	reducedMotion: boolean;
}

/** Hard ceiling on stars for the most capable configuration. */
export const MAX_STAR_COUNT = 160;
/** Ceiling when the renderer is software — every pixel is CPU work there. */
export const MAX_STAR_COUNT_SOFTWARE = 80;
/** Floor so small viewports still read as a starry sky. */
export const MIN_STAR_COUNT = 36;
/** One star per this many CSS pixels of viewport area. */
const STAR_AREA_DIVISOR = 11000;

/**
 * Resolves the bounded visual budget for the backdrop from viewport size,
 * pixel ratio, renderer capability, and the reduced-motion preference.
 */
export function resolveBackdropQuality(
	inputs: BackdropQualityInputs,
): BackdropQuality {
	const area =
		Math.max(0, inputs.viewportWidth) * Math.max(0, inputs.viewportHeight);
	const cap = inputs.softwareRenderer
		? MAX_STAR_COUNT_SOFTWARE
		: MAX_STAR_COUNT;
	const starCount = Math.round(
		Math.min(cap, Math.max(MIN_STAR_COUNT, area / STAR_AREA_DIVISOR)),
	);
	return {
		starCount,
		glow: !inputs.softwareRenderer,
		twinkle: !inputs.reducedMotion,
		animateClouds: !inputs.reducedMotion,
		maxPixelRatio: inputs.softwareRenderer
			? 1
			: Math.min(1.5, Math.max(1, inputs.devicePixelRatio)),
	};
}

let cachedSoftwareRenderer: boolean | null = null;

/**
 * Best-effort probe for a software WebGL renderer (llvmpipe, SwiftShader,
 * softpipe, SWGL). Runs at most once per session; any failure — including a
 * missing WebGL context — reports `false` so hardware paths stay the default.
 */
export function detectSoftwareRenderer(): boolean {
	if (cachedSoftwareRenderer !== null) return cachedSoftwareRenderer;
	let result = false;
	try {
		const canvas = document.createElement("canvas");
		const gl =
			canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
		if (
			gl &&
			typeof (gl as WebGLRenderingContext).getExtension === "function"
		) {
			const context = gl as WebGLRenderingContext;
			const info = context.getExtension("WEBGL_debug_renderer_info");
			const renderer = info
				? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL))
				: "";
			result = /llvmpipe|swiftshader|softpipe|software|swgl/i.test(renderer);
			context.getExtension("WEBGL_lose_context")?.loseContext();
		}
	} catch {
		result = false;
	}
	cachedSoftwareRenderer = result;
	return result;
}

/** Test hook: clears the cached renderer probe result. */
export function resetSoftwareRendererCache(): void {
	cachedSoftwareRenderer = null;
}

/** Colour tiers mirror the previous DOM implementation's star palette. */
export const STAR_COLORS = [
	"rgba(255, 255, 255, 0.98)",
	"rgba(241, 247, 255, 0.96)",
	"rgba(226, 239, 255, 0.94)",
	"rgba(210, 232, 255, 0.92)",
	"rgba(194, 223, 255, 0.9)",
] as const;

export interface Star {
	/** Horizontal position as a fraction of the layer width, [0, 1). */
	x: number;
	/** Vertical position as a fraction of the layer height, [0.02, 0.66). */
	y: number;
	/** Visual radius in CSS pixels. */
	radius: number;
	/** Index into {@link STAR_COLORS}. */
	colorIndex: number;
	/** Base opacity, [0, 1]. */
	opacity: number;
	/** Twinkle period in milliseconds. */
	twinklePeriodMs: number;
	/** Twinkle phase offset in radians. */
	twinklePhase: number;
}

/**
 * Generates `count` stars with the same tiered size/opacity distribution the
 * DOM implementation used. `random` is injectable for deterministic tests.
 */
export function createStars(
	count: number,
	random: () => number = Math.random,
): Star[] {
	return Array.from({ length: count }, (_, index) => {
		const tier = random();
		const radius =
			tier < 0.76
				? (random() * 1.4 + 0.9) / 2
				: tier < 0.96
					? (random() * 1.1 + 1.15) / 2
					: (random() * 1.6 + 2.2) / 2;
		const opacity =
			tier < 0.76
				? random() * 0.28 + 0.28
				: tier < 0.96
					? random() * 0.26 + 0.52
					: random() * 0.18 + 0.74;
		return {
			x: random(),
			y: (random() * 64 + 2) / 100,
			radius,
			colorIndex: index % STAR_COLORS.length,
			opacity,
			twinklePeriodMs: (random() * 4.5 + 3.5) * 1000,
			twinklePhase: random() * Math.PI * 2,
		};
	});
}

/**
 * Twinkle factor for a star at `timeMs`: oscillates opacity between 72% and
 * 124% of the base value, mirroring the old CSS keyframes' range. Pure.
 */
export function twinkleFactor(star: Star, timeMs: number): number {
	const angle =
		(timeMs / star.twinklePeriodMs) * Math.PI * 2 + star.twinklePhase;
	// Map sin's [-1, 1] onto [0.72, 1.24].
	return 0.98 + Math.sin(angle) * 0.26;
}

/** Sprite pixels drawn per unit of star radius (leaves room for the halo). */
const SPRITE_RADIUS_SCALE = 6;
/** Base sprite radius in device pixels; scaled per star at draw time. */
const SPRITE_BASE_RADIUS = 4;

/**
 * Prerenders one glowing sprite per palette colour. The gradient halo is paid
 * once here instead of per star per frame.
 */
export function createStarSprites(glow: boolean): HTMLCanvasElement[] {
	return STAR_COLORS.map((color) => {
		const size = SPRITE_BASE_RADIUS * SPRITE_RADIUS_SCALE;
		const sprite = document.createElement("canvas");
		sprite.width = size;
		sprite.height = size;
		const ctx = sprite.getContext("2d");
		if (!ctx) return sprite;
		const center = size / 2;
		if (glow) {
			const halo = ctx.createRadialGradient(
				center,
				center,
				SPRITE_BASE_RADIUS * 0.4,
				center,
				center,
				center,
			);
			halo.addColorStop(0, color);
			halo.addColorStop(0.35, color.replace(/[\d.]+\)$/, "0.28)"));
			halo.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
			ctx.fillStyle = halo;
			ctx.fillRect(0, 0, size, size);
		}
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(center, center, SPRITE_BASE_RADIUS, 0, Math.PI * 2);
		ctx.fill();
		return sprite;
	});
}

/**
 * Draws the whole star field for one instant. `timeMs` drives the twinkle;
 * pass a constant when twinkling is disabled for a static field.
 */
export function drawStarField(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	stars: readonly Star[],
	sprites: readonly HTMLCanvasElement[],
	timeMs: number,
	twinkle: boolean,
): void {
	ctx.clearRect(0, 0, width, height);
	for (const star of stars) {
		const sprite = sprites[star.colorIndex];
		if (!sprite) continue;
		const factor = twinkle ? twinkleFactor(star, timeMs) : 1;
		const drawRadius =
			star.radius * (SPRITE_RADIUS_SCALE / 2) * (0.9 + factor * 0.1);
		ctx.globalAlpha = Math.min(1, star.opacity * factor);
		ctx.drawImage(
			sprite,
			star.x * width - drawRadius,
			star.y * height - drawRadius,
			drawRadius * 2,
			drawRadius * 2,
		);
	}
	ctx.globalAlpha = 1;
}
