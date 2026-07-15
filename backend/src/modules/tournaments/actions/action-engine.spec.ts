/**
 * action-engine.spec.ts — SPEC-008 Action Engine unit tests.
 *
 * Everything is tested in COMPLETE isolation with fake services (plain objects
 * satisfying the capability ports) — never Board/Runtime/Networking/UI
 * (SPEC-008 "Testing"). Covers: the pipeline (conditions pass → execute; any
 * condition false → skipped, no execute; validate skip/fail short-circuit);
 * result-mirroring (economy reject ⇒ failed, never success); internal error ⇒
 * logged `failed`, never thrown, engine keeps going; CompositeAction child
 * aggregation; ActionRegistry/Factory build-from-config incl. unknown-type and
 * invalid-config safe-skip; each base action drives the right port; automatic
 * logging via clock deltas; determinism (no Math.random / Date.now); and
 * `serialize()` JSON round-trips.
 */

import { ManualClock, TimerHandle, TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	EconomyResult,
	EconomySource,
} from "../economy/tournament-economy";
import { RuleConfig } from "../rules/configured-rule";
import { IRule, RuleContext } from "../rules/rule.interface";
import { ActionEngine } from "./action-engine";
import {
	ActionFactory,
	ActionRegistry,
	ConditionRegistry,
} from "./action-registry";
import {
	ActionContext,
	EconomyCommands,
	ExecutionResult,
	IAction,
	ICondition,
	RuleCommands,
	failedResult,
	skippedResult,
	successResult,
} from "./action.interface";
import {
	AwardPointsAction,
	registerBaseActions,
	registerBaseActionsAndConditions,
	registerKeyItemActions,
} from "./base-actions";
import { registerBaseConditions } from "./base-conditions";

// ── Fakes (plain objects satisfying the ports) ──────────────────────────────

const okTransaction = (playerId: number, amount: number) => ({
	id: "tx-1",
	timestamp: 0,
	playerId,
	amount,
	operation: "award" as const,
	reason: "r",
	source: "rule" as EconomySource,
});

const ECONOMY_SUCCESS = (playerId = 1, amount = 10): EconomyResult => ({
	status: "success",
	transaction: okTransaction(playerId, amount),
});

const ECONOMY_REJECTED: EconomyResult = {
	status: "rejected",
	rejection: "insufficient_balance",
};

interface Call {
	readonly [key: string]: unknown;
}

class FakeEconomy implements EconomyCommands {
	awardCalls: Call[] = [];
	removeCalls: Call[] = [];
	transferCalls: Call[] = [];
	balanceCalls: number[] = [];

	awardResult: EconomyResult = ECONOMY_SUCCESS();
	removeResult: EconomyResult = ECONOMY_SUCCESS();
	transferResult: EconomyResult = ECONOMY_SUCCESS();
	balance: number | undefined = 100;

	award(playerId: number, amount: number, reason: string, source: EconomySource) {
		this.awardCalls.push({ playerId, amount, reason, source });
		return this.awardResult;
	}
	remove(playerId: number, amount: number, reason: string, source: EconomySource) {
		this.removeCalls.push({ playerId, amount, reason, source });
		return this.removeResult;
	}
	transfer(
		fromPlayerId: number,
		toPlayerId: number,
		amount: number,
		reason: string,
		source: EconomySource,
	) {
		this.transferCalls.push({ fromPlayerId, toPlayerId, amount, reason, source });
		return this.transferResult;
	}
	getBalance(playerId: number): number | undefined {
		this.balanceCalls.push(playerId);
		return this.balance;
	}
}

class FakeRules implements RuleCommands {
	registerCalls: IRule[] = [];
	activateCalls: { id: string; ctx?: Partial<RuleContext> }[] = [];
	applyForPlayerCalls: { config: RuleConfig; playerId: number }[] = [];
	deactivateCalls: string[] = [];
	removeCalls: string[] = [];

	activateResult = true;
	deactivateResult = true;
	applyForPlayerResult = true;

