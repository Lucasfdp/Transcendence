/**
 * Extracted hub day/night backdrop runtime (performance plan, Phase 5).
 *
 * Replaces the inline `CycleBackdrop` in `HomePage.tsx`. Differences from
 * that implementation, all deliberate:
 *
 * - The 420 animated DOM stars (infinite CSS animations, blurred
 *   box-shadows, `will-change` per star) are replaced by ONE canvas layer
 *   with a bounded, viewport- and renderer-scaled star budget (see
 *   `starField.ts`), drawn at a capped ~30 FPS only while stars are actually
 *   visible (night) and the backdrop is neither covered nor hidden.
 * - The cloud layer drifts via a compositor-friendly `transform` animation
 *   on a dedicated strip element instead of animating
 *   `background-position` on a full-screen layer.
 * - The whole runtime suspends — star drawing, cloud drift, and the
 *   per-second cycle tick — when the document is hidden, when the host page
 *   reports an opaque cover (`covered` prop), or when reduced motion is
 *   requested (stars render once, statically).
 *
 * Static layers (sky, sun, moon, glow, foreground) intentionally reuse the
 * existing `.hub-cycle` classes from `hub.css`, so the art, masks, and theme
 * overrides stay pixel-identical. Only the star and cloud layers use new
 * classes from `hub-backdrop.css`.
 *
 * Integration contract (deferred to the integrator per the distributed
 * plan): mount `<CycleBackdrop theme={...} manualMinutes={...} covered={...}>`
 * in place of the page's inline backdrop, passing `covered` as "an opaque
 * modal currently hides the backdrop".
 */
import { memo, useEffect, useRef, useState } from "react";
import type { CycleTheme } from "../../shared/backgrounds";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import {
	applyCycleVisuals,
	computeCycleVisuals,
	createManualTime,
	getDayProgress,
} from "./cycleEngine";
import {
	type BackdropQuality,
	createStars,
	createStarSprites,
	detectSoftwareRenderer,
	drawStarField,
	resolveBackdropQuality,
	type Star,
} from "./starField";

/** Minimum interval between twinkle frames — the field animates at ~30 FPS. */
const TWINKLE_FRAME_MS = 33;
/** Stars below this resolved opacity are invisible; the draw loop stops. */
const STARS_VISIBLE_THRESHOLD = 0.01;

export interface CycleBackdropProps {
	/** Which cycle art set to render. */
	theme: CycleTheme;
	/** Fixed debug time in minutes since midnight, or `null` for live time. */
	manualMinutes?: number | null;
	/**
	 * True while an opaque surface (modal, overlay) fully hides the backdrop.
	 * Suspends all animation and the cycle tick until uncovered.
	 */
	covered?: boolean;
	/** Optional overrides for the resolved visual budget (mainly for tests). */
	quality?: Partial<BackdropQuality>;
}

interface StarRuntime {
	quality: BackdropQuality;
	stars: Star[];
	sprites: HTMLCanvasElement[];
	ctx: CanvasRenderingContext2D | null;
	width: number;
	height: number;
}

