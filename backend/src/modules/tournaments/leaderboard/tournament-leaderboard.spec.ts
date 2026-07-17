import { Logger } from "@nestjs/common";

import { ManualClock } from "../infra/clock";
import { TournamentEconomy } from "../economy/tournament-economy";
import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	LeaderboardUpdatedPayload,
	PlayerPositionChangedPayload,
	FinalLeaderboardGeneratedPayload,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentLeaderboard } from "./tournament-leaderboard";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PARTICIPANT_IDS = [10, 20, 30, 40];

interface Harness {
	leaderboard: TournamentLeaderboard;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
}

function makeLeaderboard(
	overrides: {
		participantIds?: number[];
		getRound?: () => number;
	} = {},
): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((event) => events.push(event));
	const leaderboard = new TournamentLeaderboard({
		tournamentId: TOURNAMENT_ID,
		participantIds: overrides.participantIds ?? PARTICIPANT_IDS,
		bus,
		clock,
		getRound: overrides.getRound,
	});
	return { leaderboard, bus, clock, events };
}

/** Emits a WalletUpdated as the Economy would (only currentPoints matters). */
function emitWalletUpdated(
	bus: TournamentEventBus,
	clock: ManualClock,
	playerId: number,
	currentPoints: number,
): void {
	const event = createTournamentEvent({
		name: "WalletUpdated",
		tournamentId: TOURNAMENT_ID,
		round: 0,
		playerId,
		payload: { currentPoints, spentPoints: 0, earnedPoints: currentPoints },
		timestamp: clock.now(),
	});
	bus.emit(event as AnyTournamentEvent);
}

function named<T>(events: AnyTournamentEvent[], name: string): T[] {
	return events
		.filter((event) => event.name === name)
		.map((event) => event.payload as T);
}