	register(rule: IRule): boolean {
		this.registerCalls.push(rule);
		return true;
	}
	activate(id: string, ctx?: Partial<RuleContext>): boolean {
		this.activateCalls.push({ id, ctx });
		return this.activateResult;
	}
	applyForPlayer(config: RuleConfig, playerId: number): boolean {
		this.applyForPlayerCalls.push({ config, playerId });
		return this.applyForPlayerResult;
	}
	deactivate(id: string): boolean {
		this.deactivateCalls.push(id);
		return this.deactivateResult;
	}
	remove(id: string): boolean {
		this.removeCalls.push(id);
		return true;
	}
}

/** Clock that returns a scripted sequence of `now()` values (for durations). */
class StepClock implements TournamentClock {
	private index = 0;
	constructor(private readonly values: number[]) {}
	now(): number {
		const value = this.values[Math.min(this.index, this.values.length - 1)];
		this.index += 1;
		return value;
	}
	schedule(): TimerHandle {
		return { id: 0 };
	}
	cancel(): void {
		/* no-op */
	}
}

// ── Test doubles for IAction / ICondition ───────────────────────────────────

class SpyAction implements IAction {
	executed = false;
	constructor(
		private readonly _conditions: ICondition[] = [],
		private readonly validateOutcome: ExecutionResult = successResult(),
		private readonly executeResult: ExecutionResult = successResult(),
	) {}
	id(): string {
		return "spy";
	}
	conditions(): readonly ICondition[] {
		return this._conditions;
	}
	validate(): ExecutionResult {
		return this.validateOutcome;
	}
	execute(): ExecutionResult {
		this.executed = true;
		return this.executeResult;
	}
	serialize() {
		return { type: "spy" };
	}
}

class ThrowingAction implements IAction {
	id(): string {
		return "boom";
	}
	conditions(): readonly ICondition[] {
		return [];
	}
	validate(): ExecutionResult {
		return successResult();
	}
	execute(): ExecutionResult {
		throw new Error("kaboom");
	}
	serialize() {
		return { type: "boom" };
	}
}

const constCondition = (value: boolean): ICondition => ({
	id: () => `const:${value}`,
	evaluate: () => value,
});

const throwingCondition = (): ICondition => ({
	id: () => "throws",
	evaluate: () => {
		throw new Error("condition blew up");
	},
});

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
	engine: ActionEngine;
	economy: FakeEconomy;
	rules: FakeRules;
	ctx: ActionContext;
}

function makeHarness(clock: TournamentClock = new ManualClock(1_000)): Harness {
	const economy = new FakeEconomy();
	const rules = new FakeRules();
	const engine = new ActionEngine({ clock });
	const ctx: ActionContext = {
		tournamentId: "t-1",
		playerId: 1,
		round: 3,
		eventBus: new TournamentEventBus(),
		services: { economy, rules },
	};
	return { engine, economy, rules, ctx };
}

function makeFactory(engine?: ActionEngine): {
	actions: ActionRegistry;
	conditions: ConditionRegistry;
	factory: ActionFactory;
} {
	const actions = new ActionRegistry();
	const conditions = new ConditionRegistry();
	registerBaseActionsAndConditions(actions, conditions);
	registerKeyItemActions(actions);
	const factory = new ActionFactory(actions, conditions, { engine });
	return { actions, conditions, factory };
}

// Silence + observe the automatic logging on every TournamentLogger instance.
let debugSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
	debugSpy = jest
		.spyOn(TournamentLogger.prototype, "debug")
		.mockImplementation(() => undefined);
	warnSpy = jest
		.spyOn(TournamentLogger.prototype, "warn")
		.mockImplementation(() => undefined);
	errorSpy = jest
		.spyOn(TournamentLogger.prototype, "error")
		.mockImplementation(() => undefined);
});

afterEach(() => {
	jest.restoreAllMocks();
});

// ── Pipeline (SPEC-008 "Flujo") ─────────────────────────────────────────────

