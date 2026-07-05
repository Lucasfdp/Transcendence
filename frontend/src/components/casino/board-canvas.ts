/**
 * Generic canvas + timing helpers for casino animations (Shell Drop's peg
 * board today). Two independent pieces live here:
 *
 * - `setupCanvas` — DPR-aware canvas sizing. Only relevant if a game actually
 *   draws on a `<canvas>`.
 * - `lerp`/`ease*`/`BoardStep`/`runBoardAnimation` — a generic requestAnimationFrame
 *   scheduler and easing curves with zero canvas dependency. These are just as
 *   useful for driving a plain DOM/SVG transform frame-by-frame (e.g. a wheel's
 *   `rotate(...)deg` or a coin's `rotateY(...)deg`) as they are for drawing
 *   pixels — reach for them any time an animation needs to land deterministically
 *   on an already-known target with real easing, canvas or not.
 *
 * Deliberately free of any per-game domain logic: peg layout, bucket maths,
 * shuffle choreography, etc. belong in each game's own pure-logic file (e.g.
 * `drop-path.ts`, `shuffle.ts`), not here.
 */

/** Linear interpolation between `a` and `b` at `t` in [0, 1]. */
export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** Clamp `t` into [0, 1] — guards against overshoot from timing rounding. */
export function clamp01(t: number): number {
	if (t < 0) return 0;
	if (t > 1) return 1;
	return t;
}

/** Accelerating ease-in — reads as gravity pulling something into a fall. */
export function easeInQuad(t: number): number {
	const c = clamp01(t);
	return c * c;
}

/** Decelerating ease-out — reads as motion settling to a stop. */
export function easeOutQuad(t: number): number {
	const c = clamp01(t);
	return 1 - (1 - c) * (1 - c);
}

/**
 * Decelerating ease-out, stronger than {@link easeOutQuad} — a smoother,
 * more "weighted" stop, good for reels/wheels/dials coasting to a landing.
 */
export function easeOutCubic(t: number): number {
	const c = clamp01(t);
	return 1 - (1 - c) ** 3;
}

/** Accelerate then decelerate — a smooth start and a smooth stop, no bounce. */
export function easeInOutCubic(t: number): number {
	const c = clamp01(t);
	return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/**
 * Overshoots past 1 then settles back to exactly 1 — good for a wheel or
 * dial that spins slightly past its landing point and rocks back into
 * place, or anything else that should visibly "settle" rather than just
 * stop. `overshoot` controls how far past 1 the curve swings (1.70158 is
 * the conventional default for this curve shape).
 */
export function easeOutBack(t: number, overshoot: number = 1.70158): number {
	const c = clamp01(t);
	const c1 = overshoot;
	const c3 = c1 + 1;
	return 1 + c3 * (c - 1) ** 3 + c1 * (c - 1) ** 2;
}

/**
 * Classic "bounce" ease-out: overshoots and settles like something landing
 * and rebounding a couple of times before coming to rest. Used for the
 * peg-impact and bucket-landing moments.
 */
export function easeOutBounce(t: number): number {
	const c = clamp01(t);
	const n1 = 7.5625;
	const d1 = 2.75;
	if (c < 1 / d1) return n1 * c * c;
	if (c < 2 / d1) {
		const x = c - 1.5 / d1;
		return n1 * x * x + 0.75;
	}
	if (c < 2.5 / d1) {
		const x = c - 2.25 / d1;
		return n1 * x * x + 0.9375;
	}
	const x = c - 2.625 / d1;
	return n1 * x * x + 0.984375;
}

/**
 * Sizes a canvas's backing store for the device pixel ratio so drawing stays
 * crisp on HiDPI displays, while keeping its CSS (layout) size unchanged.
 * Returns a 2D context already scaled so callers can keep drawing in CSS
 * pixel coordinates.
 */
export function setupCanvas(
	canvas: HTMLCanvasElement,
	cssWidth: number,
	cssHeight: number,
): CanvasRenderingContext2D {
	const dpr = globalThis.devicePixelRatio || 1;
	canvas.width = Math.max(1, Math.round(cssWidth * dpr));
	canvas.height = Math.max(1, Math.round(cssHeight * dpr));
	canvas.style.width = `${cssWidth}px`;
	canvas.style.height = `${cssHeight}px`;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Canvas 2D context unavailable.");
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	return ctx;
}

/** One timed segment of a board animation (e.g. one peg row's fall). */
export interface BoardStep<T> {
	/** Arbitrary per-step payload the caller uses to interpolate a draw. */
	data: T;
	/** How long this step takes, in milliseconds. */
	durationMs: number;
}

/**
 * Drives a sequence of timed steps via `requestAnimationFrame`. On every
 * frame, `onFrame` is called with the current step's data and the *linear*
 * progress (0..1) through that step — callers apply their own easing (e.g.
 * `easeInQuad` for the fall, `easeOutBounce` for the impact) since different
 * axes of the same step often want different curves. `onComplete` fires once
 * after the last step finishes. Returns a cancel function so callers can stop
 * the animation early (e.g. on unmount).
 */
export function runBoardAnimation<T>(
	steps: readonly BoardStep<T>[],
	onFrame: (data: T, progress: number, stepIndex: number) => void,
	onComplete: () => void,
): () => void {
	let cancelled = false;
	let frameHandle = 0;
	let stepIndex = 0;
	let stepStart = 0;

	const step = (now: number): void => {
		if (cancelled) return;
		if (steps.length === 0) {
			onComplete();
			return;
		}
		if (stepStart === 0) stepStart = now;
		const current = steps[stepIndex];
		const elapsed = now - stepStart;
		const progress = current.durationMs <= 0 ? 1 : clamp01(elapsed / current.durationMs);
		onFrame(current.data, progress, stepIndex);

		if (progress >= 1) {
			stepIndex += 1;
			stepStart = now;
			if (stepIndex >= steps.length) {
				onComplete();
				return;
			}
		}
		frameHandle = globalThis.requestAnimationFrame(step);
	};

	frameHandle = globalThis.requestAnimationFrame(step);

	return () => {
		cancelled = true;
		globalThis.cancelAnimationFrame(frameHandle);
	};
}
