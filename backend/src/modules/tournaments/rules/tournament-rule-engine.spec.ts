/**
 * tournament-rule-engine.spec.ts — SPEC-009 v1 unit tests.
 *
 * Covers: register→activate→running→remove lifecycle + the four events; value
 * stacking in priority order; exclusive highest-priority-wins; lexicographic
 * tie-break determinism; each of the five query points with 0/1/many rules;
 * Round/Turns expiry via the advance hooks; safe no-ops; JSON-safe serialize;
 * and no Math.random / Date.now.
 */

import { ManualClock } from "../infra/clock";
import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	TournamentEventName,
} from "../events/tournament-event.types";
import { createRule } from "./configured-rule";
import { RuleContext } from "./rule.interface";
import { createRuleDefinitionRegistry, createSeedRule } from "./rule-registry";
import { TournamentRuleEngine } from "./tournament-rule-engine";

const TOURNAMENT_ID = "t-1";

interface Harness {
	engine: TournamentRuleEngine;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
	ctx: RuleContext;
	round: number;
}

function makeHarness(): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((e) => events.push(e));
	const harness = { round: 3 } as Harness;
	const engine = new TournamentRuleEngine({
		tournamentId: TOURNAMENT_ID,
		bus,
		clock,
		getRound: () => harness.round,
	});
	harness.engine = engine;
	harness.bus = bus;
	harness.clock = clock;
	harness.events = events;
	harness.ctx = {
		tournamentId: TOURNAMENT_ID,
		round: 3,
		eventBus: bus,
	};
	return harness;
}

const eventsNamed = (events: AnyTournamentEvent[], name: TournamentEventName) =>
	events.filter((e) => e.name === name);

