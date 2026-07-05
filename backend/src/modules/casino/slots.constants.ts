/**
 * Shrine Slots — catalogue & economy constants.
 *
 * Three reels share one symbol set; each reel is rolled independently from the
 * same provably-fair spin. A win pays by the resulting combination — for now,
 * three-of-a-kind only. The payout maths lives here so it is auditable in one
 * place and the RTP is unit-tested by full enumeration.
 *
 * Economy design: the reels use UNIFORM weights, which makes the RTP closed
 * form. With S equally-likely symbols and three-of-a-kind only,
 *   RTP = Σ_s (1/S)^3 · M_s = (1/S^3) · Σ_s M_s.
 * With S = 6 symbols, Σ M_s = 216 = 6^3 gives RTP exactly 1.0 — net-neutral,
 * no house edge. (Rarer-feeling symbols pay more purely for flavour; with
 * uniform weights every symbol is equally likely.)
 */

/** One reel symbol (icon ids reused from the dojo's existing art). */
export interface SlotSymbol {
	/** Stable id, e.g. "dragon". */
	id: string;
	/** Human-facing label shown in the paytable. */
	label: string;
	/**
	 * Reel selection weight. Uniform across symbols so the RTP stays closed-form;
	 * kept as a field so a future tuning pass can re-weight without code changes
	 * (the enumeration RTP test would catch any drift from net-neutral).
	 */
	weight: number;
}

/** Number of reels spun per play. */
export const SLOT_REEL_COUNT = 3;

/**
 * The reel. Uniform weights → each symbol is equally likely. Ordered by payout
 * (richest first) for a tidy paytable; order does not affect odds.
 */
export const SLOT_SYMBOLS: readonly SlotSymbol[] = [
	{ id: "dragon", label: "Dragon", weight: 1 },
	{ id: "lantern", label: "Lantern", weight: 1 },
	{ id: "koi", label: "Koi", weight: 1 },
	{ id: "bamboo", label: "Bamboo", weight: 1 },
	{ id: "bell", label: "Bell", weight: 1 },
	{ id: "shell", label: "Shell", weight: 1 },
] as const;

/**
 * Three-of-a-kind payout multiplier per symbol. The values sum to 216 = 6^3,
 * which with uniform reels makes the enumerated RTP exactly 1.0 (see the spec).
 */
export const PAYTABLE: Readonly<Record<string, number>> = {
	dragon: 80,
	lantern: 48,
	koi: 36,
	bamboo: 24,
	bell: 16,
	shell: 12,
};

/** Sum of every symbol weight — the denominator for symbol probabilities. */
export function slotTotalWeight(): number {
	return SLOT_SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0);
}

/**
 * Map a roll in [0, 1) to a reel symbol by cumulative weight. Rolls outside the
 * range are clamped (negative → first, ≥ 1 → last) so a reel can never fall
 * through unassigned; the final return guards against floating-point drift.
 */
export function selectSymbol(roll: number): SlotSymbol {
	if (roll <= 0) return SLOT_SYMBOLS[0];
	const target = roll * slotTotalWeight();
	let cumulative = 0;
	for (const symbol of SLOT_SYMBOLS) {
		cumulative += symbol.weight;
		if (target < cumulative) return symbol;
	}
	return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1];
}

/**
 * Evaluate a spin's three reels. `outcomeId` is the pipe-joined symbol ids
 * (e.g. "dragon|dragon|dragon"); the multiplier is the symbol's paytable value
 * for three-of-a-kind, otherwise 0.
 */
export function evaluate(symbols: readonly string[]): {
	outcomeId: string;
	multiplier: number;
} {
	const outcomeId = symbols.join("|");
	const allSame = symbols.every((symbol) => symbol === symbols[0]);
	const multiplier = allSame ? (PAYTABLE[symbols[0]] ?? 0) : 0;
	return { outcomeId, multiplier };
}

/**
 * Weighted-average return-to-player, computed by enumerating every reel
 * combination. Equals 1.0 for the uniform/three-of-a-kind layout above; the
 * spec asserts it rather than trusting the hand maths.
 */
export function slotsRtp(): number {
	const total = slotTotalWeight();
	let rtp = 0;
	for (const a of SLOT_SYMBOLS) {
		for (const b of SLOT_SYMBOLS) {
			for (const c of SLOT_SYMBOLS) {
				const probability =
					(a.weight / total) * (b.weight / total) * (c.weight / total);
				rtp += probability * evaluate([a.id, b.id, c.id]).multiplier;
			}
		}
	}
	return rtp;
}

/** A reel symbol enriched with its public probability and three-of-a-kind payout. */
export interface SlotSymbolView extends SlotSymbol {
	/** Probability of this symbol on one reel = weight / total weight. */
	probability: number;
	/** Three-of-a-kind payout multiplier. */
	payout: number;
}

/** Everything the frontend needs to render Shrine Slots and its paytable. */
export interface SlotsView {
	symbols: SlotSymbolView[];
	/** How many reels are spun. */
	reelCount: number;
	/** Weighted-average return-to-player (1.0 = net-neutral). */
	rtp: number;
	/** Accepted wager bounds (shared with the wheel). */
	minWager: number;
	maxWager: number;
	/** The requesting player's current coin balance. */
	coins: number;
}

/** The reel with each symbol's probability and payout — pure, no I/O. */
export function slotSymbolViews(): SlotSymbolView[] {
	const total = slotTotalWeight();
	return SLOT_SYMBOLS.map((symbol) => ({
		...symbol,
		probability: symbol.weight / total,
		payout: PAYTABLE[symbol.id] ?? 0,
	}));
}