describe("TournamentLeaderboard (SPEC-018)", () => {
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

	// ── Seeding (SPEC-018 "Fuente de datos") ─────────────────────────────────

	it("seeds one entry per participant at 0 points, all tied at position 1", () => {
		const { leaderboard } = makeLeaderboard();
		const entries = leaderboard.getEntries();
		expect(entries).toHaveLength(PARTICIPANT_IDS.length);
		for (const entry of entries) {
			expect(entry.points).toBe(0);
			expect(entry.position).toBe(1);
		}
		// Presentation order is playerId ascending.
		expect(entries.map((e) => e.playerId)).toEqual([10, 20, 30, 40]);
	});

	it("does not emit anything on construction (no polling, listens only)", () => {
		const { events } = makeLeaderboard();
		expect(events).toHaveLength(0);
	});

	// ── Reordering (SPEC-018 "Pipeline") ─────────────────────────────────────

	it("reorders players as WalletUpdated events arrive", () => {
		const { leaderboard, bus, clock } = makeLeaderboard();
		emitWalletUpdated(bus, clock, 30, 500);
		expect(leaderboard.getPosition(30)).toBe(1);

		emitWalletUpdated(bus, clock, 10, 900);
		expect(leaderboard.getPosition(10)).toBe(1);
		expect(leaderboard.getPosition(30)).toBe(2);

		emitWalletUpdated(bus, clock, 20, 700);
		expect(leaderboard.getEntries().map((e) => e.playerId)).toEqual([
			10, 20, 30, 40,
		]);
		expect(leaderboard.getEntries().map((e) => e.position)).toEqual([
			1, 2, 3, 4,
		]);
	});

	it("LeaderboardUpdated carries the full recomputed ranking", () => {
		const { bus, clock, events } = makeLeaderboard();
		emitWalletUpdated(bus, clock, 10, 900);
		const updates = named<LeaderboardUpdatedPayload>(events, "LeaderboardUpdated");
		expect(updates).toHaveLength(1);
		expect(updates[0].entries).toHaveLength(PARTICIPANT_IDS.length);
		expect(updates[0].entries[0]).toEqual({
			playerId: 10,
			position: 1,
			points: 900,
		});
	});

	// ── Ties (SPEC-018 "Desempates": 1,2,2,4) ────────────────────────────────

	it("shares positions on ties and skips the next distinct group (1,2,2,4)", () => {
		const { leaderboard, bus, clock } = makeLeaderboard();
		emitWalletUpdated(bus, clock, 10, 1500);
		emitWalletUpdated(bus, clock, 20, 1200);
		emitWalletUpdated(bus, clock, 30, 1200);
		emitWalletUpdated(bus, clock, 40, 900);

		const byPlayer = new Map(
			leaderboard.getEntries().map((e) => [e.playerId, e.position]),
		);
		expect(byPlayer.get(10)).toBe(1);
		expect(byPlayer.get(20)).toBe(2);
		expect(byPlayer.get(30)).toBe(2);
		expect(byPlayer.get(40)).toBe(4);
	});

	// ── Position-change diffing (SPEC-018 "Emitir cambios de posición") ───────

	it("emits PlayerPositionChanged only for players whose position changed", () => {
		const { bus, clock, events } = makeLeaderboard();
		// After this, ranking is 10:pos1(900), 20/30/40:pos2(0, tied).
		emitWalletUpdated(bus, clock, 10, 900);
		events.length = 0;

		// 20 → 800: ranking becomes 10:1, 20:2, 30:3, 40:3. 20 KEEPS position 2
		// (no event); 30 and 40 drop from tied-2 to tied-3 (one event each);
		// 10 keeps position 1 (no event).
		emitWalletUpdated(bus, clock, 20, 800);
		const changes = named<PlayerPositionChangedPayload>(
			events,
			"PlayerPositionChanged",
		);
		const movedPlayers = events
			.filter((e) => e.name === "PlayerPositionChanged")
			.map((e) => e.playerId)
			.sort((a, b) => Number(a) - Number(b));
		expect(movedPlayers).toEqual([30, 40]);
		expect(changes.every((c) => c.previousPosition !== c.newPosition)).toBe(true);
		expect(movedPlayers).not.toContain(10);
		expect(movedPlayers).not.toContain(20);
	});

	// ── Unknown player (SPEC-018 "Casos límite") ─────────────────────────────

	it("adds an unknown player defensively without throwing", () => {
		const { leaderboard, bus, clock } = makeLeaderboard();
		expect(() => emitWalletUpdated(bus, clock, 999, 5000)).not.toThrow();
		expect(leaderboard.getPosition(999)).toBe(1);
		expect(leaderboard.getEntries()).toHaveLength(PARTICIPANT_IDS.length + 1);
	});

	// ── Snapshot (SPEC-018 "Snapshot") ───────────────────────────────────────

	it("produces a snapshot with clock timestamp and ordered entries", () => {
		const { leaderboard, bus, clock } = makeLeaderboard();
		emitWalletUpdated(bus, clock, 40, 300);
		clock.advance(50);
		const snapshot = leaderboard.snapshot();
		expect(snapshot.tournamentId).toBe(TOURNAMENT_ID);
		expect(snapshot.timestamp).toBe(1_050);
		expect(snapshot.entries[0].playerId).toBe(40);
	});

	// ── Final Challenge (SPEC-018 "Integración con Final Challenge") ──────────

	it("generateFinal with a shell holder puts the holder 1st even if not top points", () => {
		const { leaderboard, bus, clock, events } = makeLeaderboard();
		emitWalletUpdated(bus, clock, 10, 1500);
		emitWalletUpdated(bus, clock, 20, 1200);
		emitWalletUpdated(bus, clock, 30, 800);
		emitWalletUpdated(bus, clock, 40, 100);
		events.length = 0;

		// Player 40 has the fewest points but holds THE PARROT'S SHELL.
		const final = leaderboard.generateFinal(40);
		expect(final.entries[0].playerId).toBe(40);
		expect(final.entries[0].position).toBe(1);
		// The rest follow by points DESC starting at position 2.
		expect(final.entries.map((e) => e.playerId)).toEqual([40, 10, 20, 30]);
		expect(final.entries.map((e) => e.position)).toEqual([1, 2, 3, 4]);

		const finals = named<FinalLeaderboardGeneratedPayload>(
			events,
			"FinalLeaderboardGenerated",
		);
		expect(finals).toHaveLength(1);
		expect(finals[0].shellHolderId).toBe(40);
	});

	it("generateFinal without a shell holder (DEFEAT) orders purely by points", () => {
		const { leaderboard, bus, clock, events } = makeLeaderboard();
		emitWalletUpdated(bus, clock, 10, 1200);
		emitWalletUpdated(bus, clock, 20, 1200);
		emitWalletUpdated(bus, clock, 30, 800);
		emitWalletUpdated(bus, clock, 40, 400);
		events.length = 0;

		const final = leaderboard.generateFinal();
		expect(final.entries.map((e) => e.position)).toEqual([1, 1, 3, 4]);
		const finals = named<FinalLeaderboardGeneratedPayload>(
			events,
			"FinalLeaderboardGenerated",
		);
		expect(finals[0].shellHolderId).toBeNull();
	});

	it("freezes after generateFinal: later WalletUpdated is ignored", () => {
		const { leaderboard, bus, clock, events } = makeLeaderboard();
		emitWalletUpdated(bus, clock, 10, 500);
		leaderboard.generateFinal();
		const positionBefore = leaderboard.getPosition(20);
		events.length = 0;

		emitWalletUpdated(bus, clock, 20, 999_999);
		expect(leaderboard.getPosition(20)).toBe(positionBefore);
		expect(named(events, "LeaderboardUpdated")).toHaveLength(0);
	});

	it("generateFinal is idempotent: a second call re-emits nothing", () => {
		const { leaderboard, bus, clock, events } = makeLeaderboard();
		emitWalletUpdated(bus, clock, 10, 500);
		leaderboard.generateFinal(10);
		events.length = 0;
		const again = leaderboard.generateFinal(20);
		expect(named(events, "FinalLeaderboardGenerated")).toHaveLength(0);
		// Still reflects the first (frozen) result.
		expect(again.entries[0].playerId).toBe(10);
	});

	// ── Lifecycle ────────────────────────────────────────────────────────────

	it("dispose() unsubscribes from the bus", () => {
		const { leaderboard, bus, clock, events } = makeLeaderboard();
		leaderboard.dispose();
		emitWalletUpdated(bus, clock, 10, 900);
		expect(named(events, "LeaderboardUpdated")).toHaveLength(0);
		expect(leaderboard.getPosition(10)).toBe(1); // unchanged
	});

	// ── Serialization (SPEC-018 "Snapshot") ──────────────────────────────────

	it("serialize() round-trips through JSON", () => {
		const { leaderboard, bus, clock } = makeLeaderboard();
		emitWalletUpdated(bus, clock, 30, 700);
		const serialized = leaderboard.serialize();
		const roundTrip = JSON.parse(JSON.stringify(serialized));
		expect(roundTrip).toEqual(serialized);
		expect(roundTrip.frozen).toBe(false);
		expect(roundTrip.entries[0].playerId).toBe(30);
	});

	// ── Determinism (SPEC-028) ───────────────────────────────────────────────

	it("never calls Math.random or Date.now", () => {
		const randomSpy = jest.spyOn(Math, "random");
		const dateNowSpy = jest.spyOn(Date, "now");
		const { leaderboard, bus, clock } = makeLeaderboard();
		emitWalletUpdated(bus, clock, 10, 900);
		emitWalletUpdated(bus, clock, 20, 1200);
		leaderboard.snapshot();
		leaderboard.generateFinal(30);
		leaderboard.serialize();
		expect(randomSpy).not.toHaveBeenCalled();
		expect(dateNowSpy).not.toHaveBeenCalled();
	});

	// ── End-to-end with the real Economy (SPEC-011 → SPEC-018) ───────────────

	it("consumes real WalletUpdated events from TournamentEconomy end-to-end", () => {
		const bus = new TournamentEventBus();
		const clock = new ManualClock(1_000);
		const economy = new TournamentEconomy({
			tournamentId: TOURNAMENT_ID,
			participantIds: PARTICIPANT_IDS,
			initialPoints: 100,
			bus,
			clock,
		});
		const leaderboard = new TournamentLeaderboard({
			tournamentId: TOURNAMENT_ID,
			participantIds: PARTICIPANT_IDS,
			bus,
			clock,
		});

		economy.award(30, 400, "tile", "tile"); // 30 → 500
		expect(leaderboard.getPosition(30)).toBe(1);

		economy.award(10, 900, "tile", "tile"); // 10 → 1000
		expect(leaderboard.getPosition(10)).toBe(1);
		expect(leaderboard.getPosition(30)).toBe(2);

		// A steal (transfer) emits WalletUpdated for both wallets.
		economy.transfer(10, 20, 900, "steal", "steal"); // 10 → 100, 20 → 1000
		expect(leaderboard.getPosition(20)).toBe(1);
		const player20 = leaderboard.getEntries().find((e) => e.playerId === 20);
		expect(player20?.points).toBe(1000);

		leaderboard.dispose();
	});
});
