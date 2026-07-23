/**
 * Public surface of the extracted hub backdrop feature (performance plan,
 * Phase 5). The integrator mounts {@link CycleBackdrop} from the hub page in
 * place of the inline implementation; everything else is exported for tests
 * and for the page-level wiring (e.g. resolving quality inputs up front).
 */
export { CycleBackdrop, type CycleBackdropProps } from "./CycleBackdrop";
export {
	applyCycleVisuals,
	computeCycleVisuals,
	createManualTime,
	getDayProgress,
	type CycleVisuals,
} from "./cycleEngine";
export {
	type BackdropQuality,
	type BackdropQualityInputs,
	createStars,
	createStarSprites,
	detectSoftwareRenderer,
	drawStarField,
	MAX_STAR_COUNT,
	MAX_STAR_COUNT_SOFTWARE,
	MIN_STAR_COUNT,
	resetSoftwareRendererCache,
	resolveBackdropQuality,
	type Star,
	STAR_COLORS,
	twinkleFactor,
} from "./starField";
