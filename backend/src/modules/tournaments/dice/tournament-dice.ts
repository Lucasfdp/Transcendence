/**
 * tournament-dice.ts — Tournament Dice System (SPEC-010, D8 model).
 *
 * ONE INSTANCE PER TOURNAMENT. Its ONLY responsibility is to produce a valid
 * numeric roll (SPEC-010 "Objetivo"): resolve the active die (a list of numbers,
 * D8), choose a face WITH THE TOURNAMENT SEED (deterministic — the server rolls,
 * never the client, SPEC-010 "Generación"), let the Rule Engine modify the final
 * value, and emit the facts. It knows nothing of Board, Runtime, Boss, economy,
 * minigames, gambling or Items (SPEC-010 "Restricciones"): the Rule/Item
 * influence arrives only through the injected `DiceValueModifier` /
 * `ActiveDieResolver` ports.
 *
 * Determinism (SPEC-000/028): the ONLY randomness is the shared seeded PRNG
 * (`infra/seeded-rng.ts`) — no `Math.random`. Each roll advances a monotonic
 * counter namespaced into the seed, so repeated rolls differ yet the whole
 * sequence is reproducible from `(seed, roll index)`. Timestamps come only from
 * the injected clock — never `Date.now`.
 */

import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import { createSeededRng } from "../infra/seeded-rng";
import { Registry } from "../registry/registry";
import {
	DiceDefinition,
	DiceRollResult,
	DiceSnapshot,
	DiceValueModifier,
	ActiveDieResolver,
	RollInput,
} from "./dice.types";
import { DEFAULT_DICE_ID, createDiceRegistry } from "./dice-registry";

export interface TournamentDiceOptions {
	readonly tournamentId: string;
	/** Tournament seed (SPEC-000): rolls are reproducible from it. */
	readonly seed: string;
	/** Dice content registry (defaults to the seeded v1 catalog). */
	readonly registry?: Registry<DiceDefinition>;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	/** Rule-Engine value-modifier seam; identity when omitted (SPEC-010). */
	readonly valueModifier?: DiceValueModifier;
	/** Die-override seam (Item dice); default die when omitted (SPEC-010). */
	readonly activeDieResolver?: ActiveDieResolver;
	/** Current tournament round for event envelopes / rules; 0 when omitted. */
	readonly getRound?: () => number;
}

/** Identity value-modifier used when no Rule Engine is injected (v1 default). */
const IDENTITY_VALUE_MODIFIER: DiceValueModifier = {
	apply: ({ baseValue }) => baseValue,
};

/** Default die resolver: no override → the default die (SPEC-010). */
const DEFAULT_DIE_RESOLVER: ActiveDieResolver = {
	resolve: () => undefined,
};

export class TournamentDice {
	private readonly tournamentId: string;
	private readonly seed: string;
	private readonly registry: Registry<DiceDefinition>;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly logger: TournamentLogger;
	private readonly valueModifier: DiceValueModifier;
	private readonly activeDieResolver: ActiveDieResolver;
	private readonly getRound: () => number;

	/** Monotonic roll index: namespaced into the seed so each roll is a fresh,
	 * reproducible draw (part of the snapshot). */
	private rollCount = 0;

	constructor(options: TournamentDiceOptions) {
		this.tournamentId = options.tournamentId;
		this.seed = options.seed;
		this.registry = options.registry ?? createDiceRegistry({ seed: true });
		this.bus = options.bus;
		this.clock = options.clock;
		this.logger =
			options.logger?.child("Dice") ??
			new TournamentLogger({ tournamentId: this.tournamentId, system: "Dice" });
		this.valueModifier = options.valueModifier ?? IDENTITY_VALUE_MODIFIER;
		this.activeDieResolver = options.activeDieResolver ?? DEFAULT_DIE_RESOLVER;
		this.getRound = options.getRound ?? (() => 0);
	}

