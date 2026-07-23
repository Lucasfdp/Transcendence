/**
 * Pure day/night cycle engine for the hub backdrop.
 *
 * Extracted from the inline `CycleBackdrop` in `HomePage.tsx` (performance
 * plan, Phase 5) so the maths can be unit-tested and the backdrop runtime can
 * live outside the page component. The integrator replaces the page's inline
 * copy with this module when the extracted backdrop is mounted; until then
 * both implementations must stay behaviourally identical, so any tuning here
 * must be mirrored deliberately, not silently diverged.
 *
 * No DOM access in this file beyond `applyCycleVisuals`, which only writes
 * CSS custom properties to a supplied element.
 */
import type { CycleTheme } from "../../shared/backgrounds";

export type RgbColor = { r: number; g: number; b: number };

/** Everything the backdrop layers need for one rendered instant. */
export interface CycleVisuals {
	topColor: string;
	horizonColor: string;
	sunX: number;
	sunY: number;
	moonX: number;
	moonY: number;
	sunOpacity: number;
	moonOpacity: number;
	starsOpacity: number;
	twilightOpacity: number;
	fgBrightness: number;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function lerp(start: number, end: number, amount: number): number {
	return start + (end - start) * amount;
}

function blendColor(a: RgbColor, b: RgbColor, amount: number): RgbColor {
	return {
		r: Math.round(lerp(a.r, b.r, amount)),
		g: Math.round(lerp(a.g, b.g, amount)),
		b: Math.round(lerp(a.b, b.b, amount)),
	};
}

function rgbToCss({ r, g, b }: RgbColor): string {
	return `rgb(${r}, ${g}, ${b})`;
}

/** Fraction of the civil day elapsed at `now`, in [0, 1). */
export function getDayProgress(now: Date): number {
	const seconds =
		now.getHours() * 3600 +
		now.getMinutes() * 60 +
		now.getSeconds() +
		now.getMilliseconds() / 1000;
	return seconds / 86400;
}

/** A copy of `base` with its time-of-day replaced by `totalMinutes`. */
export function createManualTime(base: Date, totalMinutes: number): Date {
	const next = new Date(base);
	next.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
	return next;
}

function getNightPhase(progress: number): number {
	return progress >= 0.75 ? (progress - 0.75) / 0.5 : (progress + 0.25) / 0.5;
}

function interpolatePalette(
	progress: number,
	stops: Array<{ at: number; color: RgbColor }>,
): string {
	for (let index = 0; index < stops.length - 1; index += 1) {
		const current = stops[index];
		const next = stops[index + 1];
		if (progress <= next.at) {
			const range = next.at - current.at || 1;
			const amount = clamp((progress - current.at) / range, 0, 1);
			return rgbToCss(blendColor(current.color, next.color, amount));
		}
	}
	return rgbToCss(stops[stops.length - 1].color);
}

type CycleArcConfig = {
	xMin: number; // % at phase 0 (rise)
	xMax: number; // % at phase 1 (set)
	sunYBase: number; // % at horizon; y = base − arc·amp
	sunYAmp: number;
	moonYBase: number;
	moonYAmp: number;
};

// Per-theme celestial arc box, so the sun/moon travel only through each
// background's actual open-sky region instead of one arc tuned for the
// night art. Hand-tuned against the static PNGs at a 16:9 desktop
// breakpoint (see docs/cycle-sun-moon-occlusion-fix-report.md §2) —
// `night` MUST keep the original constants unchanged (regression guard).
const CYCLE_ARCS: Record<CycleTheme, CycleArcConfig> = {
	night: { xMin: -12, xMax: 112, sunYBase: 72, sunYAmp: 62, moonYBase: 74, moonYAmp: 58 },
	sunset: { xMin: -6, xMax: 106, sunYBase: 44, sunYAmp: 32, moonYBase: 45, moonYAmp: 30 },
	sunrise: { xMin: 8, xMax: 92, sunYBase: 18, sunYAmp: 13, moonYBase: 19, moonYAmp: 12 },
	login: { xMin: 12, xMax: 88, sunYBase: 13, sunYAmp: 9, moonYBase: 14, moonYAmp: 8 },
};

const TOP_PALETTE: Array<{ at: number; color: RgbColor }> = [
	{ at: 0, color: { r: 7, g: 13, b: 28 } },
	{ at: 0.2, color: { r: 24, g: 49, b: 88 } },
	{ at: 0.28, color: { r: 123, g: 154, b: 212 } },
	{ at: 0.5, color: { r: 103, g: 196, b: 255 } },
	{ at: 0.72, color: { r: 241, g: 150, b: 92 } },
	{ at: 0.82, color: { r: 35, g: 45, b: 87 } },
	{ at: 1, color: { r: 7, g: 13, b: 28 } },
];

const HORIZON_PALETTE: Array<{ at: number; color: RgbColor }> = [
	{ at: 0, color: { r: 18, g: 25, b: 51 } },
	{ at: 0.2, color: { r: 93, g: 73, b: 111 } },
	{ at: 0.28, color: { r: 255, g: 202, b: 150 } },
	{ at: 0.5, color: { r: 178, g: 225, b: 255 } },
	{ at: 0.72, color: { r: 255, g: 177, b: 122 } },
	{ at: 0.82, color: { r: 64, g: 47, b: 80 } },
	{ at: 1, color: { r: 18, g: 25, b: 51 } },
];

/**
 * Resolves the complete visual state of the cycle backdrop for a day
 * `progress` in [0, 1) under `theme`. Pure — same inputs, same output.
 */
export function computeCycleVisuals(
	progress: number,
	theme: CycleTheme,
): CycleVisuals {
	const normalized = ((progress % 1) + 1) % 1;
	const isDay = normalized >= 0.25 && normalized < 0.75;
	const dayPhase = clamp((normalized - 0.25) / 0.5, 0, 1);
	const nightPhase = clamp(getNightPhase(normalized), 0, 1);
	const dayArc = Math.sin(dayPhase * Math.PI);
	const nightArc = Math.sin(nightPhase * Math.PI);
	const arc = CYCLE_ARCS[theme];
	const dawnBlend = clamp(1 - Math.abs(normalized - 0.25) / 0.08, 0, 1);
	const duskBlend = clamp(1 - Math.abs(normalized - 0.75) / 0.08, 0, 1);
	const twilight = Math.max(dawnBlend, duskBlend);
	const nightStrength = isDay ? 0 : 0.55 + nightArc * 0.45;
	// Relights themes whose foreground art has baked-in lighting (interim
	// static-PNG route): full brightness by day, dimmest at solar midnight,
	// eased back to 1 through the dawn/dusk twilight windows.
	const fgBrightness = isDay
		? 1
		: lerp(0.45 + (1 - nightArc) * 0.15, 1, twilight);

	return {
		topColor: interpolatePalette(normalized, TOP_PALETTE),
		horizonColor: interpolatePalette(normalized, HORIZON_PALETTE),
		sunX: arc.xMin + dayPhase * (arc.xMax - arc.xMin),
		sunY: arc.sunYBase - dayArc * arc.sunYAmp,
		moonX: arc.xMin + nightPhase * (arc.xMax - arc.xMin),
		moonY: arc.moonYBase - nightArc * arc.moonYAmp,
		sunOpacity: isDay ? 1 : 0,
		moonOpacity: isDay ? 0 : 1,
		starsOpacity: clamp(nightStrength - twilight * 0.6, 0, 1),
		twilightOpacity: twilight,
		fgBrightness,
	};
}

/** Writes `visuals` onto `node` as the CSS custom properties hub.css reads. */
export function applyCycleVisuals(
	node: HTMLElement,
	visuals: CycleVisuals,
): void {
	node.style.setProperty("--cycle-top", visuals.topColor);
	node.style.setProperty("--cycle-horizon", visuals.horizonColor);
	node.style.setProperty("--cycle-sun-x", `${visuals.sunX}%`);
	node.style.setProperty("--cycle-sun-y", `${visuals.sunY}%`);
	node.style.setProperty("--cycle-moon-x", `${visuals.moonX}%`);
	node.style.setProperty("--cycle-moon-y", `${visuals.moonY}%`);
	node.style.setProperty("--cycle-sun-opacity", String(visuals.sunOpacity));
	node.style.setProperty("--cycle-moon-opacity", String(visuals.moonOpacity));
	node.style.setProperty(
		"--cycle-stars-opacity",
		visuals.starsOpacity.toFixed(3),
	);
	node.style.setProperty(
		"--cycle-twilight-opacity",
		visuals.twilightOpacity.toFixed(3),
	);
	node.style.setProperty(
		"--cycle-fg-brightness",
		visuals.fgBrightness.toFixed(3),
	);
}
