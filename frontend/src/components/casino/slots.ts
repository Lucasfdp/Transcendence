/**
 * Pure Shrine Slots logic — faithful copies of the backend's `selectSymbol` and
 * outcome id, kept free of React/DOM so the reel maths can be verified in
 * isolation. The symbol set and weights come from the server view so the client
 * mirrors whatever layout the backend is running.
 */
import type { SlotSymbolView } from "../../features/hub/api";

/** Resolve a roll in [0, 1) to a reel symbol by cumulative weight. */
export function selectSymbolFrom(
	symbols: readonly SlotSymbolView[],
	roll: number,
): SlotSymbolView {
	if (roll <= 0) return symbols[0];
	const total = symbols.reduce((sum, symbol) => sum + symbol.weight, 0);
	const target = roll * total;
	let cumulative = 0;
	for (const symbol of symbols) {
		cumulative += symbol.weight;
		if (target < cumulative) return symbol;
	}
	return symbols[symbols.length - 1];
}

/** The pipe-joined outcome id for a set of reel symbol ids (matches the server). */
export function slotsOutcomeId(symbolIds: readonly string[]): string {
	return symbolIds.join("|");
}

/** Resolve a full set of reel rolls to their symbol views, in reel order. */
export function reelSymbols(
	symbols: readonly SlotSymbolView[],
	rolls: readonly number[],
): SlotSymbolView[] {
	return rolls.map((roll) => selectSymbolFrom(symbols, roll));
}

/** Emoji glyph for a symbol id (dojo flavour; falls back to a shell). */
export function slotGlyph(id: string): string {
	const glyphs: Record<string, string> = {
		dragon: "🐉",
		lantern: "🏮",
		koi: "🐟",
		bamboo: "🎋",
		bell: "🔔",
		shell: "🐚",
	};
	return glyphs[id] ?? "🐚";
}
