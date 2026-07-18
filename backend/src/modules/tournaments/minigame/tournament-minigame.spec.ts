/**
 * tournament-minigame.spec.ts — Minigame Integration coordinator tests (SPEC-015).
 *
 * Covers: skip when <2 active / no candidate; deterministic seeded selection;
 * the full pipeline (Selected→Loading→Started→Finished) with a lifecycle result;
 * tie handling (no winner, Gambling-skippable); outcome points through the
 * Reward Resolver; launch errors → cancelled; the reconciliation watchdog (found
 * and not-found); abandoned-with-result; serialize; and no Date.now.
 */

import { Logger } from "@nestjs/common";

import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { ManualClock } from "../infra/clock";
import { Reward } from "../rewards/reward.types";
import { ActionContext } from "../actions/action.interface";
import { createMinigameCatalog } from "./minigame-catalog";
import {
	MinigameFinalResult,
	MinigameLaunchResult,
	MinigameLifecycleSignal,
	MinigameOutcome,
} from "./minigame.types";
import {
	TIE_BREAK_SPIN_MS,
	TournamentMinigame,
	TournamentMinigameOptions,
} from "./tournament-minigame";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const WATCHDOG_MS = 600_000;

/** Lets a test drive lifecycle signals to whatever subscribed. */
class FakeLifecycle {
	private readonly listeners = new Set<(s: MinigameLifecycleSignal) => void>();
	subscribe(listener: (s: MinigameLifecycleSignal) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	emit(signal: MinigameLifecycleSignal): void {
		for (const l of [...this.listeners]) l(signal);
	}
	get subscriberCount(): number {
		return this.listeners.size;
	}
}

class FakeLauncher {
	result: MinigameLaunchResult = { status: "launched", matchId: "match-1" };
	readonly launches: { minigameId: string; playerIds: readonly number[] }[] = [];
	launch = async (req: {
		minigameId: string;
		playerIds: readonly number[];
	}): Promise<MinigameLaunchResult> => {
		this.launches.push({ minigameId: req.minigameId, playerIds: req.playerIds });
		return this.result;
	};
}

class FakeReconciler {
	result: MinigameFinalResult | null = null;
	readonly calls: string[] = [];
	reconcile = async (matchId: string): Promise<MinigameFinalResult | null> => {
		this.calls.push(matchId);
		return this.result;
	};
}

class FakeGranter {
	readonly grants: { reward: Reward; playerId: number }[] = [];
	grant(reward: Reward, context: ActionContext) {
		this.grants.push({ reward, playerId: context.playerId });
		return { status: "resolved" as const, rewardId: reward.id, results: [] };
	}
}

interface Harness {
	mg: TournamentMinigame;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
	launcher: FakeLauncher;
	lifecycle: FakeLifecycle;
	reconciler: FakeReconciler;
	granter: FakeGranter;
}

function makeMinigame(overrides: Partial<TournamentMinigameOptions> = {}): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((e) => events.push(e));
	const launcher = new FakeLauncher();
	const lifecycle = new FakeLifecycle();
	const reconciler = new FakeReconciler();
	const granter = new FakeGranter();
	const mg = new TournamentMinigame({
		tournamentId: TOURNAMENT_ID,
		seed: "seed-a",
		bus,
		clock,
		reward: { winner: 100, participant: 25 },
		watchdogMs: WATCHDOG_MS,
		launcher,
		lifecycle,
		reconciler,
		catalog: createMinigameCatalog([
			{ gameId: "kame-knock", minPlayers: 2, maxPlayers: 4 },
			{ gameId: "bell-clash", minPlayers: 2, maxPlayers: 4 },
			{ gameId: "solo-only", minPlayers: 1, maxPlayers: 1 },
		]),
		rewardGranter: granter,
		getRound: () => 2,
		...overrides,
	});
	return { mg, bus, clock, events, launcher, lifecycle, reconciler, granter };
}

