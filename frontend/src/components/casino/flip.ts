/**
 * Pure Shell Flip logic — a faithful copy of the backend's `flipSide`, kept free
 * of React/DOM so the roll→side maths can be verified in isolation (and the
 * provably-fair panel can recompute a spin client-side).
 */
import type { FlipSide } from "../../features/hub/api";

/** Rolls strictly below this land "heads"; the rest land "tails". */
export const FLIP_HEADS_THRESHOLD = 0.5;

/** Map a roll in [0, 1) to a shell side (matches the server byte-for-byte). */
export function flipSide(roll: number): FlipSide {
	return roll < FLIP_HEADS_THRESHOLD ? "heads" : "tails";
}

/** Accent colour for a shell side (dojo palette: gold vs jade). */
export function flipSideColor(side: FlipSide): string {
	return side === "heads" ? "#e6a23c" : "#3ca37a";
}

/** Human-facing label for a shell side. */
export function flipSideLabel(side: FlipSide): string {
	return side === "heads" ? "Gold Shell" : "Jade Shell";
}
