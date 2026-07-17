/**
 * Tournament settings validation (SPEC-024, Phase 1).
 *
 * Pure functions, no gameplay logic. Validation runs at module boot: an
 * invalid configuration is never loaded (SPEC-024 "Casos límite"). Only
 * validation bounds live here — every gameplay number belongs to the catalog.
 */

import { TournamentSettings } from "./settings.catalog";

/**
 * Economic-loop sanity bound (SPEC-024): the loop must close on paper — a
 * minigame winner must be able to afford one Gambling bet after winning at
 * most this many rounds. Any balance change must keep this property.
 */
const ECONOMIC_LOOP_MAX_WINNER_ROUNDS_PER_BET = 4;

const isInteger = (value: number): boolean => Number.isInteger(value);

/**
 * Validates a settings object and returns the full list of errors
 * (empty list = valid).
 */
export function validateTournamentSettings(
	settings: TournamentSettings,
): string[] {
	const errors: string[] = [];

	const positiveInt = (label: string, value: number): void => {
		if (!isInteger(value) || value <= 0)
			errors.push(`${label} must be a positive integer, got ${value}`);
	};
	const nonNegativeInt = (label: string, value: number): void => {
		if (!isInteger(value) || value < 0)
			errors.push(`${label} must be an integer >= 0, got ${value}`);
	};
	const probability = (label: string, value: number): void => {
		if (!(typeof value === "number" && value > 0 && value <= 1))
			errors.push(`${label} must be a probability in (0, 1], got ${value}`);
	};

	if (!settings.id || settings.id.trim() === "")
		errors.push("id must be a non-empty string");
	positiveInt("version", settings.version);

	positiveInt("playersPerTournament", settings.playersPerTournament);
	positiveInt("keyItemsRequired", settings.keyItemsRequired);
	positiveInt("initialPoints", settings.initialPoints);
	positiveInt("inventoryCapacity", settings.inventoryCapacity);

	positiveInt("minigameReward.winner", settings.minigameReward.winner);
	nonNegativeInt(
		"minigameReward.participant",
		settings.minigameReward.participant,
	);

	positiveInt("gambling.cost", settings.gambling.cost);
	probability("gambling.baseWinChance", settings.gambling.baseWinChance);
	probability(
		"gambling.pityIncrementPerRound",
		settings.gambling.pityIncrementPerRound,
	);

	positiveInt("stealAmount", settings.stealAmount);
	nonNegativeInt("keyItemOfferPrice", settings.keyItemOfferPrice);

	for (const [name, die] of Object.entries(settings.alternateDice)) {
		nonNegativeInt(`alternateDice.${name}.price`, die.price);
		if (die.faces.length === 0)
			errors.push(`alternateDice.${name}.faces must not be empty`);
		if (die.faces.some((face) => !isInteger(face) || face <= 0))
			errors.push(
				`alternateDice.${name}.faces must contain only positive integers, got [${die.faces.join(", ")}]`,
			);
	}

	if (!isInteger(settings.maxRound) || settings.maxRound < 1)
		errors.push(`maxRound must be an integer >= 1, got ${settings.maxRound}`);

	for (const [name, value] of Object.entries(settings.timeouts))
		positiveInt(`timeouts.${name}`, value);

	// Economic loop (SPEC-024): winning ceil(cost / winnerReward) minigames
	// funds one bet; that count must stay within the sanity bound so a
	// winner can afford a bet within a few rounds.
	if (
		settings.gambling.cost >
		settings.minigameReward.winner * ECONOMIC_LOOP_MAX_WINNER_ROUNDS_PER_BET
	)
		errors.push(
			`economic loop does not close: gambling.cost (${settings.gambling.cost}) exceeds ` +
				`minigameReward.winner (${settings.minigameReward.winner}) x ${ECONOMIC_LOOP_MAX_WINNER_ROUNDS_PER_BET}; ` +
				"a minigame winner must be able to afford a bet within " +
				`${ECONOMIC_LOOP_MAX_WINNER_ROUNDS_PER_BET} won rounds`,
		);

	return errors;
}

/**
 * Boot-time guard: throws a single error listing every problem when the
 * settings are invalid. An invalid configuration never loads.
 */
export function assertValidTournamentSettings(
	settings: TournamentSettings,
): void {
	const errors = validateTournamentSettings(settings);
	if (errors.length > 0)
		throw new Error(
			`Invalid tournament settings "${settings.id}":\n- ${errors.join("\n- ")}`,
		);
}
