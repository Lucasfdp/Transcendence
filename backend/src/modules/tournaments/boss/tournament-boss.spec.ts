/**
 * tournament-boss.spec.ts — Boss System unit tests (SPEC-020).
 *
 * Covers: spawn only when every Key Item is unlocked; the spawn event sequence
 * (SpawnRequested→Spawned→RulesActivated→IntroCompleted) with the Final Challenge
 * id; intro Actions run through the runner; Rules activated ONLY via the Rule
 * controller; single-spawn (double spawn ignored); an intro error never breaks
 * the pipeline; finish removes the Rules (RulesRemoved→Finished) and is
 * idempotent; JSON-safe serialize; and no Date.now (injected clock only).
 */

import { Logger } from "@nestjs/common";

import { ActionConfig, ActionContext } from "../actions/action.interface";
import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { ManualClock } from "../infra/clock";
import { RuleConfig } from "../rules/configured-rule";
import { createBossRegistry, V1_BOSS_ID, V1_FINAL_CHALLENGE_ID } from "./boss-registry";
import { BossActionRunner } from "./boss.types";
import { TournamentBoss, TournamentBossOptions } from "./tournament-boss";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Records the Rules activated/removed through the Boss's Rule controller. */
class FakeRuleController {
	readonly activated: RuleConfig[] = [];
	readonly removed: string[] = [];
	failNext = false;
	activate(config: RuleConfig): string | null {
		if (this.failNext) {
			this.failNext = false;
			return null;
		}
		this.activated.push(config);
		return config.id;
	}
	remove(ruleId: string): void {
		this.removed.push(ruleId);
	}
}

/** Records intro runs; can throw to prove the pipeline survives. */
class FakeIntroRunner implements BossActionRunner {
	readonly runs: { configs: readonly ActionConfig[]; context: ActionContext }[] = [];
	throwOnRun = false;
	run(configs: readonly ActionConfig[], context: ActionContext): [] {
		this.runs.push({ configs, context });
		if (this.throwOnRun) {
			throw new Error("intro boom");
		}
		return [];
	}
}

interface Harness {
	boss: TournamentBoss;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
	rules: FakeRuleController;
	intro: FakeIntroRunner;
	complete: { value: boolean };
}

function makeBoss(overrides: Partial<TournamentBossOptions> = {}): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((e) => events.push(e));
	const rules = new FakeRuleController();
	const intro = new FakeIntroRunner();
	const complete = { value: true };
	const boss = new TournamentBoss({
		tournamentId: TOURNAMENT_ID,
		bus,
		clock,
		keyItems: { isComplete: () => complete.value },
		ruleController: rules,
		introRunner: intro,
		getRound: () => 5,
		...overrides,
	});
	return { boss, bus, clock, events, rules, intro, complete };
}

const names = (events: AnyTournamentEvent[]): string[] => events.map((e) => e.name);