describe("ActionEngine pipeline (SPEC-008)", () => {
	it("runs execute() when all conditions pass", () => {
		const { engine, ctx } = makeHarness();
		const action = new SpyAction([constCondition(true), constCondition(true)]);
		const result = engine.execute(action, ctx);
		expect(action.executed).toBe(true);
		expect(result.status).toBe("success");
	});

	it("skips (does NOT execute) when any condition is false", () => {
		const { engine, ctx } = makeHarness();
		const action = new SpyAction([constCondition(true), constCondition(false)]);
		const result = engine.execute(action, ctx);
		expect(action.executed).toBe(false);
		expect(result.status).toBe("skipped");
	});

	it("returns validate() outcome without executing when it is not success", () => {
		const { engine, ctx } = makeHarness();
		const skip = new SpyAction([], skippedResult("nope"));
		expect(engine.execute(skip, ctx)).toMatchObject({ status: "skipped" });
		expect(skip.executed).toBe(false);

		const fail = new SpyAction([], failedResult("bad"));
		expect(engine.execute(fail, ctx)).toMatchObject({ status: "failed" });
		expect(fail.executed).toBe(false);
	});
});

// ── Error containment (SPEC-008 "Casos límite") ─────────────────────────────

describe("ActionEngine error containment (SPEC-008)", () => {
	it("turns a thrown error into a logged failed result, never throws", () => {
		const { engine, ctx } = makeHarness();
		let result: ExecutionResult | undefined;
		expect(() => {
			result = engine.execute(new ThrowingAction(), ctx);
		}).not.toThrow();
		expect(result?.status).toBe("failed");
		expect(errorSpy).toHaveBeenCalled();
	});

	it("keeps going after a failing action (never stops the tournament)", () => {
		const { engine, ctx } = makeHarness();
		engine.execute(new ThrowingAction(), ctx);
		const next = new SpyAction();
		const result = engine.execute(next, ctx);
		expect(result.status).toBe("success");
		expect(next.executed).toBe(true);
	});

	it("treats a throwing condition as a failed result (internal error)", () => {
		const { engine, ctx } = makeHarness();
		const action = new SpyAction([throwingCondition()]);
		const result = engine.execute(action, ctx);
		expect(result.status).toBe("failed");
		expect(action.executed).toBe(false);
	});
});

// ── Automatic logging (SPEC-008 "Logging") ──────────────────────────────────

describe("ActionEngine automatic logging (SPEC-008)", () => {
	it("logs Start + Finish and measures Duration from the clock", () => {
		const clock = new StepClock([100, 130]); // start=100, finish=130
		const { engine, ctx } = makeHarness(clock);
		engine.execute(new SpyAction(), ctx);

		const start = debugSpy.mock.calls.find(([msg]) =>
			String(msg).includes("Action start"),
		);
		const finish = debugSpy.mock.calls.find(([msg]) =>
			String(msg).includes("Action finish"),
		);
		expect(start).toBeDefined();
		expect(finish).toBeDefined();
		expect((finish?.[1] as { metadata?: { durationMs?: number } })?.metadata?.durationMs).toBe(30);
		expect((finish?.[1] as { metadata?: { status?: string } })?.metadata?.status).toBe("success");
	});
});

// ── Result mirroring (SPEC-008 "Comandos y Eventos") ────────────────────────

describe("Economy result mirroring (SPEC-008)", () => {
	it("mirrors a rejected economy command to failed, never success", () => {
		const { engine, economy, ctx } = makeHarness();
		economy.awardResult = ECONOMY_REJECTED;
		const action = new AwardPointsAction({
			type: "awardPoints",
			parameters: { amount: 10 },
			conditions: [],
			factory: undefined as never,
		});
		const result = engine.execute(action, ctx);
		expect(result.status).toBe("failed");
		expect(result).toMatchObject({ detail: { rejection: "insufficient_balance" } });
	});

	it("mirrors a successful economy command to success with the transaction id", () => {
		const { engine, economy, ctx } = makeHarness();
		economy.awardResult = ECONOMY_SUCCESS(1, 10);
		const action = new AwardPointsAction({
			type: "awardPoints",
			parameters: { amount: 10 },
			conditions: [],
			factory: undefined as never,
		});
		const result = engine.execute(action, ctx);
		expect(result).toMatchObject({
			status: "success",
			detail: { transactionId: "tx-1" },
		});
	});
});

// ── Base actions drive the right port (fake services) ───────────────────────

