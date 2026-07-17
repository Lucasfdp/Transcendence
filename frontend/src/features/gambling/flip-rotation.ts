/**
 * Pure rotation-angle → visual-face maths for Shell Flip's coin animation.
 * Framework-free (no React/DOM) so the back-facing/mirroring and face-swap
 * logic can be sanity-checked in isolation from the RAF-driven animation
 * effect in `ShellFlipModal` that calls it.
 */
import type { FlipSide } from "./contracts";
import { mod360 } from "./spin-rotation";

/** Below this normalised angle, the coin's front (unmirrored) face is showing. */
const MIRROR_ZONE_START_DEG = 90;

/** Above this normalised angle, the coin's front (unmirrored) face is showing again. */
const MIRROR_ZONE_END_DEG = 270;

/**
 * Whether a `rotateY(angleDeg)` transform is currently showing the coin's
 * "back" — the mirrored half of a flat rotated element, visible between 90°
 * and 270° of every 360° cycle (default CSS backface behaviour, since the
 * coin is a single element rather than two stacked faces). Callers use this
 * to counter-mirror the label (`scaleX(-1)`) so text reads correctly instead
 * of backwards whenever the coin is resting or passing through this zone.
 */
export function isBackFacing(angleDeg: number): boolean {
	const normalized = mod360(angleDeg);
	return normalized > MIRROR_ZONE_START_DEG && normalized < MIRROR_ZONE_END_DEG;
}

/**
 * Which shell side should be visually loaded (colour + label) at a given
 * absolute rotation angle. `spinToAngle` (see `ShellFlipModal`) always lands
 * heads on a multiple of 360° and tails on 180° plus a multiple of 360°, so
 * the two halves of every 360° cycle map directly onto the two faces: the
 * front half (not back-facing) is heads, the back half (back-facing) is
 * tails. One rule drives the swap during the spin and the resting face,
 * matching them by construction — there is no separate bookkeeping of
 * "which side was showing before" to keep in sync.
 */
export function sideAtAngle(angleDeg: number): FlipSide {
	return isBackFacing(angleDeg) ? "tails" : "heads";
}
