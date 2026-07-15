/**
 * tournament-final-challenge.spec.ts — Final Challenge System unit tests
 * (SPEC-021) + the Shell match state (SPEC-013 "ShellReward").
 *
 * Covers: start emits FinalChallengeStarted and runs the sudden death through
 * the SPEC-015 pipeline port; a unique winner → VictoryConditionReached →
 * Shell Reward through the Reward Resolver → frozen final ranking →
 * FinalChallengeFinished; a tie relaunches until a unique winner; a minigame
 * that cannot run stalls the challenge (stays active, resumable); double
 * start/finish guards; challenge-specific Rules from the definition; the Shell
 * holder's single grant + ShellGranted; JSON-safe serialize; no Date.now.
 */

import { Logger } from "@nestjs/common";

import { ActionContext } from "../actions/action.interface";
import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { ManualClock } from "../infra/clock";
import { MinigameRoundResult } from "../minigame/minigame.types";
import { GrantRewardResult, Reward } from "../rewards/reward.types";
import {
	createFinalChallengeRegistry,
	V1_FINAL_CHALLENGE_ID,
	validateFinalChallengeDefinition,
} from "./final-challenge-registry";
import { FinalChallengeDefinition } from "./final-challenge.types";
import {
	TournamentFinalChallenge,
	TournamentFinalChallengeOptions,
} from "./tournament-final-challenge";
import { TournamentShell } from "./tournament-shell";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PLAYERS = [10, 20, 30, 40];

const completed = (winnerId: number | null): MinigameRoundResult => ({
	status: "completed",
	minigameId: "mg",
	matchId: "m1",
	winnerId,
	tie: winnerId === null,
});

/** Scripted SPEC-015 pipeline: pops one result per run; records seatings. */
class FakeMinigame {
	readonly runs: { playerIds: readonly number[]; round?: number }[] = [];
	constructor(private readonly script: MinigameRoundResult[]) {}
	run(playerIds: readonly number[], round?: number): Promise<MinigameRoundResult> {
		this.runs.push({ playerIds, round });
		const next = this.script.shift();
		if (!next) {
			throw new Error("fake minigame script exhausted");
		}
		return Promise.resolve(next);
	}
}

/** Records granted Rewards + their contexts (stands in for the Resolver). */
class FakeGranter {
	readonly grants: { reward: Reward; context: ActionContext }[] = [];
	grant(reward: Reward, context: ActionContext): GrantRewardResult {
		this.grants.push({ reward, context });
		return { status: "resolved", rewardId: reward.id, results: [] };
	}
}

class FakeRanking {
	readonly calls: (number | null)[] = [];
	generateFinal(shellHolderId: number | null): void {
		this.calls.push(shellHolderId);
	}
}

class FakeRuleController {
	readonly activated: string[] = [];
	readonly removed: string[] = [];
	activate(config: { id: string }): string | null {
		this.activated.push(config.id);
		return config.id;
	}
	remove(ruleId: string): void {
		this.removed.push(ruleId);
	}
}

interface Harness {
	challenge: TournamentFinalChallenge;
	bus: TournamentEventBus;
	events: AnyTournamentEvent[];
	minigame: FakeMinigame;
	granter: FakeGranter;
	ranking: FakeRanking;
	rules: FakeRuleController;
}

function makeChallenge(
	script: MinigameRoundResult[],
	overrides: Partial<TournamentFinalChallengeOptions> = {},
): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((e) => events.push(e));
	const minigame = new FakeMinigame(script);
	const granter = new FakeGranter();
	const ranking = new FakeRanking();
	const rules = new FakeRuleController();
	const challenge = new TournamentFinalChallenge({
		tournamentId: TOURNAMENT_ID,
		bus,
		clock,
		minigame,
		rewardGranter: granter,
		ranking,
		getActivePlayers: () => PLAYERS,
		ruleController: rules,
		getRound: () => 7,
		...overrides,
	});
	return { challenge, bus, events, minigame, granter, ranking, rules };
}