describe("Base actions drive the right port (SPEC-008/011/009)", () => {
	function build(engine: ActionEngine, config: {
		type: string;
		parameters?: Record<string, unknown>;
	}): IAction {
		const { factory } = makeFactory(engine);
		const action = factory.create({
			type: config.type,
			parameters: config.parameters,
		});
		if (!action) {
			throw new Error(`could not build ${config.type}`);
		}
		return action;
	}

	it("awardPoints → economy.award with resolved player + defaults", () => {
		const { engine, economy, ctx } = makeHarness();
		const action = build(engine, { type: "awardPoints", parameters: { amount: 7 } });
		expect(engine.execute(action, ctx).status).toBe("success");
		expect(economy.awardCalls).toEqual([
			{ playerId: 1, amount: 7, reason: "action:awardPoints", source: "rule" },
		]);
	});

	it("awardPoints honours an explicit playerId/source/reason", () => {
		const { engine, economy, ctx } = makeHarness();
		const action = build(engine, {
			type: "awardPoints",
			parameters: { amount: 3, playerId: 9, source: "boss", reason: "x" },
		});
		engine.execute(action, ctx);
		expect(economy.awardCalls[0]).toEqual({
			playerId: 9,
			amount: 3,
			reason: "x",
			source: "boss",
		});
	});

	it("removePoints → economy.remove", () => {
		const { engine, economy, ctx } = makeHarness();
		const action = build(engine, { type: "removePoints", parameters: { amount: 4 } });
		engine.execute(action, ctx);
		expect(economy.removeCalls).toEqual([
			{ playerId: 1, amount: 4, reason: "action:removePoints", source: "rule" },
		]);
	});

	it("transferPoints → economy.transfer with steal source default", () => {
		const { engine, economy, ctx } = makeHarness();
		const action = build(engine, {
			type: "transferPoints",
			parameters: { amount: 5, toPlayerId: 2 },
		});
		engine.execute(action, ctx);
		expect(economy.transferCalls).toEqual([
			{ fromPlayerId: 1, toPlayerId: 2, amount: 5, reason: "action:transferPoints", source: "steal" },
		]);
	});

	it("transferPoints fails validation without a toPlayerId (no port call)", () => {
		const { engine, economy, ctx } = makeHarness();
		const action = build(engine, { type: "transferPoints", parameters: { amount: 5 } });
		expect(engine.execute(action, ctx).status).toBe("failed");
		expect(economy.transferCalls).toHaveLength(0);
	});

	it("activateRule → rules.activate (success) and failed on rejection", () => {
		const { engine, rules, ctx } = makeHarness();
		const action = build(engine, { type: "activateRule", parameters: { ruleId: "r1" } });
		expect(engine.execute(action, ctx).status).toBe("success");
		expect(rules.activateCalls).toEqual([
			{ id: "r1", ctx: { round: 3, playerId: 1 } },
		]);

		rules.activateResult = false;
		expect(engine.execute(action, ctx).status).toBe("failed");
	});

	it("activatePlayerRule → rules.applyForPlayer with the acting player + definition", () => {
		const { engine, rules, ctx } = makeHarness();
		const rule = {
			id: "shield",
			priority: 20,
			point: "steal" as const,
			composition: "exclusive" as const,
			duration: { kind: "UntilRemoved" as const },
			boolean: true,
		};
		const action = build(engine, {
			type: "activatePlayerRule",
			parameters: { rule },
		});
		expect(engine.execute(action, ctx).status).toBe("success");
		expect(rules.applyForPlayerCalls).toEqual([{ config: rule, playerId: 1 }]);

		rules.applyForPlayerResult = false;
		expect(engine.execute(action, ctx).status).toBe("failed");
	});

	it("activatePlayerRule fails validation without a `rule` object (no port call)", () => {
		const { engine, rules, ctx } = makeHarness();
		const action = build(engine, { type: "activatePlayerRule", parameters: {} });
		expect(engine.execute(action, ctx).status).toBe("failed");
		expect(rules.applyForPlayerCalls).toHaveLength(0);
	});

	it("unlockKeyItem → keyItems.unlock(actingPlayer); rejection ⇒ failed; absent ⇒ skipped", () => {
		const { engine, ctx } = makeHarness();
		const calls: (number | null)[] = [];
		let status: "unlocked" | "rejected" = "unlocked";
		const keyCtx: ActionContext = {
			...ctx,
			services: {
				...ctx.services,
				keyItems: {
					unlock: (by: number | null) => {
						calls.push(by);
						return { status };
					},
				},
			},
		};
		const action = build(engine, { type: "unlockKeyItem" });
		expect(engine.execute(action, keyCtx).status).toBe("success");
		expect(calls).toEqual([1]); // the acting player is recorded as unlockedBy

		status = "rejected";
		expect(engine.execute(action, keyCtx).status).toBe("failed");

		// No key-item service wired → benign skip, never a crash.
		expect(engine.execute(action, ctx).status).toBe("skipped");
	});

	it("deactivateRule → rules.deactivate; a no-op is skipped, not failed", () => {
		const { engine, rules, ctx } = makeHarness();
		const action = build(engine, { type: "deactivateRule", parameters: { ruleId: "r1" } });
		expect(engine.execute(action, ctx).status).toBe("success");
		expect(rules.deactivateCalls).toEqual(["r1"]);

		rules.deactivateResult = false;
		expect(engine.execute(action, ctx).status).toBe("skipped");
	});
});

