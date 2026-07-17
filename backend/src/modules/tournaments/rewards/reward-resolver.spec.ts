import { Logger } from "@nestjs/common";

import {
	ActionConfig,
	ActionContext,
	ActionServices,
	ExecutionResult,
} from "../actions/action.interface";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { AnyTournamentEvent } from "../events/tournament-event.types";
import { ManualClock } from "../infra/clock";
import { Registry } from "../registry/registry";
import { TournamentRewardResolver } from "./reward-resolver";
import { createRewardRegistry } from "./reward-registry";
import { RewardActionRunner, RewardDefinition, Reward } from "./reward.types";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PLAYER_ID = 10;

/** Recording action runner: captures every `run` call and returns canned results. */
class RecordingActionRunner implements RewardActionRunner {
	readonly calls: {
		configs: readonly ActionConfig[];
		context: ActionContext;
	}[] = [];
	constructor(private readonly results: ExecutionResult[] = []) {}
	run(
		configs: readonly ActionConfig[],
		context: ActionContext,
	): ExecutionResult[] {
		this.calls.push({ configs, context });
		return [...this.results];
	}
}

interface Harness {
	resolver: TournamentRewardResolver;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
	runner: RecordingActionRunner;
	registry: Registry<RewardDefinition>;
}

function makeResolver(
	overrides: {
		actionRunner?: RewardActionRunner;
		registry?: Registry<RewardDefinition>;
		results?: ExecutionResult[];
		getRound?: () => number;
	} = {},
): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((event) => events.push(event));
	const runner =
		(overrides.actionRunner as RecordingActionRunner) ??
		new RecordingActionRunner(overrides.results ?? [{ status: "success" }]);
	const registry = overrides.registry ?? createRewardRegistry();
	const resolver = new TournamentRewardResolver({
		tournamentId: TOURNAMENT_ID,
		bus,
		clock,
		registry,
		actionRunner: runner,
		getRound: overrides.getRound,
	});
	return { resolver, bus, clock, events, runner, registry };
}

/** Minimal ActionContext (the Resolver only threads it to the runner). */
function makeContext(bus: TournamentEventBus, playerId = PLAYER_ID): ActionContext {
	const services = {} as ActionServices;
	return {
		tournamentId: TOURNAMENT_ID,
		playerId,
		round: 0,
		eventBus: bus,
		services,
	};
}

function names(events: AnyTournamentEvent[]): string[] {
	return events.map((event) => event.name);
}

function eventNamed(
	events: AnyTournamentEvent[],
	name: string,
): AnyTournamentEvent | undefined {
	return events.find((event) => event.name === name);
}