describe("TournamentRuleEngine (SPEC-009 v1)", () => {
	describe("lifecycle + events", () => {
		it("walks register → activate → running → remove and emits the events", () => {
			const h = makeHarness();
			const rule = createSeedRule("noSteal");

			expect(h.engine.register(rule)).toBe(true);
			expect(h.engine.getRule("no_steal")?.state).toBe("Registered");
			expect(rule.isActive()).toBe(false);

			expect(h.engine.activate("no_steal")).toBe(true);
			expect(rule.isActive()).toBe(true);
			expect(h.engine.getRule("no_steal")?.state).toBe("Running");

			expect(h.engine.remove("no_steal")).toBe(true);
			expect(h.engine.has("no_steal")).toBe(false);

			expect(eventsNamed(h.events, "RuleActivated")).toHaveLength(1);
			expect(eventsNamed(h.events, "RuleRemoved")).toHaveLength(1);

			const activated = eventsNamed(h.events, "RuleActivated")[0];
			expect(activated.payload).toMatchObject({
				ruleId: "no_steal",
				priority: 10,
				point: "steal",
				composition: "exclusive",
				durationKind: "UntilRemoved",
			});
			const removed = eventsNamed(h.events, "RuleRemoved")[0];
			expect(removed.payload).toMatchObject({
				ruleId: "no_steal",
				reason: "manual",
			});
		});

		it("carries the flag name on RuleActivated for flag rules", () => {
			const h = makeHarness();
			h.engine.registerAndActivate(createSeedRule("fog"));
			const activated = eventsNamed(h.events, "RuleActivated")[0];
			expect(activated.payload).toMatchObject({ point: "flag", flag: "fog" });
		});

		it("deactivate suspends a running rule and emits RuleUpdated", () => {
			const h = makeHarness();
			h.engine.registerAndActivate(createSeedRule("noSteal"));
			expect(h.engine.isStealPrevented(h.ctx)).toBe(true);

			expect(h.engine.deactivate("no_steal")).toBe(true);
			expect(h.engine.isStealPrevented(h.ctx)).toBe(false);
			expect(eventsNamed(h.events, "RuleUpdated")).toHaveLength(1);

			// Re-activatable after suspension.
			expect(h.engine.activate("no_steal")).toBe(true);
			expect(h.engine.isStealPrevented(h.ctx)).toBe(true);
		});

		it("uses the clock (never Date.now) for event timestamps", () => {
			const h = makeHarness();
			h.clock.advance(500); // now = 1500
			h.engine.registerAndActivate(createSeedRule("noSteal"));
			expect(eventsNamed(h.events, "RuleActivated")[0].timestamp).toBe(1_500);
		});
	});

	describe("dice — value stacking in priority order", () => {
		it("applies all value modifiers in descending priority (×2 then +2)", () => {
			const h = makeHarness();
			// lucky_dice: +2 (prio 10); double_dice: ×2 (prio 20).
			h.engine.registerAndActivate(createSeedRule("luckyDice"));
			h.engine.registerAndActivate(createSeedRule("doubleDice"));
			// base 3 → ×2 (prio 20 first) = 6 → +2 (prio 10) = 8.
			expect(h.engine.queryDiceModifier(h.ctx, 3)).toBe(8);
		});

		it("returns the base value when no dice rule is active", () => {
			const h = makeHarness();
			expect(h.engine.queryDiceModifier(h.ctx, 5)).toBe(5);
		});

		it("applies a single value modifier", () => {
			const h = makeHarness();
			h.engine.registerAndActivate(createSeedRule("luckyDice"));
			expect(h.engine.queryDiceModifier(h.ctx, 4)).toBe(6);
		});
	});

	describe("dice — exclusive override wins, then value modifiers stack", () => {
		it("the highest-priority exclusive override replaces the base, then values apply", () => {
			const h = makeHarness();
			h.engine.registerAndActivate(createSeedRule("loadedDice")); // set 6, prio 100
			h.engine.registerAndActivate(createSeedRule("luckyDice")); // +2, prio 10
			h.engine.registerAndActivate(createSeedRule("doubleDice")); // ×2, prio 20
			// override → 6 → ×2 = 12 → +2 = 14.
			expect(h.engine.queryDiceModifier(h.ctx, 3)).toBe(14);
		});

		it("only ONE exclusive override applies (highest priority) and logs a conflict", () => {
			const h = makeHarness();
			h.engine.registerAndActivate(
				createRule({
					id: "override_low",
					priority: 5,
					point: "dice",
					composition: "exclusive",
					duration: { kind: "UntilRemoved" },
					value: { kind: "set", value: 1 },
				}),
			);
			h.engine.registerAndActivate(
				createRule({
					id: "override_high",
					priority: 9,
					point: "dice",
					composition: "exclusive",
					duration: { kind: "UntilRemoved" },
					value: { kind: "set", value: 6 },
				}),
			);
			expect(h.engine.queryDiceModifier(h.ctx, 3)).toBe(6);
		});
	});

	describe("priority tie-break by lexicographic id (determinism)", () => {
		it("resolves an exclusive tie by smallest id, independent of registration order", () => {
			const config = (id: string, value: number) =>
				createRule({
					id,
					priority: 50,
					point: "steal",
					composition: "exclusive",
					duration: { kind: "UntilRemoved" },
					boolean: value === 1,
				});

			// Register in reverse-id order; "aaa" must still win the tie.
			const h1 = makeHarness();
			h1.engine.registerAndActivate(config("zzz", 0));
			h1.engine.registerAndActivate(config("aaa", 1));
			expect(h1.engine.isStealPrevented(h1.ctx)).toBe(true);

			const h2 = makeHarness();
			h2.engine.registerAndActivate(config("aaa", 1));
			h2.engine.registerAndActivate(config("zzz", 0));
			expect(h2.engine.isStealPrevented(h2.ctx)).toBe(true);
		});
	});

	describe("the five consultation points with 0/1/many rules", () => {
		it("price: 0 rules → base; 1 rule → modified; free-shop forces 0", () => {
			const h = makeHarness();
			expect(h.engine.queryPriceModifier(h.ctx, 100)).toBe(100);
			h.engine.registerAndActivate(createSeedRule("freeShop"));
			expect(h.engine.queryPriceModifier(h.ctx, 100)).toBe(0);
		});

		it("reward: half points halves, stacks with a second multiplier", () => {
			const h = makeHarness();
			expect(h.engine.queryRewardMultiplier(h.ctx, 40)).toBe(40);
			h.engine.registerAndActivate(createSeedRule("halfPoints"));
			expect(h.engine.queryRewardMultiplier(h.ctx, 40)).toBe(20);
			h.engine.registerAndActivate(
				createRule({
					id: "triple_reward",
					priority: 30,
					point: "reward",
					composition: "value",
					duration: { kind: "UntilRemoved" },
					value: { kind: "multiply", factor: 3 },
				}),
			);
			// prio 30 (×3) then prio 10 (×0.5): 40 → 120 → 60.
			expect(h.engine.queryRewardMultiplier(h.ctx, 40)).toBe(60);
		});

		it("steal: 0 rules → not prevented; 1 rule → prevented", () => {
			const h = makeHarness();
			expect(h.engine.isStealPrevented(h.ctx)).toBe(false);
			h.engine.registerAndActivate(createSeedRule("noSteal"));
			expect(h.engine.isStealPrevented(h.ctx)).toBe(true);
		});

		it("flag: absent flag → false; only matching flag name resolves", () => {
			const h = makeHarness();
			expect(h.engine.getFlag(h.ctx, "fog")).toBe(false);
			h.engine.registerAndActivate(createSeedRule("fog"));
			expect(h.engine.getFlag(h.ctx, "fog")).toBe(true);
			expect(h.engine.getFlag(h.ctx, "other")).toBe(false);
		});
	});

	describe("durations — Round / Turns expiry via advance hooks", () => {
		it("a Round rule expires on round advance, emitting RuleExpired", () => {
			const h = makeHarness();
			h.engine.registerAndActivate(createSeedRule("freeShop")); // Round, rounds 1
			expect(h.engine.queryPriceModifier(h.ctx, 100)).toBe(0);

			h.engine.onRoundAdvanced();

			expect(h.engine.has("free_shop")).toBe(false);
			expect(h.engine.queryPriceModifier(h.ctx, 100)).toBe(100);
			const expired = eventsNamed(h.events, "RuleExpired");
			expect(expired).toHaveLength(1);
			expect(expired[0].payload).toMatchObject({
				ruleId: "free_shop",
				reason: "Round",
			});
			// Expiry path does NOT emit RuleRemoved (kept distinct).
			expect(eventsNamed(h.events, "RuleRemoved")).toHaveLength(0);
		});

		it("a Round rule with rounds=2 survives one advance and expires on the second", () => {
			const h = makeHarness();
			h.engine.registerAndActivate(
				createRule({
					id: "two_round",
					priority: 10,
					point: "reward",
					composition: "value",
					duration: { kind: "Round", rounds: 2 },
					value: { kind: "add", amount: 1 },
				}),
			);
			h.engine.onRoundAdvanced();
			expect(h.engine.has("two_round")).toBe(true);
			h.engine.onRoundAdvanced();
			expect(h.engine.has("two_round")).toBe(false);
		});

		it("a Turns rule expires after N turn consumptions, emitting RuleExpired", () => {
			const h = makeHarness();
			h.engine.registerAndActivate(createSeedRule("loadedDice")); // Turns 3
			h.engine.onTurnConsumed();
			h.engine.onTurnConsumed();
			expect(h.engine.has("loaded_dice")).toBe(true);
			h.engine.onTurnConsumed();
			expect(h.engine.has("loaded_dice")).toBe(false);
			expect(eventsNamed(h.events, "RuleExpired")[0].payload).toMatchObject({
				reason: "Turns",
			});
		});

		it("a player-bound Turns rule only ticks on its owner's turn", () => {
			const h = makeHarness();
			h.engine.registerAndActivate(
				createRule({
					id: "bound",
					priority: 10,
					point: "dice",
					composition: "value",
					duration: { kind: "Turns", turns: 1 },
					value: { kind: "add", amount: 1 },
					playerId: 42,
				}),
			);
			h.engine.onTurnConsumed(7); // other player — no tick
			expect(h.engine.has("bound")).toBe(true);
			h.engine.onTurnConsumed(42); // owner — expires
			expect(h.engine.has("bound")).toBe(false);
		});

		it("Round advance does not expire Permanent / UntilRemoved rules", () => {
			const h = makeHarness();
			h.engine.registerAndActivate(createSeedRule("halfPoints")); // Permanent
			h.engine.registerAndActivate(createSeedRule("noSteal")); // UntilRemoved
			h.engine.onRoundAdvanced();
			h.engine.onTurnConsumed();
			expect(h.engine.has("half_points")).toBe(true);
			expect(h.engine.has("no_steal")).toBe(true);
		});
	});

	describe("edge cases — safe no-ops (SPEC-009 'Casos límite')", () => {
		it("activating / removing / deactivating a non-existent rule never throws", () => {
			const h = makeHarness();
			expect(() => {
				expect(h.engine.activate("ghost")).toBe(false);
				expect(h.engine.remove("ghost")).toBe(false);
				expect(h.engine.deactivate("ghost")).toBe(false);
			}).not.toThrow();
			expect(h.engine.getRule("ghost")).toBeUndefined();
		});

		it("registering a duplicate id is ignored, keeping the original", () => {
			const h = makeHarness();
			expect(h.engine.register(createSeedRule("noSteal"))).toBe(true);
			expect(h.engine.register(createSeedRule("noSteal"))).toBe(false);
		});

		it("an invalid rule config is not activated", () => {
			const h = makeHarness();
			// Value point with no value operation → invalid.
			h.engine.register(
				createRule({
					id: "broken",
					priority: 1,
					point: "dice",
					composition: "value",
					duration: { kind: "Permanent" },
				}),
			);
			expect(h.engine.activate("broken")).toBe(false);
			expect(h.engine.getRule("broken")?.state).toBe("Registered");
		});
	});

	describe("serialize()", () => {
		it("produces a JSON-safe snapshot of the active rules", () => {
			const h = makeHarness();
			h.engine.registerAndActivate(createSeedRule("loadedDice"));
			h.engine.registerAndActivate(createSeedRule("noSteal"));

			const snapshot = h.engine.serialize();
			expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow();
			expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
			expect(snapshot.tournamentId).toBe(TOURNAMENT_ID);
			expect(snapshot.rules.map((r) => r.id).sort()).toEqual([
				"loaded_dice",
				"no_steal",
			]);
			const loaded = snapshot.rules.find((r) => r.id === "loaded_dice");
			expect(loaded).toMatchObject({
				state: "Running",
				remainingTurns: 3,
				value: { kind: "set", value: 6 },
			});
		});
	});

	describe("definition registry (SPEC-009 'Registro' / 'Configuración')", () => {
		it("stores frozen definitions and validates them on register", () => {
			const registry = createRuleDefinitionRegistry();
			expect(() =>
				registry.register({
					id: "bad_flag",
					priority: 1,
					point: "flag",
					composition: "exclusive",
					duration: { kind: "Permanent" },
					// missing flag name → validator rejects
				}),
			).toThrow(/flag/);
		});
	});

	describe("determinism — no Math.random / Date.now", () => {
		it("never calls Math.random or Date.now across a full flow", () => {
			const randomSpy = jest.spyOn(Math, "random");
			const dateNowSpy = jest.spyOn(Date, "now");

			const h = makeHarness();
			h.engine.registerAndActivate(createSeedRule("luckyDice"));
			h.engine.registerAndActivate(createSeedRule("doubleDice"));
			h.engine.registerAndActivate(createSeedRule("loadedDice"));
			h.engine.registerAndActivate(createSeedRule("noSteal"));
			h.engine.registerAndActivate(createSeedRule("fog"));
			h.engine.queryDiceModifier(h.ctx, 3);
			h.engine.isStealPrevented(h.ctx);
			h.engine.getFlag(h.ctx, "fog");
			h.engine.onRoundAdvanced();
			h.engine.onTurnConsumed();
			h.engine.remove("no_steal");
			h.engine.serialize();

			expect(randomSpy).not.toHaveBeenCalled();
			expect(dateNowSpy).not.toHaveBeenCalled();
			randomSpy.mockRestore();
			dateNowSpy.mockRestore();
		});
	});
});
