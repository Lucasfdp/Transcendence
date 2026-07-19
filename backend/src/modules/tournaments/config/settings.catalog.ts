/**
 * Tournament settings catalog (SPEC-024, Phase 1).
 *
 * Declarative data only — no logic. Engines never hardcode these numbers;
 * they read the validated settings resolved by id through the Registry
 * framework (SPEC-025).
 */

/** A purchasable single-use alternate die (D8): price + the faces it rolls. */
export interface AlternateDieSettings {
	/** Shop price in points. */
	price: number;
	/** Faces the die can roll (each face is a movement value). */
	faces: readonly number[];
}

/** Complete v1 Tournament settings (SPEC-024 "Valores iniciales v1"). */
export interface TournamentSettings {
	/** Immutable catalog id; systems resolve settings by this id. */
	id: string;
	/** Catalog version, for traceability (logs/analytics), not migrations. */
	version: number;
	/** Free-form traceability metadata. */
	metadata?: Readonly<Record<string, string>>;

	/** Fixed number of players per tournament. */
	playersPerTournament: number;
	/** Key Items required to unlock the Final Challenge. */
	keyItemsRequired: number;
	/** Starting points per player. */
	initialPoints: number;
	/** Slots per player inventory (SPEC-014 "Capacidad": configurable, no hardcoded limit). */
	inventoryCapacity: number;
	/** Round minigame reward (passives/disconnected receive 0 — D4). */
	minigameReward: {
		winner: number;
		participant: number;
	};
	/** Gambling economy: cost per bet and win-chance progression (D3 pity). */
	gambling: {
		cost: number;
		/** Base probability of winning a bet, in (0, 1]. */
		baseWinChance: number;
		/**
		 * Added per completed round without unlocking a Key Item; resets to
		 * the base chance when one is unlocked.
		 */
		pityIncrementPerRound: number;
	};
	/** Points taken by AttemptStealAction. */
	stealAmount: number;
	/** Shop price of the Key Item Offer. */
	keyItemOfferPrice: number;
	/** Single-use alternate dice sold in the shop (D8). */
	alternateDice: {
		chiquito: AlternateDieSettings;
		grande: AlternateDieSettings;
		op: AlternateDieSettings;
	};
	/** Reaching this round without all Key Items ends in collective DEFEAT. */
	maxRound: number;
	/** Timing rules (SPEC-012 shop window, SPEC-015 watchdog, SPEC-038 lobby). */
	timeouts: {
		turnSeconds: number;
		gamblingDecisionSeconds: number;
		shopInteractionSeconds: number;
		minigameWatchdogMinutes: number;
		allDisconnectedMinutes: number;
		lobbyExpiryMinutes: number;
	};
}

/**
 * v1 settings. All figures are PROVISIONAL development values (D2, SPEC-040);
 * final balance will be tuned with the economy simulator in the SPEC-031
 * quality phase.
 */
export const TOURNAMENT_SETTINGS_V1: TournamentSettings = {
	id: "parrots-shell-v1",
	version: 1,
	metadata: {
		balance: "provisional dev values (D2, SPEC-040)",
	},

	playersPerTournament: 5,
	keyItemsRequired: 4,
	initialPoints: 100,
	inventoryCapacity: 8,
	minigameReward: {
		winner: 50,
		participant: 15,
	},
	gambling: {
		cost: 120,
		baseWinChance: 0.4,
		pityIncrementPerRound: 0.05,
	},
	stealAmount: 25,
	keyItemOfferPrice: 500,
	alternateDice: {
		chiquito: { price: 20, faces: [1, 2, 3] },
		grande: { price: 60, faces: [4, 5, 6] },
		op: { price: 150, faces: [6, 7, 8, 9, 10] },
	},
	maxRound: 15,
	timeouts: {
		turnSeconds: 30,
		gamblingDecisionSeconds: 30,
		shopInteractionSeconds: 30,
		minigameWatchdogMinutes: 10,
		allDisconnectedMinutes: 10,
		lobbyExpiryMinutes: 10,
	},
};