const names = (events: AnyTournamentEvent[]): string[] => events.map((e) => e.name);
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

function outcomes(map: Record<number, MinigameOutcome>): ReadonlyMap<number, MinigameOutcome> {
	return new Map(Object.entries(map).map(([k, v]) => [Number(k), v]));
}

describe("TournamentMinigame (SPEC-015)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("skips with <2 active players (no selection, no launch)", async () => {
		const { mg, events, launcher } = makeMinigame();
		const result = await mg.run([10]);
		expect(result).toEqual({ status: "skipped", reason: "insufficient_active_players" });
		expect(launcher.launches).toHaveLength(0);
		expect(names(events)).toEqual(["MinigameCancelled"]);
	});

	it("skips when no catalog minigame supports the active player count", async () => {
		// 3 active players, but only a 1-player 'solo-only' fits none → wait, both
		// kame/bell support up to 4; use a catalog where nothing fits 3.
		const { mg, events } = makeMinigame({
			catalog: createMinigameCatalog([{ gameId: "duo", minPlayers: 2, maxPlayers: 2 }]),
		});
		const result = await mg.run([10, 20, 30]);
		expect(result).toEqual({ status: "skipped", reason: "no_candidate_minigame" });
		const seen = names(events);
		expect(seen).toContain("MinigameSelectionStarted");
		expect(seen).toContain("MinigameCancelled");
		expect(events[0].payload).toMatchObject({ activePlayers: [10, 20, 30], candidateCount: 0 });
	});

	it("runs the full pipeline and returns the single winner", async () => {
		const { mg, events, launcher, lifecycle, granter } = makeMinigame();
		const p = mg.run([10, 20]);
		await tick(); // let launch resolve + subscription attach
		expect(launcher.launches[0].playerIds).toEqual([10, 20]);
		lifecycle.emit({ type: "started", matchId: "match-1" });
		lifecycle.emit({
			type: "finished",
			matchId: "match-1",
			result: {
				matchId: "match-1",
				winnerId: 10,
				outcomes: outcomes({ 10: "win", 20: "loss" }),
			},
		});
		const result = await p;

		expect(result).toMatchObject({ status: "completed", winnerId: 10, tie: false });
		expect(names(events)).toEqual([
			"MinigameSelectionStarted",
			"MinigameSelected",
			"MinigameLoading",
			"MinigameStarted",
			// the two outcome-point grants flow as Points/Wallet events via the granter
			// (faked here, so only the coordinator's own events appear), then Finished:
			"MinigameFinished",
		]);
		// Winner gets 100, the other 25 — both through the Reward Resolver.
		expect(granter.grants).toEqual([
			expect.objectContaining({ playerId: 10 }),
			expect.objectContaining({ playerId: 20 }),
		]);
		expect(granter.grants[0].reward.payload).toMatchObject({ amount: 100, source: "minigame" });
		expect(granter.grants[1].reward.payload).toMatchObject({ amount: 25, source: "minigame" });
	});

	it("MINIGAME TIME! gate holds the launch until every required player confirms", async () => {
		const { mg, clock, events, launcher, lifecycle } = makeMinigame({
			launchGate: { minMs: 1_000, timeoutMs: 20_000, isAutoReady: () => false },
		});
		const p = mg.run([10, 20]);
		await tick();

		// The gate is open, nothing launched yet.
		expect(events.some((e) => e.name === "MinigameLaunchGateOpened")).toBe(true);
		expect(mg.serialize().launchGate?.playerIds).toEqual([10, 20]);
		expect(launcher.launches).toHaveLength(0);

		expect(mg.confirmLaunch(10)).toEqual({ status: "ok" });
		expect(mg.confirmLaunch(10)).toEqual({
			status: "rejected",
			reason: "already_ready",
		});
		expect(mg.confirmLaunch(99)).toEqual({
			status: "rejected",
			reason: "not_participant",
		});
		await tick();
		expect(launcher.launches).toHaveLength(0); // one player still missing

		expect(mg.confirmLaunch(20)).toEqual({ status: "ok" });
		clock.advance(1_000); // the minimum hold after the last confirmation
		await tick();
		expect(launcher.launches).toHaveLength(1);
		expect(mg.serialize().launchGate).toBeNull();

		lifecycle.emit({
			type: "finished",
			matchId: "match-1",
			result: {
				matchId: "match-1",
				winnerId: 10,
				outcomes: outcomes({ 10: "win", 20: "loss" }),
			},
		});
		const result = await p;
		expect(result).toMatchObject({ status: "completed", winnerId: 10 });
	});

	it("MINIGAME TIME! gate deadline launches anyway when someone never confirms", async () => {
		const { mg, clock, launcher, lifecycle } = makeMinigame({
			launchGate: {
				minMs: 1_000,
				timeoutMs: 20_000,
				// Player 20 is a CPU seat: only 10's confirmation is required.
				isAutoReady: (id) => id === 20,
			},
		});
		const p = mg.run([10, 20]);
		await tick();
		expect(launcher.launches).toHaveLength(0);

		// Player 10 never clicks; the deadline fires the launch regardless.
		clock.advance(20_000);
		await tick();
		expect(launcher.launches).toHaveLength(1);

		lifecycle.emit({
			type: "finished",
			matchId: "match-1",
			result: {
				matchId: "match-1",
				winnerId: 20,
				outcomes: outcomes({ 10: "loss", 20: "win" }),
			},
		});
		await expect(p).resolves.toMatchObject({ status: "completed", winnerId: 20 });
	});

	it("a tie opens the tie-break roulette and the seeded winner takes the round", async () => {
		const { mg, clock, events, lifecycle, granter } = makeMinigame();
		const p = mg.run([10, 20]);
		await tick();
		lifecycle.emit({
			type: "finished",
			matchId: "match-1",
			result: {
				matchId: "match-1",
				winnerId: null,
				outcomes: outcomes({ 10: "draw", 20: "draw" }),
				tiedPlayerIds: [10, 20],
			},
		});
		await tick();

		// The tie-break is live: the winner is already decided (seeded) and the
		// round HOLDS so clients can play the roulette spin.
		const started = events.find((e) => e.name === "MinigameTieBreakStarted");
		expect(started?.payload).toMatchObject({
			matchId: "match-1",
			playerIds: [10, 20],
		});
		const spinning = mg.serialize().tieBreak;
		expect(spinning?.playerIds).toEqual([10, 20]);
		expect([10, 20]).toContain(spinning?.winnerId);

		clock.advance(TIE_BREAK_SPIN_MS);
		const result = await p;

		// No tie survives: the roulette's pick wins the round (feeds Gambling)
		// and takes the winner's reward; the other player keeps participant's.
		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.tie).toBe(false);
		expect(result.winnerId).toBe(spinning?.winnerId);
		expect(mg.serialize().tieBreak).toBeNull();
		const finished = events.find((e) => e.name === "MinigameFinished");
		expect(finished?.payload).toMatchObject({ winnerId: result.winnerId, tie: false });
		const amounts = granter.grants.map((g) => ({
			playerId: g.playerId,
			amount: (g.reward.payload as { amount: number }).amount,
		}));
		expect(amounts).toContainEqual({ playerId: result.winnerId, amount: 100 });
		expect(amounts).toContainEqual({
			playerId: result.winnerId === 10 ? 20 : 10,
			amount: 25,
		});
	});

	it("tie-break spins only among the players tied for the top score", async () => {
		const { mg, clock, lifecycle } = makeMinigame();
		const p = mg.run([10, 20, 30]);
		await tick();
		lifecycle.emit({
			type: "finished",
			matchId: "match-1",
			result: {
				matchId: "match-1",
				winnerId: null,
				outcomes: outcomes({ 10: "draw", 20: "draw", 30: "draw" }),
				// The platform reports 10 and 30 tied on top; 20 scored less.
				tiedPlayerIds: [10, 30],
			},
		});
		await tick();

		const spinning = mg.serialize().tieBreak;
		expect(spinning?.playerIds).toEqual([10, 30]);
		clock.advance(TIE_BREAK_SPIN_MS);
		const result = await p;
		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect([10, 30]).toContain(result.winnerId);
		expect(result.winnerId).not.toBe(20);
	});

	it("tie-break waits for every player's board before spinning (audience gate)", async () => {
		const present = new Set<number>([10]); // 20 is still on the arena screen
		const { mg, clock, lifecycle } = makeMinigame({
			tieBreakGate: {
				arrivalTimeoutMs: 20_000,
				isPresent: (id) => present.has(id),
			},
		});
		const p = mg.run([10, 20]);
		await tick();
		lifecycle.emit({
			type: "finished",
			matchId: "match-1",
			result: {
				matchId: "match-1",
				winnerId: null,
				outcomes: outcomes({ 10: "draw", 20: "draw" }),
			},
		});
		await tick();

		// The audience is missing — the roulette must not have started.
		expect(mg.serialize().tieBreak).toBeNull();

		present.add(20); // their board joined the tournament room
		mg.notifyPresenceChanged();
		await tick();
		expect(mg.serialize().tieBreak).not.toBeNull();

		clock.advance(TIE_BREAK_SPIN_MS);
		await expect(p).resolves.toMatchObject({ status: "completed" });
	});

	it("tie-break audience timeout spins anyway (a no-show never blocks)", async () => {
		const { mg, clock, lifecycle } = makeMinigame({
			tieBreakGate: { arrivalTimeoutMs: 20_000, isPresent: () => false },
		});
		const p = mg.run([10, 20]);
		await tick();
		lifecycle.emit({
			type: "finished",
			matchId: "match-1",
			result: {
				matchId: "match-1",
				winnerId: null,
				outcomes: outcomes({ 10: "draw", 20: "draw" }),
			},
		});
		await tick();
		expect(mg.serialize().tieBreak).toBeNull();

		clock.advance(20_000); // arrival deadline
		await tick();
		expect(mg.serialize().tieBreak).not.toBeNull();
		clock.advance(TIE_BREAK_SPIN_MS);
		await expect(p).resolves.toMatchObject({ status: "completed" });
	});

	it("tie-break is deterministic: same seed + same match ⇒ same winner", async () => {
		const winners: Array<number | null> = [];
		for (let i = 0; i < 2; i++) {
			const { mg, clock, lifecycle } = makeMinigame();
			const p = mg.run([10, 20]);
			await tick();
			lifecycle.emit({
				type: "finished",
				matchId: "match-1",
				result: {
					matchId: "match-1",
					winnerId: null,
					outcomes: outcomes({ 10: "draw", 20: "draw" }),
				},
			});
			await tick();
			clock.advance(TIE_BREAK_SPIN_MS);
			const result = await p;
			winners.push(result.status === "completed" ? result.winnerId : null);
		}
		expect(winners[0]).not.toBeNull();
		expect(winners[1]).toBe(winners[0]);
	});

	it("selects deterministically from the seed (same seed ⇒ same minigame)", async () => {
		const a = makeMinigame();
		const b = makeMinigame();
		const pa = a.mg.run([10, 20]);
		const pb = b.mg.run([10, 20]);
		await tick();
		a.lifecycle.emit({ type: "finished", matchId: "match-1", result: {
			matchId: "match-1", winnerId: 10, outcomes: outcomes({ 10: "win", 20: "loss" }),
		} });
		b.lifecycle.emit({ type: "finished", matchId: "match-1", result: {
			matchId: "match-1", winnerId: 10, outcomes: outcomes({ 10: "win", 20: "loss" }),
		} });
		await Promise.all([pa, pb]);
		expect(a.launcher.launches[0].minigameId).toBe(b.launcher.launches[0].minigameId);
	});

	it("cancels the round on a launch error (no winner)", async () => {
		const { mg, events, launcher } = makeMinigame();
		launcher.result = { status: "error", reason: "no_socket" };
		const result = await mg.run([10, 20]);
		expect(result.status).toBe("cancelled");
		expect((result as { reason: string }).reason).toContain("launch_error");
		expect(names(events)).toContain("MinigameCancelled");
	});

	it("reconciles once via the watchdog when no lifecycle event arrives (found)", async () => {
		const { mg, clock, reconciler } = makeMinigame();
		reconciler.result = {
			matchId: "match-1",
			winnerId: 20,
			outcomes: outcomes({ 10: "loss", 20: "win" }),
		};
		const p = mg.run([10, 20]);
		await tick(); // reach the wait
		clock.advance(WATCHDOG_MS); // fire the watchdog
		const result = await p;
		expect(reconciler.calls).toEqual(["match-1"]);
		expect(result).toMatchObject({ status: "completed", winnerId: 20 });
	});

	it("cancels the round when the watchdog finds no durable result", async () => {
		const { mg, clock, reconciler } = makeMinigame();
		reconciler.result = null;
		const p = mg.run([10, 20]);
		await tick();
		clock.advance(WATCHDOG_MS);
		const result = await p;
		expect(reconciler.calls).toEqual(["match-1"]);
		expect(result).toEqual({ status: "cancelled", reason: "no_result" });
	});

	it("accepts an abandoned-with-result as the final result", async () => {
		const { mg, lifecycle } = makeMinigame();
		const p = mg.run([10, 20]);
		await tick();
		lifecycle.emit({
			type: "abandoned",
			matchId: "match-1",
			result: {
				matchId: "match-1",
				winnerId: 10,
				outcomes: outcomes({ 10: "win", 20: "abandoned" }),
			},
		});
		const result = await p;
		expect(result).toMatchObject({ status: "completed", winnerId: 10 });
	});

	it("unsubscribes from lifecycle and cancels the watchdog once settled", async () => {
		const { mg, clock, lifecycle } = makeMinigame();
		const p = mg.run([10, 20]);
		await tick();
		expect(lifecycle.subscriberCount).toBe(1);
		lifecycle.emit({ type: "finished", matchId: "match-1", result: {
			matchId: "match-1", winnerId: 10, outcomes: outcomes({ 10: "win", 20: "loss" }),
		} });
		await p;
		expect(lifecycle.subscriberCount).toBe(0);
		// A late watchdog must not re-settle (no throw, no extra reconcile).
		clock.advance(WATCHDOG_MS);
	});

	it("serialize() round-trips and advances the selection counter", async () => {
		const { mg, lifecycle } = makeMinigame();
		const p = mg.run([10, 20]);
		await tick();
		lifecycle.emit({ type: "finished", matchId: "match-1", result: {
			matchId: "match-1", winnerId: 10, outcomes: outcomes({ 10: "win", 20: "loss" }),
		} });
		await p;
		const snapshot = mg.serialize();
		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(snapshot.selectionCount).toBe(1);
		expect(snapshot.pendingMatchId).toBeNull();
	});

	it("never calls Date.now (uses the injected clock)", async () => {
		const dateNowSpy = jest.spyOn(Date, "now");
		const { mg, lifecycle } = makeMinigame();
		const p = mg.run([10, 20]);
		await tick();
		lifecycle.emit({ type: "finished", matchId: "match-1", result: {
			matchId: "match-1", winnerId: 10, outcomes: outcomes({ 10: "win", 20: "loss" }),
		} });
		await p;
		expect(dateNowSpy).not.toHaveBeenCalled();
	});
});