// ── Conditions (SPEC-008 "Conditions") ──────────────────────────────────────

describe("Base conditions (SPEC-008)", () => {
	function buildConditionAction(
		engine: ActionEngine,
		conditionType: string,
		parameters: Record<string, unknown>,
	): IAction {
		const { factory } = makeFactory(engine);
		const action = factory.create({
			type: "awardPoints",
			parameters: { amount: 1 },
			conditions: [{ type: conditionType, parameters }],
		});
		if (!action) {
			throw new Error("build failed");
		}
		return action;
	}

	it("hasEnoughPoints reads the balance port and gates on it", () => {
		const { engine, economy, ctx } = makeHarness();
		economy.balance = 50;
		const pass = buildConditionAction(engine, "hasEnoughPoints", { amount: 40 });
		expect(engine.execute(pass, ctx).status).toBe("success");
		expect(economy.balanceCalls).toContain(1);

		economy.balance = 10;
		const fail = buildConditionAction(engine, "hasEnoughPoints", { amount: 40 });
		expect(engine.execute(fail, ctx).status).toBe("skipped");
	});

	it("currentRoundIs / minRound gate on the context round", () => {
		const { engine, ctx } = makeHarness(); // round 3
		expect(engine.execute(buildConditionAction(engine, "currentRoundIs", { round: 3 }), ctx).status).toBe("success");
		expect(engine.execute(buildConditionAction(engine, "currentRoundIs", { round: 4 }), ctx).status).toBe("skipped");
		expect(engine.execute(buildConditionAction(engine, "minRound", { round: 2 }), ctx).status).toBe("success");
		expect(engine.execute(buildConditionAction(engine, "minRound", { round: 5 }), ctx).status).toBe("skipped");
	});
});

// ── Registry / Factory (SPEC-008 "Action Registry"/"Casos límite") ──────────

describe("ActionRegistry + ActionFactory (SPEC-008)", () => {
	it("builds an action from config (id === type)", () => {
		const { factory } = makeFactory();
		const action = factory.create({ type: "awardPoints", parameters: { amount: 1 } });
		expect(action?.id()).toBe("awardPoints");
	});

	it("returns null + logs for an unknown action type (safe skip)", () => {
		const { factory } = makeFactory();
		expect(factory.create({ type: "doesNotExist" })).toBeNull();
		expect(warnSpy).toHaveBeenCalled();
	});

	it("returns null + logs for invalid config (missing type)", () => {
		const { factory } = makeFactory();
		expect(factory.create({ type: "" })).toBeNull();
		expect(factory.create(undefined as never)).toBeNull();
	});

	it("drops an unknown condition but still builds the action", () => {
		const { factory } = makeFactory();
		const action = factory.create({
			type: "awardPoints",
			parameters: { amount: 1 },
			conditions: [{ type: "nope" }, { type: "alwaysTrue" }],
		});
		expect(action).not.toBeNull();
		expect(action?.serialize().conditions).toEqual([{ type: "alwaysTrue" }]);
	});

	it("throws on duplicate registration at boot", () => {
		const actions = new ActionRegistry();
		registerBaseActions(actions);
		expect(() => registerBaseActions(actions)).toThrow(/duplicate/);
	});

	it("throws on blank type registration", () => {
		const conditions = new ConditionRegistry();
		expect(() => conditions.register("", () => constCondition(true))).toThrow();
	});
});