const names = (events: AnyTournamentEvent[]): string[] => events.map((e) => e.name);

describe("TournamentFinalChallenge (SPEC-021)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("runs the sudden death: unique winner → shell + ranking + finish", async () => {
		const { challenge, events, minigame, granter, ranking } = makeChallenge([
			completed(20),
		]);
		const result = await challenge.start();

		expect(result).toEqual({ status: "finished", winnerId: 20, attempts: 1 });
		expect(challenge.getState()).toBe("finished");
		expect(challenge.getWinnerId()).toBe(20);
		// SPEC-021 "Victoria" order: Started → VictoryConditionReached → Finished
		// (ShellGranted is emitted by the Shell holder, not this system).
		expect(names(events)).toEqual([
			"FinalChallengeStarted",
			"VictoryConditionReached",
			"FinalChallengeFinished",
		]);
		// Every active player was seated through the SPEC-015 pipeline port.
		expect(minigame.runs).toEqual([{ playerIds: PLAYERS, round: 7 }]);
		// The ONLY reward: a ShellReward through the Reward Resolver, against the
		// winner's context (SPEC-021 "Recompensa"/"Integración con Reward Resolver").
		expect(granter.grants).toHaveLength(1);
		expect(granter.grants[0].reward.type).toBe("shell");
		expect(granter.grants[0].context.playerId).toBe(20);
		// The final ranking froze with the Shell holder first (SPEC-021).
		expect(ranking.calls).toEqual([20]);
	});

	it("emits VictoryConditionReached with the winner and the attempt count", async () => {
		const { challenge, events } = makeChallenge([
			completed(null),
			completed(null),
			completed(30),
		]);
		await challenge.start();

		const victory = events.find((e) => e.name === "VictoryConditionReached");
		expect(victory?.payload).toEqual({
			challengeId: V1_FINAL_CHALLENGE_ID,
			winnerId: 30,
			attempts: 3,
		});
		expect(victory?.playerId).toBe(30);
	});

	it("a tie relaunches another minigame until a unique winner (SPEC-021 v1)", async () => {
		const { challenge, minigame } = makeChallenge([
			completed(null),
			completed(10),
		]);
		const result = await challenge.start();

		expect(result).toEqual({ status: "finished", winnerId: 10, attempts: 2 });
		expect(minigame.runs).toHaveLength(2);
	});

	it("a minigame that cannot run stalls the challenge but keeps it ACTIVE", async () => {
		const { challenge, granter, ranking } = makeChallenge([
			{ status: "cancelled", reason: "launch_error" },
		]);
		const result = await challenge.start();

		expect(result).toEqual({ status: "stalled", reason: "launch_error" });
		expect(challenge.getState()).toBe("active"); // SPEC-021 "Error interno"
		expect(granter.grants).toHaveLength(0);
		expect(ranking.calls).toHaveLength(0);
	});

	it("resume() re-enters the sudden death after a stall", async () => {
		const { challenge, events } = makeChallenge([
			{ status: "skipped", reason: "no_candidate" },
			completed(40),
		]);
		await challenge.start();
		const result = await challenge.resume();

		expect(result).toEqual({ status: "finished", winnerId: 40, attempts: 1 });
		// FinalChallengeStarted fired ONCE — a resume is not a restart.
		expect(names(events).filter((n) => n === "FinalChallengeStarted")).toHaveLength(1);
	});

	it("guards double start and post-finish start/resume", async () => {
		const { challenge } = makeChallenge([
			{ status: "cancelled", reason: "x" },
			completed(10),
		]);
		await challenge.start(); // stalled → still active
		expect(await challenge.start()).toEqual({ status: "ignored", reason: "already_active" });
		await challenge.resume(); // finishes
		expect(await challenge.start()).toEqual({
			status: "ignored",
			reason: "already_finished",
		});
		expect(await challenge.resume()).toEqual({
			status: "ignored",
			reason: "already_finished",
		});
	});

	it("resume() before start is ignored", async () => {
		const { challenge } = makeChallenge([]);
		expect(await challenge.resume()).toEqual({ status: "ignored", reason: "not_active" });
	});

	it("activates challenge-specific Rules from the definition and removes them on victory", async () => {
		const registry = createFinalChallengeRegistry();
		registry.register({
			id: "rushdown",
			name: "Rushdown",
			description: "test variant",
			rules: [
				{
					id: "double_dice",
					priority: 20,
					point: "dice",
					composition: "value",
					duration: { kind: "UntilRemoved" },
					value: { kind: "multiply", factor: 2 },
				},
			],
			actions: [],
			victoryConditions: [{ kind: "suddenDeath" }],
		});
		const { challenge, rules } = makeChallenge([completed(20)], {
			registry,
			challengeId: "rushdown",
		});
		await challenge.start();

		expect(rules.activated).toEqual(["double_dice"]);
		expect(rules.removed).toEqual(["double_dice"]); // its own Rules, never the Boss's
	});

	it("serialize() is JSON-safe and tracks lifecycle/attempts/winner", async () => {
		const { challenge } = makeChallenge([completed(null), completed(30)]);
		await challenge.start();
		const snapshot = challenge.serialize();

		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(snapshot).toEqual({
			tournamentId: TOURNAMENT_ID,
			challengeId: V1_FINAL_CHALLENGE_ID,
			state: "finished",
			attempts: 2,
			winnerId: 30,
			activeRuleIds: [],
		});
	});

	it("never calls Date.now (uses the injected clock)", async () => {
		const dateNowSpy = jest.spyOn(Date, "now");
		const { challenge } = makeChallenge([completed(10)]);
		await challenge.start();

		expect(dateNowSpy).not.toHaveBeenCalled();
	});

	it("the registry validates definitions and seeds the v1 sudden death", () => {
		const registry = createFinalChallengeRegistry({ seed: true });
		expect(registry.get(V1_FINAL_CHALLENGE_ID).victoryConditions).toEqual([
			{ kind: "suddenDeath" },
		]);
		expect(
			validateFinalChallengeDefinition({
				id: "bad",
				name: "",
				rules: [],
				actions: [],
				victoryConditions: [],
			} as unknown as FinalChallengeDefinition),
		).toHaveLength(2);
	});
});

