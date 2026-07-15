/**
 * tournament-gambling.spec.ts — Gambling Integration unit tests (SPEC-016).
 *
 * Covers: open (with/without funds, skip when complete, ignore double-open); a
 * winning bet (charge points, grant a Key Item Reward, provably-fair reveal); a
 * losing bet (points lost, no reward); rejections (no session / not winner /
 * insufficient points — never auto-bet); abandon and decision timeout; nonce
 * progression; GamblingFinished on every close; serialize; and no Date.now.
 */

import { Logger } from "@nestjs/common";

import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { ManualClock } from "../infra/clock";
import { ActionContext } from "../actions/action.interface";
import { Reward } from "../rewards/reward.types";
import { GamblingFairness } from "./gambling.types";
import { TournamentGambling, TournamentGamblingOptions } from "./tournament-gambling";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const COST = 50;
const TIMEOUT_MS = 30_000;

class FakeEconomy {
	balance = 1000;
	readonly removes: { playerId: number; amount: number }[] = [];
	getBalance(): number {
		return this.balance;
	}
	remove(playerId: number, amount: number) {
		if (this.balance < amount) {
			return { status: "rejected" as const, rejection: "insufficient_balance" as const };
		}
		this.balance -= amount;
		this.removes.push({ playerId, amount });
		return { status: "success" as const };
	}
}

class FakeGranter {
	readonly grants: { reward: Reward; playerId: number }[] = [];
	grant(reward: Reward, context: ActionContext) {
		this.grants.push({ reward, playerId: context.playerId });
		return { status: "resolved" as const, rewardId: reward.id, results: [] };
	}
}

/** Fairness stub with a scriptable roll (default a winning-side roll). */
class FakeFairness implements GamblingFairness {
	rollValue = 0.1;
	serverSeed(): string {
		return "server-seed";
	}
	commit(serverSeed: string): string {
		return `hash:${serverSeed}`;
	}
	roll(): number {
		return this.rollValue;
	}
}

interface Harness {
	gambling: TournamentGambling;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
	economy: FakeEconomy;
	granter: FakeGranter;
	fairness: FakeFairness;
	locked: { remaining: boolean };
}

function makeGambling(overrides: Partial<TournamentGamblingOptions> = {}): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((e) => events.push(e));
	const economy = new FakeEconomy();
	const granter = new FakeGranter();
	const fairness = new FakeFairness();
	const locked = { remaining: true };
	const gambling = new TournamentGambling({
		tournamentId: TOURNAMENT_ID,
		bus,
		clock,
		economy: economy as unknown as TournamentGamblingOptions["economy"],
		rewardGranter: granter as unknown as TournamentGamblingOptions["rewardGranter"],
		keyItems: { hasLockedRemaining: () => locked.remaining },
		fairness,
		makeContext: ({ playerId, round }) => ({
			tournamentId: TOURNAMENT_ID,
			playerId,
			round,
			eventBus: bus,
			services: {} as never,
			clock,
		}),
		cost: COST,
		decisionTimeoutMs: TIMEOUT_MS,
		getRound: () => 3,
		...overrides,
	});
	return { gambling, bus, clock, events, economy, granter, fairness, locked };
}

const names = (events: AnyTournamentEvent[]): string[] => events.map((e) => e.name);

