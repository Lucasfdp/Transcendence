/**
 * Pure Shrine Slots logic — faithful copies of the backend's `selectSymbol` and
 * outcome id, kept free of React/DOM so the reel maths can be verified in
 * isolation. The symbol set and weights come from the server view so the client
 * mirrors whatever layout the backend is running.
 */
import type { SlotSymbolView } from "./contracts";

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

/**
 * Reel art per symbol id: the top three payout tiers get a character
 * portrait (rarer-feeling, dramatic art for the biggest wins), the bottom
 * three get a power-up icon (common, gameplay-flavoured art for the smaller
 * wins). Purely a display reskin — the ids, weights and payouts themselves
 * are the server's economy and aren't touched here (see
 * `backend/src/modules/casino/slots.constants.ts`).
 */
const SYMBOL_IMAGE_SRC: Readonly<Record<string, string>> = {
	dragon: "/assets/character/godly-turtle.png",
	lantern: "/assets/character/reaper-turtle.jpg",
	koi: "/assets/character/samurai-turtle.webp",
	bamboo: "/assets/power-ups/rocketPower.png",
	bell: "/assets/power-ups/mirrorPower.png",
	shell: "/assets/power-ups/tinyPower.png",
};

/** Image asset path for a symbol id (falls back to the "shell" tier art). */
export function slotImageSrc(id: string): string {
	return SYMBOL_IMAGE_SRC[id] ?? SYMBOL_IMAGE_SRC.shell;
}

/**
 * Display name shown in the paytable — matches what `SYMBOL_IMAGE_SRC` actually
 * draws rather than the old flavour id (e.g. "koi" now shows the samurai
 * turtle, so the paytable says "Samurai Turtle", not "Koi"). The power-up
 * names intentionally match `PowerDef.label` in
 * `shared/mechanics/power-system.ts` for the same power, so the two stay
 * consistent if either is ever renamed.
 */
const SYMBOL_DISPLAY_NAME: Readonly<Record<string, string>> = {
	dragon: "Godly Turtle",
	lantern: "Reaper Turtle",
	koi: "Samurai Turtle",
	bamboo: "Rocket Shell",
	bell: "Mirror",
	shell: "Tiny Shell",
};

/** Display name for a symbol id (falls back to the server's own label). */
export function slotDisplayName(
	id: string,
	fallbackLabel: string,
): string {
	return SYMBOL_DISPLAY_NAME[id] ?? fallbackLabel;
}

/** The reel symbol ids from a pipe-joined outcome id like "bell|bell|bell". */
export function reelsFromOutcome(outcomeId: string): string[] {
	return outcomeId.split("|");
}

/**
 * How many full loops of the symbol set a reel strip scrolls through before
 * landing — purely a visual "spin through several loops" pacing choice, not
 * anything the outcome depends on (the target symbol is always appended once
 * at the very end of the strip, see `buildReelStrip`).
 */
export const STRIP_LOOP_COUNT = 4;

/**
 * Builds one reel's scrollable strip of symbol ids: the full symbol set
 * repeated `STRIP_LOOP_COUNT` times, followed by the already-known target
 * symbol appended once at the end. Animating a reel's scroll offset so the
 * strip's last entry lands centred in the window (see
 * `reelStripTargetOffset`) is what makes the reel visibly spin through
 * several loops and then land exactly on the resolved outcome — the strip
 * never contains anything the animation could "decide" differently.
 */
export function buildReelStrip(
	symbols: readonly SlotSymbolView[],
	targetId: string,
): string[] {
	const ids = symbols.map((symbol) => symbol.id);
	const strip: string[] = [];
	for (let loop = 0; loop < STRIP_LOOP_COUNT; loop++) {
		strip.push(...ids);
	}
	strip.push(targetId);
	return strip;
}

/**
 * The vertical centre, in strip-space pixels, of the symbol at `index` on a
 * strip whose cells are `cellHeightPx` tall, once the strip has been
 * scrolled by `offsetPx`. Strip-space y=0 is the top of the strip's first
 * cell; the window itself is a separate coordinate space (see
 * `reelStripTargetOffset`) — this function only knows about the strip.
 */
export function symbolCenterY(
	index: number,
	cellHeightPx: number,
	offsetPx: number,
): number {
	return index * cellHeightPx + cellHeightPx / 2 - offsetPx;
}

/**
 * The scroll offset (in strip-space pixels) at which a strip of
 * `stripLength` cells has its *last* cell's centre aligned with the centre
 * of a `windowHeightPx`-tall viewing window. This is always the reel's
 * landing offset — the target symbol is always the strip's last entry (see
 * `buildReelStrip`) — so animating a reel's offset from `0` to this value
 * over time is guaranteed to land the already-known target symbol exactly
 * centred, for any symbol set or reel.
 */
export function reelStripTargetOffset(
	stripLength: number,
	cellHeightPx: number,
	windowHeightPx: number,
): number {
	const lastIndex = stripLength - 1;
	return symbolCenterY(lastIndex, cellHeightPx, 0) - windowHeightPx / 2;
}