describe("TournamentBoss (SPEC-020)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("spawns only when every Key Item is unlocked", () => {
		const { boss, complete, events } = makeBoss();
		complete.value = false;

		expect(boss.spawn()).toEqual({ status: "rejected", reason: "key_items_incomplete" });
		expect(boss.getState()).toBe("idle");
		expect(events).toHaveLength(0);
	});

	it("emits the spawn sequence and returns the Final Challenge id", () => {
		const { boss, events } = makeBoss();
		const result = boss.spawn();

		expect(result).toEqual({ status: "spawned", finalChallengeId: V1_FINAL_CHALLENGE_ID });
		expect(boss.getState()).toBe("active");
		expect(names(events)).toEqual([
			"BossSpawnRequested",
			"BossSpawned",
			"BossRulesActivated",
			"BossIntroCompleted",
		]);
		expect(events.find((e) => e.name === "BossIntroCompleted")?.payload).toEqual({
			bossId: V1_BOSS_ID,
			finalChallengeId: V1_FINAL_CHALLENGE_ID,
		});
		expect(events.every((e) => e.round === 5)).toBe(true);
	});

	it("activates the Boss Rules ONLY through the Rule controller", () => {
		const { boss, rules, events } = makeBoss();
		boss.spawn();

		// The v1 Boss activates No Robbery + Double Dice from the seed catalog.
		expect(rules.activated.map((r) => r.id)).toEqual(["no_steal", "double_dice"]);
		expect(events.find((e) => e.name === "BossRulesActivated")?.payload).toEqual({
			bossId: V1_BOSS_ID,
			ruleIds: ["no_steal", "double_dice"],
		});
	});

	it("skips Rules the controller could not activate", () => {
		const { boss, rules } = makeBoss();
		rules.failNext = true;
		boss.spawn();

		expect(boss.serialize().activeRuleIds).toEqual(["double_dice"]);
	});

	it("runs the intro Actions through the runner with a context", () => {
		const { boss, intro } = makeBoss();
		boss.spawn();

		expect(intro.runs).toHaveLength(1); // v1 intro is empty but still invoked
		expect(intro.runs[0].context.tournamentId).toBe(TOURNAMENT_ID);
		expect(intro.runs[0].context.round).toBe(5);
	});

	it("ignores a second spawn while already active", () => {
		const { boss, events } = makeBoss();
		boss.spawn();
		const emitted = events.length;

		expect(boss.spawn()).toEqual({ status: "ignored", reason: "already_active" });
		expect(events).toHaveLength(emitted);
	});

	it("an intro error never breaks the pipeline (Rules still activate)", () => {
		const { boss, intro, rules, events } = makeBoss();
		intro.throwOnRun = true;
		const result = boss.spawn();

		expect(result.status).toBe("spawned");
		expect(rules.activated).toHaveLength(2);
		expect(names(events)).toContain("BossIntroCompleted");
	});

	it("finish removes every Boss Rule and emits RulesRemoved + Finished", () => {
		const { boss, rules, events } = makeBoss();
		boss.spawn();
		boss.finish();

		expect(rules.removed).toEqual(["no_steal", "double_dice"]);
		expect(boss.getState()).toBe("finished");
		expect(names(events).slice(-2)).toEqual(["BossRulesRemoved", "BossFinished"]);
		expect(events.find((e) => e.name === "BossRulesRemoved")?.payload).toEqual({
			bossId: V1_BOSS_ID,
			ruleIds: ["no_steal", "double_dice"],
		});
	});

	it("finish is ignored when the Boss is not active", () => {
		const { boss, events, rules } = makeBoss();
		boss.finish();

		expect(events).toHaveLength(0);
		expect(rules.removed).toHaveLength(0);
		expect(boss.getState()).toBe("idle");

		boss.spawn();
		boss.finish();
		boss.finish(); // second finish after finishing: idempotent
		expect(names(events).filter((n) => n === "BossFinished")).toHaveLength(1);
	});

	it("serialize() is JSON-safe and reflects lifecycle + active Rules", () => {
		const { boss } = makeBoss();
		boss.spawn();
		const snapshot = boss.serialize();

		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(snapshot).toEqual({
			tournamentId: TOURNAMENT_ID,
			bossId: V1_BOSS_ID,
			state: "active",
			activeRuleIds: ["no_steal", "double_dice"],
		});
	});

	it("getFinalChallengeId exposes the configured Final Challenge", () => {
		const { boss } = makeBoss();
		expect(boss.getFinalChallengeId()).toBe(V1_FINAL_CHALLENGE_ID);
	});

	it("never calls Date.now (uses the injected clock)", () => {
		const dateNowSpy = jest.spyOn(Date, "now");
		const { boss } = makeBoss();
		boss.spawn();
		boss.finish();

		expect(dateNowSpy).not.toHaveBeenCalled();
	});

	it("the seeded registry validates and holds the v1 Boss", () => {
		const registry = createBossRegistry({ seed: true });
		expect(registry.get(V1_BOSS_ID).finalChallengeId).toBe(V1_FINAL_CHALLENGE_ID);
	});
});