	/**
	 * Rolls a die (SPEC-010 "Roll Pipeline"): resolve active die → choose a face
	 * with the seed → apply Rule value-modifiers → emit DiceModified (only if the
	 * value changed) → emit DiceRolled → return the result. Never throws: an
	 * unknown/invalid resolved die falls back to the default die with a warning
	 * (SPEC-010 "Casos límite").
	 */
	roll(input: RollInput): DiceRollResult {
		const round = input.round ?? this.getRound();
		const die = this.resolveDie(input);

		// Choose a face using the shared seeded PRNG, namespaced by the roll index
		// so each roll is an independent, reproducible draw (SPEC-010 "Generación").
		const rng = createSeededRng(`${this.seed}:dice:${this.rollCount}`);
		this.rollCount += 1;
		const faceIndex = Math.floor(rng() * die.faces.length) % die.faces.length;
		const baseValue = die.faces[faceIndex];

		// Apply Rule value-modifiers (SPEC-010 "Rule Engine"): all value modifiers
		// composed by the engine; identity when no Rule Engine is wired.
		const value = this.valueModifier.apply({
			playerId: input.playerId,
			round,
			baseValue,
		});

		if (value !== baseValue) {
			// A Rule changed the value → DiceModified (SPEC-010 "Eventos").
			this.emit("DiceModified", input.playerId, round, {
				diceId: die.id,
				baseValue,
				finalValue: value,
			});
		}

		this.emit("DiceRolled", input.playerId, round, {
			diceId: die.id,
			value,
			seed: this.seed,
		});

		return { diceId: die.id, baseValue, value, seed: this.seed };
	}

	/** JSON-safe snapshot (SPEC-010): only the roll counter is mutable state. */
	serialize(): DiceSnapshot {
		return {
			tournamentId: this.tournamentId,
			seed: this.seed,
			rollCount: this.rollCount,
		};
	}

	/** Restores the roll counter from a snapshot (SPEC-023 replay). */
	restoreFrom(snapshot: DiceSnapshot): void {
		this.rollCount = snapshot.rollCount;
	}

	// ── Internals ────────────────────────────────────────────────────────────

	/**
	 * Resolves the die to roll (SPEC-010 "Roll Pipeline": explicit `diceId` →
	 * `ActiveDieResolver` override → default die). An unknown/invalid resolved id
	 * falls back to the default die with a warning — never a throw.
	 */
	private resolveDie(input: RollInput): DiceDefinition {
		const requestedId =
			input.diceId ?? this.activeDieResolver.resolve(input.playerId);
		if (requestedId !== undefined) {
			const die = this.registry.get(requestedId);
			if (die) {
				return die;
			}
			this.logger.warn("unknown die requested; falling back to the default die", {
				playerId: input.playerId,
				metadata: { requestedId },
			});
		}
		const defaultDie = this.registry.get(DEFAULT_DICE_ID);
		if (defaultDie) {
			return defaultDie;
		}
		// The default die is missing from the catalog: a genuinely invalid setup.
		// Fall back to the first registered die rather than throw (SPEC-010).
		const any = this.registry.getAll()[0];
		if (!any) {
			// No dice at all — a controlled degenerate roll of [1] keeps the game
			// going (SPEC-010: never crash the tournament for a bad catalog).
			this.logger.error("dice registry is empty; using a degenerate [1] die");
			return {
				id: DEFAULT_DICE_ID,
				name: "Fallback",
				icon: "🎲",
				description: "fallback",
				faces: [1],
			};
		}
		return any;
	}

	private emit<TName extends TournamentEventName>(
		name: TName,
		playerId: number | null,
		round: number,
		payload: TournamentEventPayloadMap[TName],
	): void {
		const event = createTournamentEvent({
			name,
			tournamentId: this.tournamentId,
			round,
			playerId,
			payload,
			timestamp: this.clock.now(),
		});
		this.bus.emit(event as AnyTournamentEvent);
	}
}