describe("TournamentGambling (SPEC-016)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("opens for the winner and emits GamblingOpened with the decision deadline", () => {
		const { gambling, events, clock } = makeGambling();
		const result = gambling.open(10, 0.5);
		expect(result).toEqual({ status: "opened", canAfford: true });
		expect(gambling.openSessionWinnerId).toBe(10);
		expect(names(events)).toEqual(["GamblingOpened"]);
		expect(events[0].payload).toMatchObject({
			cost: COST,
			winChance: 0.5,
			deadlineAt: clock.now() + TIMEOUT_MS,
			canAfford: true,
		});
	});

	it("opens even when the winner cannot afford the bet (canAfford false)", () => {
		const { gambling, economy } = makeGambling();
		economy.balance = 10;
		expect(gambling.open(10, 0.5)).toEqual({ status: "opened", canAfford: false });
	});

	it("skips opening when no Key Item remains locked (progress complete)", () => {
		const { gambling, events, locked } = makeGambling();
		locked.remaining = false;
		expect(gambling.open(10, 0.5)).toEqual({
			status: "skipped",
			reason: "no_locked_key_items",
		});
		expect(gambling.openSessionWinnerId).toBeNull();
		expect(events).toHaveLength(0);
	});

	it("ignores a second open while a session is in progress", () => {
		const { gambling } = makeGambling();
		gambling.open(10, 0.5);
		expect(gambling.open(20, 0.5)).toEqual({
			status: "ignored",
			reason: "session_in_progress",
		});
	});

	it("a winning bet charges points, grants a Key Item Reward, and reveals the roll", () => {
		const { gambling, events, economy, granter, fairness } = makeGambling();
		fairness.rollValue = 0.1; // < winChance ⇒ win
		gambling.open(10, 0.5);
		const result = gambling.bet(10, "client-seed");

		expect(result).toEqual({ status: "won" });
		expect(economy.removes).toEqual([{ playerId: 10, amount: COST }]);
		expect(granter.grants).toHaveLength(1);
		expect(granter.grants[0].reward).toMatchObject({ type: "keyItem" });
		expect(granter.grants[0].playerId).toBe(10);
		const seen = names(events);
		expect(seen).toEqual(["GamblingOpened", "GamblingStarted", "GamblingWon", "GamblingFinished"]);
		expect(events.find((e) => e.name === "GamblingWon")?.payload).toMatchObject({
			roll: 0.1,
			winChance: 0.5,
			serverSeed: "server-seed",
			clientSeed: "client-seed",
			nonce: 0,
			commitment: "hash:server-seed",
		});
		expect(events.find((e) => e.name === "GamblingFinished")?.payload).toEqual({
			outcome: "won",
		});
		expect(gambling.openSessionWinnerId).toBeNull();
	});

	it("a losing bet spends the points and grants nothing", () => {
		const { gambling, events, economy, granter, fairness } = makeGambling();
		fairness.rollValue = 0.9; // >= winChance ⇒ loss
		gambling.open(10, 0.5);
		const result = gambling.bet(10);

		expect(result).toEqual({ status: "lost" });
		expect(economy.removes).toEqual([{ playerId: 10, amount: COST }]);
		expect(granter.grants).toHaveLength(0);
		expect(names(events)).toEqual([
			"GamblingOpened",
			"GamblingStarted",
			"GamblingLost",
			"GamblingFinished",
		]);
		expect(events.find((e) => e.name === "GamblingFinished")?.payload).toEqual({
			outcome: "lost",
		});
	});

	it("rejects a bet with no open session", () => {
		const { gambling } = makeGambling();
		expect(gambling.bet(10)).toEqual({ status: "rejected", reason: "no_session" });
	});

	it("rejects a bet from a player who is not the winner", () => {
		const { gambling } = makeGambling();
		gambling.open(10, 0.5);
		expect(gambling.bet(99)).toEqual({ status: "rejected", reason: "not_winner" });
		expect(gambling.openSessionWinnerId).toBe(10); // session stays open
	});

	it("rejects (no charge, session stays open) when the winner cannot afford the bet", () => {
		const { gambling, economy } = makeGambling();
		economy.balance = 10;
		gambling.open(10, 0.5);
		expect(gambling.bet(10)).toEqual({ status: "rejected", reason: "insufficient_points" });
		expect(economy.removes).toHaveLength(0);
		expect(gambling.openSessionWinnerId).toBe(10);
	});

	it("abandon closes the phase as abandoned (Cancelled + Finished)", () => {
		const { gambling, events } = makeGambling();
		gambling.open(10, 0.5);
		gambling.abandon(10);
		expect(gambling.openSessionWinnerId).toBeNull();
		expect(names(events)).toEqual([
			"GamblingOpened",
			"GamblingCancelled",
			"GamblingFinished",
		]);
		expect(events.find((e) => e.name === "GamblingCancelled")?.payload).toEqual({
			reason: "abandoned",
		});
		expect(events.find((e) => e.name === "GamblingFinished")?.payload).toEqual({
			outcome: "abandoned",
		});
	});

	it("times out the decision as abandonment (never auto-bets)", () => {
		const { gambling, events, economy, clock } = makeGambling();
		gambling.open(10, 0.5);
		clock.advance(TIMEOUT_MS);
		expect(gambling.openSessionWinnerId).toBeNull();
		expect(economy.removes).toHaveLength(0); // no auto-bet
		expect(names(events)).toContain("GamblingCancelled");
		expect(events.find((e) => e.name === "GamblingFinished")?.payload).toEqual({
			outcome: "timeout",
		});
	});

	it("advances the provably-fair nonce per bet", () => {
		const { gambling, events } = makeGambling();
		gambling.open(10, 0.5);
		gambling.bet(10);
		gambling.open(10, 0.5);
		gambling.bet(10);
		const reveals = events
			.filter((e) => e.name === "GamblingWon" || e.name === "GamblingLost")
			.map((e) => (e.payload as { nonce: number }).nonce);
		expect(reveals).toEqual([0, 1]);
	});

	it("serialize() round-trips, clears the session on close, and records nonces", () => {
		const { gambling } = makeGambling();
		gambling.open(10, 0.5);
		gambling.bet(10);
		const snapshot = gambling.serialize();
		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(snapshot.session).toBeNull();
		expect(snapshot.nonces).toEqual({ 10: 1 });
	});

	it("never calls Date.now (uses the injected clock)", () => {
		const dateNowSpy = jest.spyOn(Date, "now");
		const { gambling, clock } = makeGambling();
		gambling.open(10, 0.5);
		gambling.bet(10);
		gambling.open(10, 0.5);
		clock.advance(TIMEOUT_MS);
		expect(dateNowSpy).not.toHaveBeenCalled();
	});
});
