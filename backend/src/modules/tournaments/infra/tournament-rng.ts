/**
 * tournament-rng.ts — a per-tournament SERIALIZABLE seeded random stream
 * (SPEC-000/028 determinism).
 *
 * Some deterministic decisions need a shared advancing RNG stream rather than a
 * self-namespaced counter (as Dice/Random Events use): the steal victim pick,
 * for example. This wraps the shared `infra/seeded-rng.ts` PRNG with a monotonic
 * draw counter that IS part of the tournament snapshot, so replaying from a
 * snapshot reproduces the exact same sequence. No `Math.random`, no clock.
 */

import { createSeededRng } from "./seeded-rng";

/** JSON-safe snapshot of the RNG stream (just the draw counter). */
export interface TournamentRngSnapshot {
	readonly seed: string;
	readonly drawCount: number;
}

export class TournamentRng {
	private readonly seed: string;
	private drawCount = 0;

	constructor(seed: string) {
		this.seed = seed;
	}

	/** Next float in [0, 1), advancing the deterministic stream. */
	next(): number {
		const value = createSeededRng(`${this.seed}:rng:${this.drawCount}`)();
		this.drawCount += 1;
		return value;
	}

	/**
	 * Deterministic integer index in [0, count). Returns 0 for a non-positive
	 * count (callers guard against empty selections, but this stays total).
	 */
	pickIndex(count: number): number {
		if (count <= 0) {
			return 0;
		}
		return Math.floor(this.next() * count) % count;
	}

	serialize(): TournamentRngSnapshot {
		return { seed: this.seed, drawCount: this.drawCount };
	}

	restoreFrom(snapshot: TournamentRngSnapshot): void {
		this.drawCount = snapshot.drawCount;
	}
}