// ── Composite (SPEC-008 "Composite Actions") ────────────────────────────────

describe("CompositeAction (SPEC-008)", () => {
	it("runs children through the engine and aggregates to success", () => {
		const { engine, economy, ctx } = makeHarness();
		const { factory } = makeFactory(engine);
		const composite = factory.create({
			type: "composite",
			parameters: {
				children: [
					{ type: "awardPoints", parameters: { amount: 5 } },
					{ type: "removePoints", parameters: { amount: 2 } },
				],
			},
		});
		const result = engine.execute(composite, ctx);
		expect(result).toMatchObject({ status: "success", detail: { children: ["success", "success"], count: 2 } });
		expect(economy.awardCalls).toHaveLength(1);
		expect(economy.removeCalls).toHaveLength(1);
	});

	it("aggregates to failed when any child fails", () => {
		const { engine, economy, ctx } = makeHarness();
		economy.removeResult = ECONOMY_REJECTED;
		const { factory } = makeFactory(engine);
		const composite = factory.create({
			type: "composite",
			parameters: {
				children: [
					{ type: "awardPoints", parameters: { amount: 5 } },
					{ type: "removePoints", parameters: { amount: 2 } },
				],
			},
		});
		const result = engine.execute(composite, ctx);
		expect(result.status).toBe("failed");
		// All children still ran (no short-circuit).
		expect(economy.awardCalls).toHaveLength(1);
		expect(economy.removeCalls).toHaveLength(1);
	});

	it("a skipped child does not fail the composite", () => {
		const { engine, ctx } = makeHarness();
		const { factory } = makeFactory(engine);
		const composite = factory.create({
			type: "composite",
			parameters: {
				children: [
					{ type: "awardPoints", parameters: { amount: 5 } },
					{
						type: "awardPoints",
						parameters: { amount: 5 },
						conditions: [{ type: "minRound", parameters: { round: 99 } }],
					},
				],
			},
		});
		const result = engine.execute(composite, ctx);
		expect(result).toMatchObject({ status: "success", detail: { children: ["success", "skipped"] } });
	});
});

// ── Determinism (SPEC-028 via SPEC-008 "Reglas Fundamentales") ──────────────

describe("Determinism (SPEC-008)", () => {
	it("never calls Math.random or Date.now across a full scenario", () => {
		const randomSpy = jest.spyOn(Math, "random");
		const dateNowSpy = jest.spyOn(Date, "now");
		const clock = new ManualClock(0);
		const { engine, ctx } = makeHarness(clock);
		const { factory } = makeFactory(engine);
		const composite = factory.create({
			type: "composite",
			parameters: {
				children: [
					{
						type: "awardPoints",
						parameters: { amount: 5 },
						conditions: [{ type: "alwaysTrue" }, { type: "minRound", parameters: { round: 1 } }],
					},
					{ type: "activateRule", parameters: { ruleId: "r1" } },
				],
			},
		});
		engine.execute(composite, ctx);
		expect(randomSpy).not.toHaveBeenCalled();
		expect(dateNowSpy).not.toHaveBeenCalled();
	});
});

// ── serialize() JSON round-trip (SPEC-008 `serialize()`) ────────────────────

describe("serialize() (SPEC-008)", () => {
	it("produces JSON-safe output that round-trips", () => {
		const { factory } = makeFactory();
		const action = factory.create({
			type: "awardPoints",
			parameters: { amount: 10, source: "boss" },
			conditions: [
				{ type: "hasEnoughPoints", parameters: { amount: 10 } },
				{ type: "alwaysTrue" },
			],
			metadata: { note: "chest" },
			priority: 5,
		});
		const serialized = action?.serialize();
		const roundTrip = JSON.parse(JSON.stringify(serialized));
		expect(roundTrip).toEqual(serialized);
		expect(roundTrip).toMatchObject({
			type: "awardPoints",
			parameters: { amount: 10, source: "boss" },
			conditions: [
				{ type: "hasEnoughPoints", parameters: { amount: 10 } },
				{ type: "alwaysTrue" },
			],
			metadata: { note: "chest" },
			priority: 5,
		});
	});
});

// Keep the imports used (registerBaseConditions is exercised indirectly).
void registerBaseConditions;
