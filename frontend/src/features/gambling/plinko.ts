/**
 * Pure Shell Drop logic — a faithful copy of the backend's
 * `bucketIndexFromRolls`, kept free of React/DOM so the roll→bucket maths can
 * be verified in isolation and the provably-fair panel can recompute a drop
 * client-side. Bucket multipliers are NOT recomputed here — the server sends
 * the exact derived values in the view, and the modal/verifier read them from
 * there so client and server can never drift.
 */
import type { PlinkoBucketView } from "./contracts";

/**
 * Rolls strictly below this send the shell left; the rest send it right.
 * Exported so animation code (`drop-path.ts`) can derive the same per-row
 * left/right direction without duplicating — and risking drift from — this
 * threshold.
 */
export const RIGHT_THRESHOLD = 0.5;

/** Map a set of per-row rolls in [0, 1) to the bucket index (matches the server). */
export function bucketIndexFromRolls(rolls: readonly number[]): number {
	return rolls.filter((roll) => roll >= RIGHT_THRESHOLD).length;
}

/** The outcome id the server stores for a landed bucket. */
export function plinkoOutcomeId(bucket: number): string {
	return `bucket-${bucket}`;
}

/** The bucket index parsed from an outcome id like "bucket-4". */
export function bucketFromOutcome(outcomeId: string): number {
	return Number(outcomeId.slice("bucket-".length));
}

/** Look up a bucket's server-supplied view by its index. */
export function bucketView(
	buckets: readonly PlinkoBucketView[],
	index: number,
): PlinkoBucketView | undefined {
	return buckets.find((bucket) => bucket.index === index);
}