export const CycleBackdrop = memo(function CycleBackdrop({
	theme,
	manualMinutes = null,
	covered = false,
	quality: qualityOverrides,
}: CycleBackdropProps): JSX.Element {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const reducedMotion = useReducedMotion();
	const [documentHidden, setDocumentHidden] = useState(
		() => typeof document !== "undefined" && document.hidden,
	);
	const suspended = covered || documentHidden;

	const runtimeRef = useRef<StarRuntime | null>(null);
	const starsOpacityRef = useRef(0);
	const suspendedRef = useRef(suspended);
	suspendedRef.current = suspended;
	const twinkleFrameRef = useRef(0);
	const lastTwinkleDrawRef = useRef(0);
	/**
	 * Mirrors the overrides without retriggering the set-up effect: quality
	 * overrides are a mount-time tuning input, and callers pass literals.
	 */
	const qualityOverridesRef = useRef(qualityOverrides);

	// Document visibility feeds suspension (screen-off/tab-switch case).
	useEffect(() => {
		const onVisibilityChange = (): void =>
			setDocumentHidden(document.hidden);
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () =>
			document.removeEventListener("visibilitychange", onVisibilityChange);
	}, []);

	// Star field set-up: resolve the bounded budget once per mount (and per
	// reduced-motion flip), generate the field, and keep the canvas backing
	// store sized to the layer. Resizes redraw the existing stars — their
	// fractional positions scale with the layer, matching the old DOM
	// percentage behaviour — but never regenerate or re-count them.
	useEffect(() => {
		const canvas = canvasRef.current;
		const host = hostRef.current;
		if (!canvas || !host) return;

		const quality: BackdropQuality = {
			...resolveBackdropQuality({
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				devicePixelRatio: window.devicePixelRatio || 1,
				softwareRenderer: detectSoftwareRenderer(),
				reducedMotion,
			}),
			...qualityOverridesRef.current,
		};
		const runtime: StarRuntime = {
			quality,
			stars: createStars(quality.starCount),
			sprites: createStarSprites(quality.glow),
			ctx: null,
			width: 0,
			height: 0,
		};
		runtimeRef.current = runtime;

		const drawOnce = (): void => {
			if (!runtime.ctx) return;
			drawStarField(
				runtime.ctx,
				runtime.width,
				runtime.height,
				runtime.stars,
				runtime.sprites,
				performance.now(),
				quality.twinkle,
			);
		};

		const resize = (): void => {
			const rect = host.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return;
			const ratio = Math.min(
				window.devicePixelRatio || 1,
				quality.maxPixelRatio,
			);
			canvas.width = Math.max(1, Math.round(rect.width * ratio));
			canvas.height = Math.max(1, Math.round(rect.height * ratio));
			const ctx = canvas.getContext("2d");
			if (!ctx) return;
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
			runtime.ctx = ctx;
			runtime.width = rect.width;
			runtime.height = rect.height;
			drawOnce();
		};

		resize();
		let observer: ResizeObserver | null = null;
		if (typeof ResizeObserver !== "undefined") {
			observer = new ResizeObserver(resize);
			observer.observe(host);
		} else {
			window.addEventListener("resize", resize);
		}
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", resize);
			runtimeRef.current = null;
		};
	}, [reducedMotion]);

	// Twinkle loop management. Runs only while every condition holds: the
	// runtime exists, twinkling is enabled, stars are visible (night), and
	// the backdrop is neither covered nor in a hidden document. Frame rate is
	// capped at ~30 FPS — star twinkle periods are 3.5–8 s, so more would be
	// wasted work.
	const syncTwinkleLoopRef = useRef<() => void>(() => {});
	syncTwinkleLoopRef.current = (): void => {
		const runtime = runtimeRef.current;
		const shouldRun =
			runtime !== null &&
			runtime.ctx !== null &&
			runtime.quality.twinkle &&
			!suspendedRef.current &&
			starsOpacityRef.current > STARS_VISIBLE_THRESHOLD;

		if (!shouldRun) {
			if (twinkleFrameRef.current !== 0) {
				cancelAnimationFrame(twinkleFrameRef.current);
				twinkleFrameRef.current = 0;
			}
			return;
		}
		if (twinkleFrameRef.current !== 0) return;

		const frame = (now: number): void => {
			const current = runtimeRef.current;
			if (
				!current ||
				!current.ctx ||
				!current.quality.twinkle ||
				suspendedRef.current ||
				starsOpacityRef.current <= STARS_VISIBLE_THRESHOLD
			) {
				twinkleFrameRef.current = 0;
				return;
			}
			if (now - lastTwinkleDrawRef.current >= TWINKLE_FRAME_MS) {
				lastTwinkleDrawRef.current = now;
				drawStarField(
					current.ctx,
					current.width,
					current.height,
					current.stars,
					current.sprites,
					now,
					true,
				);
			}
			twinkleFrameRef.current = requestAnimationFrame(frame);
		};
		twinkleFrameRef.current = requestAnimationFrame(frame);
	};

	// The cycle tick: applies palette/positions once per second while live,
	// once per change while a manual debug time is set, and not at all while
	// suspended (a resume applies the current instant immediately).
	useEffect(() => {
		const node = hostRef.current;
		if (!node) return;

		const apply = (date: Date): void => {
			const visuals = computeCycleVisuals(getDayProgress(date), theme);
			applyCycleVisuals(node, visuals);
			starsOpacityRef.current = visuals.starsOpacity;
			syncTwinkleLoopRef.current();
		};

		if (manualMinutes !== null) {
			apply(createManualTime(new Date(), manualMinutes));
			return;
		}
		if (suspended) {
			// Keep the rendered state current, then stay quiet until resumed.
			apply(new Date());
			return;
		}
		let timerId = 0;
		const tick = (): void => {
			const current = new Date();
			apply(current);
			timerId = window.setTimeout(tick, 1000 - current.getMilliseconds());
		};
		tick();
		return () => window.clearTimeout(timerId);
	}, [manualMinutes, theme, suspended]);

	// Suspension gate for the twinkle loop (the CSS class on the host pauses
	// the cloud drift declaratively).
	useEffect(() => {
		syncTwinkleLoopRef.current();
		return () => {
			if (twinkleFrameRef.current !== 0) {
				cancelAnimationFrame(twinkleFrameRef.current);
				twinkleFrameRef.current = 0;
			}
		};
	}, [suspended, reducedMotion]);

	return (
		<div
			className={`hub-cycle hub-cycle--${theme} cycle-backdrop${
				suspended ? " cycle-backdrop--suspended" : ""
			}`}
			ref={hostRef}
			aria-hidden="true"
		>
			<div className="hub-cycle__sky" />
			<canvas className="cycle-backdrop__stars" ref={canvasRef} />
			<div className="hub-cycle__sun" />
			<div className="hub-cycle__moon" />
			<div className="hub-cycle__glow" />
			<div className="cycle-backdrop__clouds">
				<div className="cycle-backdrop__clouds-strip" />
			</div>
			<div className="hub-cycle__foreground" />
		</div>
	);
});
