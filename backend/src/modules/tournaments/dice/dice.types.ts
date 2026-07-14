/**
 * dice.types.ts — Dice System contracts (SPEC-010, D8 "lista de números").
 *
 * A die is NOT an object with behaviour — it is JUST A LIST OF NUMBERS (SPEC-010
 * "Modelo", D8): every face is a movement value, all faces are equiprobable, and
 * bias is expressed ONLY by repeating numbers in the list (never a weight field).
 * There are no special faces and no Actions on faces — special effects come
 * exclusively from Items and Rules, which reach the roll through the ports below.
 *
 * This file declares pure data + the two dependency-inverted seams the Dice
 * System uses so it never imports the Rule Engine or the Item system (SPEC-010
 * "Restricciones"): a `DiceValueModifier` (the Rule Engine value-modifier seam)
 * and an `ActiveDieResolver` (the die-override-by-Item seam). Both have inert
 * defaults so the Dice System runs standalone.
 */

// ── Dice definition (SPEC-010 "Definición") ─────────────────────────────────

/**
 * The immutable definition of a die (SPEC-010 "Definición": id, name, icon,
 * description, faces[], metadata). Registered once in the dice registry and
 * deep-frozen. `faces` is a plain list of movement values — equiprobable, bias
 * by repetition (SPEC-010 "Modelo").
 */
export interface DiceDefinition {
	readonly id: string;
	readonly name: string;
	readonly icon: string;
	readonly description: string;
	/** The movement values; equiprobable, bias expressed by repetition (D8). */
	readonly faces: readonly number[];
	readonly metadata?: Readonly<Record<string, unknown>>;
}

// ── Roll result (SPEC-010 "Resultado") ──────────────────────────────────────

/**
 * The outcome of one roll (SPEC-010 "Resultado": DiceRollResult — diceId, value,
 * seed). `baseValue` is the raw face chosen by the seed; `value` is the final
 * movement value after Rule value-modifiers. The timestamp lives on the event
 * envelope, not here.
 */
export interface DiceRollResult {
	readonly diceId: string;
	/** Raw face chosen by the seed, before any Rule modifier. */
	readonly baseValue: number;
	/** Final movement value after Rule value-modifiers (SPEC-009). */
	readonly value: number;
	/** The tournament seed used — the roll is reproducible from it (SPEC-010). */
	readonly seed: string;
}

// ── Dependency-inverted seams (SPEC-010 "Rule Engine" / "Dados") ─────────────

/**
 * The Rule Engine value-modifier seam (SPEC-010 "Rule Engine": Rules may modify
 * the final value via DiceModifier). The architect wires this to
 * `ruleEngine.queryDiceModifier(...)` at integration; identity by default so the
 * Dice System never imports the Rule Engine.
 */
export interface DiceValueModifier {
	apply(input: {
		playerId: number;
		round: number;
		baseValue: number;
	}): number;
}

/**
 * The die-override seam (SPEC-010 "Resolver dado activo": normal by default,
 * overridden when a die-Item is in use). Returns the overriding die id, or
 * `undefined` for the default die. The default resolver returns `undefined` —
 * die-override by Items is a later phase, and the Dice System never knows Items
 * (SPEC-010 "Restricciones"): an Item activates a Rule, and integration wires
 * that into this resolver.
 */
export interface ActiveDieResolver {
	resolve(playerId: number): string | undefined;
}

/**
 * Input for one roll. `diceId` (explicit) wins over the `ActiveDieResolver`,
 * which in turn wins over the default die (SPEC-010 "Roll Pipeline"). `round`
 * defaults to the constructor's `getRound()`.
 */
export interface RollInput {
	readonly playerId: number;
	readonly round?: number;
	readonly diceId?: string;
}

/** JSON-safe snapshot of the Dice System (SPEC-010): only the roll counter is
 * state — everything else is content/seed. */
export interface DiceSnapshot {
	readonly tournamentId: string;
	readonly seed: string;
	readonly rollCount: number;
}