describe("TournamentShell (SPEC-013 ShellReward)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	function makeShell() {
		const bus = new TournamentEventBus();
		const clock = new ManualClock(1_000);
		const events: AnyTournamentEvent[] = [];
		bus.onAny((e) => events.push(e));
		const shell = new TournamentShell({
			tournamentId: TOURNAMENT_ID,
			bus,
			clock,
			getRound: () => 7,
		});
		return { shell, events };
	}

	it("grants THE ONE Shell and emits ShellGranted", () => {
		const { shell, events } = makeShell();
		expect(shell.grant(20)).toEqual({ status: "granted", winnerId: 20 });
		expect(shell.getHolderId()).toBe(20);
		expect(events).toHaveLength(1);
		expect(events[0].name).toBe("ShellGranted");
		expect(events[0].payload).toEqual({ winnerId: 20 });
		expect(events[0].playerId).toBe(20);
	});

	it("rejects a second grant (exactly one Shell, logged not thrown)", () => {
		const { shell, events } = makeShell();
		shell.grant(20);
		expect(shell.grant(30)).toEqual({ status: "rejected", reason: "already_granted" });
		expect(shell.getHolderId()).toBe(20);
		expect(events).toHaveLength(1);
	});

	it("serialize() is JSON-safe", () => {
		const { shell } = makeShell();
		shell.grant(10);
		const snapshot = shell.serialize();
		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(snapshot).toEqual({ tournamentId: TOURNAMENT_ID, holderId: 10 });
	});
});