describe("TournamentRewardResolver (SPEC-013)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "verbose").mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	// ── points → single awardPoints config; RewardGranted then RewardResolved ──

	it("translates a points reward into one awardPoints config and resolves it", () => {
		const { resolver, bus, events, runner } = makeResolver();
		const reward: Reward = {
			id: "victoryPoints",
			type: "points",
			payload: { amount: 500, reason: "victory", source: "minigame" },
		};

		const result = resolver.grant(reward, makeContext(bus));

		expect(result.status).toBe("resolved");
		if (result.status === "resolved") {
			expect(result.rewardId).toBe("victoryPoints");
			expect(result.results).toEqual([{ status: "success" }]);
		}

		// The runner received exactly one awardPoints config with the payload.
		expect(runner.calls).toHaveLength(1);
		expect(runner.calls[0].configs).toHaveLength(1);
		expect(runner.calls[0].configs[0]).toMatchObject({
			type: "awardPoints",
			parameters: { amount: 500, reason: "victory", source: "minigame" },
		});

		// RewardGranted BEFORE RewardResolved.
		expect(names(events)).toEqual(["RewardGranted", "RewardResolved"]);
		expect(eventNamed(events, "RewardGranted")?.payload).toEqual({
			rewardId: "victoryPoints",
			type: "points",
		});
		expect(eventNamed(events, "RewardResolved")?.payload).toEqual({
			rewardId: "victoryPoints",
			type: "points",
			actionStatuses: ["success"],
		});
	});

	// ── rule → activateRule config ─────────────────────────────────────────────

	it("translates a rule reward into an activateRule config", () => {
		const { resolver, bus, runner } = makeResolver();
		const reward: Reward = {
			id: "bonusRule",
			type: "rule",
			payload: { ruleId: "doublePoints", point: "reward" },
		};

		const result = resolver.grant(reward, makeContext(bus));
		expect(result.status).toBe("resolved");
		expect(runner.calls[0].configs[0]).toMatchObject({
			type: "activateRule",
			parameters: { ruleId: "doublePoints", point: "reward" },
		});
	});

	// ── item → grantItem forward seam ──────────────────────────────────────────

	it("translates an item reward into a grantItem config (forward seam)", () => {
		const { resolver, bus, runner } = makeResolver();
		const reward: Reward = {
			id: "freeDice",
			type: "item",
			payload: { itemId: "luckyDice" },
		};

		expect(resolver.grant(reward, makeContext(bus)).status).toBe("resolved");
		expect(runner.calls[0].configs[0]).toMatchObject({
			type: "grantItem",
			parameters: { itemId: "luckyDice" },
		});
	});

	// ── composite → started before, flattened children, finished after ─────────

	it("fans out a composite reward: started, flattened children, finished, resolved", () => {
		const { resolver, bus, events, runner } = makeResolver({
			results: [{ status: "success" }, { status: "success" }],
		});
		const reward: Reward = {
			id: "victoryBundle",
			type: "composite",
			payload: {
				rewards: [
					{ id: "c1", type: "points", payload: { amount: 100 } },
					{ id: "c2", type: "rule", payload: { ruleId: "shield" } },
				],
			},
		};

		const result = resolver.grant(reward, makeContext(bus));
		expect(result.status).toBe("resolved");

		// Both children flattened into a single runner call, in order.
		expect(runner.calls).toHaveLength(1);
		expect(runner.calls[0].configs.map((c) => c.type)).toEqual([
			"awardPoints",
			"activateRule",
		]);

		// Composite events wrap the resolution; RewardResolved is last.
		expect(names(events)).toEqual([
			"RewardGranted",
			"CompositeRewardStarted",
			"CompositeRewardFinished",
			"RewardResolved",
		]);
		expect(eventNamed(events, "CompositeRewardStarted")?.payload).toEqual({
			rewardId: "victoryBundle",
			childCount: 2,
		});
		expect(eventNamed(events, "CompositeRewardFinished")?.payload).toEqual({
			rewardId: "victoryBundle",
			resolvedCount: 2,
		});
	});

	// ── composite with one un-translatable child (SPEC-013 partial) ────────────

	it("resolves only the valid children of a partially-invalid composite and warns", () => {
		const warnSpy = jest.spyOn(Logger.prototype, "warn");
		const { resolver, bus, events, runner } = makeResolver();
		const reward: Reward = {
			id: "mixedBundle",
			type: "composite",
			payload: {
				rewards: [
					{ id: "good", type: "points", payload: { amount: 50 } },
					// Missing id → not a valid Reward → skipped with a warning.
					{ type: "points", payload: { amount: 999 } },
				],
			},
		};

		const result = resolver.grant(reward, makeContext(bus));
		expect(result.status).toBe("resolved");

		// Only the valid child produced a config.
		expect(runner.calls[0].configs.map((c) => c.type)).toEqual(["awardPoints"]);
		expect(eventNamed(events, "CompositeRewardStarted")?.payload).toMatchObject({
			childCount: 2,
		});
		expect(eventNamed(events, "CompositeRewardFinished")?.payload).toEqual({
			rewardId: "mixedBundle",
			resolvedCount: 1,
		});
		expect(warnSpy).toHaveBeenCalled();
	});

	// ── unknown type → RewardRejected + rejected, runner NOT called ────────────

	it("rejects an unknown reward type and never calls the runner", () => {
		const { resolver, bus, events, runner } = makeResolver();
		const reward = {
			id: "mystery",
			type: "teleport",
		} as unknown as Reward;

		const result = resolver.grant(reward, makeContext(bus));
		expect(result.status).toBe("rejected");
		if (result.status === "rejected") {
			expect(result.reason).toBe("unknown_type");
		}
		expect(runner.calls).toHaveLength(0);
		expect(names(events)).toEqual(["RewardRejected"]);
		expect(eventNamed(events, "RewardRejected")?.payload).toEqual({
			rewardId: "mystery",
			type: "teleport",
			reason: "unknown_type",
		});
	});

	// ── future → legitimate resolved no-op (NOT a rejection) ───────────────────

	it("resolves a future reward as a no-op with empty configs, not a rejection", () => {
		const { resolver, bus, events, runner } = makeResolver({ results: [] });
		const reward: Reward = { id: "later", type: "future" };

		const result = resolver.grant(reward, makeContext(bus));
		expect(result.status).toBe("resolved");
		if (result.status === "resolved") {
			expect(result.results).toEqual([]);
		}
		// Contract: the runner IS called, with an empty config list.
		expect(runner.calls).toHaveLength(1);
		expect(runner.calls[0].configs).toEqual([]);
		expect(names(events)).toEqual(["RewardGranted", "RewardResolved"]);
	});

	// ── conditions propagate onto every generated ActionConfig ─────────────────

	it("propagates the reward's conditions onto every generated ActionConfig", () => {
		const { resolver, bus, runner } = makeResolver();
		const condition = { type: "hasEnoughPoints", parameters: { amount: 1 } };
		const reward: Reward = {
			id: "gated",
			type: "points",
			payload: { amount: 10 },
			conditions: [condition],
		};

		resolver.grant(reward, makeContext(bus));
		for (const config of runner.calls[0].configs) {
			expect(config.conditions).toEqual([condition]);
		}
	});

	it("propagates a composite's conditions onto every flattened child config", () => {
		const { resolver, bus, runner } = makeResolver({
			results: [{ status: "success" }, { status: "success" }],
		});
		const condition = { type: "playerAlive" };
		const reward: Reward = {
			id: "gatedBundle",
			type: "composite",
			conditions: [condition],
			payload: {
				rewards: [
					{ id: "c1", type: "points", payload: { amount: 1 } },
					{ id: "c2", type: "rule", payload: { ruleId: "x" } },
				],
			},
		};

		resolver.grant(reward, makeContext(bus));
		expect(runner.calls[0].configs).toHaveLength(2);
		for (const config of runner.calls[0].configs) {
			expect(config.conditions).toEqual([condition]);
		}
	});

	// ── no_actions: a points reward without an amount ──────────────────────────

	it("rejects a points reward with no amount as no_actions", () => {
		const { resolver, bus, runner } = makeResolver();
		const reward: Reward = { id: "empty", type: "points", payload: {} };

		const result = resolver.grant(reward, makeContext(bus));
		expect(result.status).toBe("rejected");
		if (result.status === "rejected") {
			expect(result.reason).toBe("no_actions");
		}
		expect(runner.calls).toHaveLength(0);
	});

	// ── grantById ──────────────────────────────────────────────────────────────

	it("grantById resolves a registered reward and rejects an unknown id", () => {
		const registry = createRewardRegistry({ seed: true });
		const { resolver, bus } = makeResolver({ registry });

		const ok = resolver.grantById("victoryPoints", makeContext(bus));
		expect(ok.status).toBe("resolved");

		const missing = resolver.grantById("does-not-exist", makeContext(bus));
		expect(missing.status).toBe("rejected");
		if (missing.status === "rejected") {
			expect(missing.reason).toBe("invalid_config");
		}
	});

	// ── runner that throws → grant still returns (no throw escapes) ─────────────

	it("keeps going when the action runner throws, treating results as empty", () => {
		const throwingRunner: RewardActionRunner = {
			run: () => {
				throw new Error("engine boom");
			},
		};
		const { resolver, bus, events } = makeResolver({
			actionRunner: throwingRunner,
		});
		const reward: Reward = { id: "p", type: "points", payload: { amount: 5 } };

		const result = resolver.grant(reward, makeContext(bus));
		expect(result.status).toBe("resolved");
		if (result.status === "resolved") {
			expect(result.results).toEqual([]);
		}
		expect(eventNamed(events, "RewardResolved")?.payload).toMatchObject({
			actionStatuses: [],
		});
	});

	// ── determinism (SPEC-028): no Math.random, no Date.now ────────────────────

	it("never calls Math.random or Date.now", () => {
		const randomSpy = jest.spyOn(Math, "random");
		const dateNowSpy = jest.spyOn(Date, "now");
		const { resolver, bus } = makeResolver();

		resolver.grant(
			{ id: "p", type: "points", payload: { amount: 5 } },
			makeContext(bus),
		);
		resolver.grant(
			{
				id: "b",
				type: "composite",
				payload: { rewards: [{ id: "c", type: "rule", payload: { ruleId: "r" } }] },
			},
			makeContext(bus),
		);
		resolver.grant({ id: "f", type: "future" }, makeContext(bus));
		resolver.serialize();

		expect(randomSpy).not.toHaveBeenCalled();
		expect(dateNowSpy).not.toHaveBeenCalled();
	});

	// ── serialize() JSON round-trip ────────────────────────────────────────────

	it("serialize() produces a JSON-safe snapshot that round-trips", () => {
		const registry = createRewardRegistry({ seed: true });
		const { resolver } = makeResolver({ registry });

		const snapshot = resolver.serialize();
		const roundTripped = JSON.parse(JSON.stringify(snapshot));
		expect(roundTripped).toEqual(snapshot);
		expect(roundTripped.tournamentId).toBe(TOURNAMENT_ID);
		expect(roundTripped.rewardCount).toBe(registry.getAll().length);
	});

	// ── getRound flows into event envelopes ────────────────────────────────────

	it("stamps the current round from getRound onto emitted events", () => {
		const { resolver, bus, events } = makeResolver({ getRound: () => 7 });
		resolver.grant(
			{ id: "p", type: "points", payload: { amount: 5 } },
			makeContext(bus),
		);
		expect(events.every((e) => e.round === 7)).toBe(true);
	});
});
