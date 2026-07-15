import type { CardRarity } from "./contracts";

/** Maximum tilt rotation, in degrees, applied at the card's edges. */
export const MAX_TILT_DEG = 16;

export interface CardTilt {
	/** Rotation around the X axis — tilts the top of the card towards/away from the viewer. */
	rotateX: number;
	/** Rotation around the Y axis — tilts the card left/right. */
	rotateY: number;
	/** Horizontal shine-highlight position, as a 0..100 percentage. */
	shineX: number;
	/** Vertical shine-highlight position, as a 0..100 percentage. */
	shineY: number;
}

/**
 * Computes a 3D tilt + shine-highlight position from a pointer's position
 * within a card, normalised to 0..1 on both axes (0,0 = top-left corner,
 * 1,1 = bottom-right corner). Pure and DOM-free so both the grid `CardSlot`
 * and the enlarged lightbox view can share — and unit test — the same math.
 */
export function computeCardTilt(
	normalizedX: number,
	normalizedY: number,
	maxTiltDeg: number = MAX_TILT_DEG,
): CardTilt {
	const x = clamp01(normalizedX);
	const y = clamp01(normalizedY);

	return {
		rotateY: (x - 0.5) * maxTiltDeg,
		rotateX: (0.5 - y) * maxTiltDeg,
		shineX: x * 100,
		shineY: y * 100,
	};
}

/** Clamps a value to 0..1, defaulting to the centre (0.5) for non-finite input. */
function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0.5;
	return Math.min(1, Math.max(0, value));
}

/**
 * Foil shine opacity, scaled by rarity — higher tiers get a more intense
 * highlight so a gold pull visibly outshines a stone one.
 */
export const FOIL_SHINE_INTENSITY: Record<CardRarity, number> = {
	stone: 0.18,
	bronze: 0.28,
	jade: 0.34,
	gold: 0.5,
};
