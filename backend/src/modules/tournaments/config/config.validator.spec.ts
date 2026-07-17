import {
	assertValidTournamentSettings,
	validateTournamentSettings,
} from "./config.validator";
import {
	TOURNAMENT_SETTINGS_V1,
	TournamentSettings,
} from "./settings.catalog";

const withOverrides = (
	overrides: Partial<TournamentSettings>,
): TournamentSettings => ({
	...TOURNAMENT_SETTINGS_V1,
	...overrides,
});

describe("validateTournamentSettings", () => {
	it("accepts the v1 catalog", () => {
		expect(validateTournamentSettings(TOURNAMENT_SETTINGS_V1)).toEqual([]);
	});

	it("rejects a blank id", () => {
		const errors = validateTournamentSettings(withOverrides({ id: "  " }));

		expect(errors).toContain("id must be a non-empty string");
	});

	it("rejects a non-positive version", () => {
		const errors = validateTournamentSettings(withOverrides({ version: 0 }));

		expect(errors).toContain("version must be a positive integer, got 0");
	});

	it.each([
		["playersPerTournament", { playersPerTournament: 0 }],
		["keyItemsRequired", { keyItemsRequired: -1 }],
		["initialPoints", { initialPoints: 2.5 }],
		["stealAmount", { stealAmount: 0 }],
	] as const)(
		"rejects a non-positive-integer %s",
		(field, overrides) => {
			const errors = validateTournamentSettings(withOverrides(overrides));

			expect(errors.some((e) => e.startsWith(field))).toBe(true);
		},
	);

	it("rejects a non-positive minigame winner reward", () => {
		const errors = validateTournamentSettings(
			withOverrides({ minigameReward: { winner: 0, participant: 15 } }),
		);

		expect(errors.some((e) => e.startsWith("minigameReward.winner"))).toBe(
			true,
		);
	});

	it("rejects a negative minigame participant reward but allows 0", () => {
		const failing = validateTournamentSettings(
			withOverrides({ minigameReward: { winner: 50, participant: -5 } }),
		);
		const passing = validateTournamentSettings(
			withOverrides({ minigameReward: { winner: 50, participant: 0 } }),
		);

		expect(
			failing.some((e) => e.startsWith("minigameReward.participant")),
		).toBe(true);
		expect(passing).toEqual([]);
	});

	it.each([0, 1.5, -0.2])(
		"rejects baseWinChance outside (0, 1]: %p",
		(baseWinChance) => {
			const errors = validateTournamentSettings(
				withOverrides({
					gambling: {
						...TOURNAMENT_SETTINGS_V1.gambling,
						baseWinChance,
					},
				}),
			);

			expect(
				errors.some((e) => e.startsWith("gambling.baseWinChance")),
			).toBe(true);
		},
	);

	it("rejects pityIncrementPerRound outside (0, 1]", () => {
		const errors = validateTournamentSettings(
			withOverrides({
				gambling: {
					...TOURNAMENT_SETTINGS_V1.gambling,
					pityIncrementPerRound: 0,
				},
			}),
		);

		expect(
			errors.some((e) => e.startsWith("gambling.pityIncrementPerRound")),
		).toBe(true);
	});

	it("rejects a non-positive gambling cost", () => {
		const errors = validateTournamentSettings(
			withOverrides({
				gambling: { ...TOURNAMENT_SETTINGS_V1.gambling, cost: 0 },
			}),
		);

		expect(errors.some((e) => e.startsWith("gambling.cost"))).toBe(true);
	});

	it("rejects a negative keyItemOfferPrice", () => {
		const errors = validateTournamentSettings(
			withOverrides({ keyItemOfferPrice: -1 }),
		);

		expect(errors.some((e) => e.startsWith("keyItemOfferPrice"))).toBe(true);
	});

	it("rejects a die with a negative price", () => {
		const errors = validateTournamentSettings(
			withOverrides({
				alternateDice: {
					...TOURNAMENT_SETTINGS_V1.alternateDice,
					chiquito: { price: -20, faces: [1, 2, 3] },
				},
			}),
		);

		expect(
			errors.some((e) => e.startsWith("alternateDice.chiquito.price")),
		).toBe(true);
	});

	it("rejects a die with no faces", () => {
		const errors = validateTournamentSettings(
			withOverrides({
				alternateDice: {
					...TOURNAMENT_SETTINGS_V1.alternateDice,
					grande: { price: 60, faces: [] },
				},
			}),
		);

		expect(errors).toContain("alternateDice.grande.faces must not be empty");
	});

	it("rejects a die with non-positive-integer faces", () => {
		const errors = validateTournamentSettings(
			withOverrides({
				alternateDice: {
					...TOURNAMENT_SETTINGS_V1.alternateDice,
					op: { price: 150, faces: [0, 1.5, 10] },
				},
			}),
		);

		expect(
			errors.some((e) =>
				e.startsWith(
					"alternateDice.op.faces must contain only positive integers",
				),
			),
		).toBe(true);
	});

	it("rejects maxRound below 1", () => {
		const errors = validateTournamentSettings(withOverrides({ maxRound: 0 }));

		expect(errors).toContain("maxRound must be an integer >= 1, got 0");
	});

	it("rejects a non-positive timeout", () => {
		const errors = validateTournamentSettings(
			withOverrides({
				timeouts: { ...TOURNAMENT_SETTINGS_V1.timeouts, turnSeconds: 0 },
			}),
		);

		expect(errors.some((e) => e.startsWith("timeouts.turnSeconds"))).toBe(
			true,
		);
	});

	it("rejects settings whose economic loop does not close", () => {
		const errors = validateTournamentSettings(
			withOverrides({
				gambling: { ...TOURNAMENT_SETTINGS_V1.gambling, cost: 201 },
			}),
		);

		expect(
			errors.some((e) => e.startsWith("economic loop does not close")),
		).toBe(true);
	});

	it("collects every error instead of stopping at the first", () => {
		const errors = validateTournamentSettings(
			withOverrides({ id: "", maxRound: 0, stealAmount: -1 }),
		);

		expect(errors.length).toBeGreaterThanOrEqual(3);
	});
});

describe("assertValidTournamentSettings", () => {
	it("does not throw for the v1 catalog", () => {
		expect(() =>
			assertValidTournamentSettings(TOURNAMENT_SETTINGS_V1),
		).not.toThrow();
	});

	it("throws one error listing every problem", () => {
		const invalid = withOverrides({ maxRound: 0, stealAmount: -1 });

		let thrown: Error | undefined;
		try {
			assertValidTournamentSettings(invalid);
		} catch (error) {
			thrown = error as Error;
		}

		expect(thrown).toBeDefined();
		expect(thrown!.message).toContain(
			'Invalid tournament settings "parrots-shell-v1"',
		);
		expect(thrown!.message).toContain("maxRound");
		expect(thrown!.message).toContain("stealAmount");
	});
});
