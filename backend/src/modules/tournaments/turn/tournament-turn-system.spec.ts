import { Logger } from "@nestjs/common";

import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { ManualClock } from "../infra/clock";
import { TurnBoardPort, TurnDicePort } from "./turn.types";
import {
	TournamentTurnSystem,
	TournamentTurnSystemOptions,
} from "./tournament-turn-system";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TURN_TIMEOUT_MS = 30_000;

class FakeDice implements TurnDicePort {
	readonly calls: { playerId: number; round: number }[] = [];
	constructor(private readonly value = 3) {}
	roll(input: { playerId: number; round: number }): { value: number } {
		this.calls.push(input);
		return { value: this.value };
	}
}

class FakeBoard implements TurnBoardPort {
	readonly moves: { playerId: number; steps: number }[] = [];
	private readonly positions = new Map<number, string>();
	movePlayer(
		playerId: number,
		steps: number,
	): { status: "moved" | "rejected"; toTileId?: string } {
		this.moves.push({ playerId, steps });
		const toTileId = `tile-${steps}`;
		this.positions.set(playerId, toTileId);
		return { status: "moved", toTileId };
	}
	getPosition(playerId: number): string | undefined {
		return this.positions.get(playerId);
	}
}

interface Harness {
	turnSystem: TournamentTurnSystem;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
	dice: FakeDice;
	board: FakeBoard;
}

function makeTurnSystem(overrides: Partial<TournamentTurnSystemOptions> = {}): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((event) => events.push(event));
	const dice = new FakeDice();
	const board = new FakeBoard();
	const turnSystem = new TournamentTurnSystem({
		tournamentId: TOURNAMENT_ID,
		bus,
		clock,
		dice,
		board,
		turnTimeoutMs: TURN_TIMEOUT_MS,
		getRound: () => 1,
		...overrides,
	});
	return { turnSystem, bus, clock, events, dice, board };
}

function names(events: AnyTournamentEvent[]): string[] {
	return events.map((event) => event.name);
}

describe("TournamentTurnSystem (SPEC-005)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("startTurn activates the player and emits PlayerTurnStarted then DiceRollRequested", () => {
		const { turnSystem, events, clock } = makeTurnSystem();
		const result = turnSystem.startTurn(10);
		expect(result.status).toBe("ok");
		expect(turnSystem.activePlayerId).toBe(10);
		expect(names(events)).toEqual(["PlayerTurnStarted", "DiceRollRequested"]);
		expect(events[0].payload).toEqual({ deadlineAt: clock.now() + TURN_TIMEOUT_MS });
	});

	it("ignores a startTurn while another turn is in progress (one active turn)", () => {
		const { turnSystem } = makeTurnSystem();
		turnSystem.startTurn(10);
		const result = turnSystem.startTurn(20);
		expect(result).toEqual({ status: "ignored", reason: "turn_in_progress" });
		expect(turnSystem.activePlayerId).toBe(10);
	});

	it("requestRoll rolls (server), moves the player and finishes the turn", () => {
		const { turnSystem, events, dice, board } = makeTurnSystem();
		turnSystem.startTurn(10);
		const result = turnSystem.requestRoll(10);

		expect(result.status).toBe("ok");
		expect(dice.calls).toEqual([{ playerId: 10, round: 1 }]);
		expect(board.moves).toEqual([{ playerId: 10, steps: 3 }]);
		const finished = events.find((e) => e.name === "PlayerTurnFinished");
		expect(finished?.payload).toEqual({
			finalTileId: "tile-3",
			diceValue: 3,
			autoResolved: false,
		});
		// Turn is cleared afterwards.
		expect(turnSystem.activePlayerId).toBeNull();
	});

	it("ignores requestRoll from a non-active player and logs it", () => {
		const { turnSystem, dice } = makeTurnSystem();
		turnSystem.startTurn(10);
		const result = turnSystem.requestRoll(20);
		expect(result).toEqual({ status: "ignored", reason: "not_active_player" });
		expect(dice.calls).toHaveLength(0);
		expect(turnSystem.activePlayerId).toBe(10);
	});

	it("ignores a second requestRoll (only one roll per turn)", () => {
		const { turnSystem, dice } = makeTurnSystem();
		turnSystem.startTurn(10);
		turnSystem.requestRoll(10);
		const second = turnSystem.requestRoll(10);
		expect(second).toEqual({ status: "ignored", reason: "no_active_turn" });
		expect(dice.calls).toHaveLength(1);
	});

	it("ignores requestRoll when there is no active turn", () => {
		const { turnSystem } = makeTurnSystem();
		expect(turnSystem.requestRoll(10)).toEqual({
			status: "ignored",
			reason: "no_active_turn",
		});
	});

	it("auto-rolls on timeout (server resolves the turn)", () => {
		const { turnSystem, events, dice, clock } = makeTurnSystem();
		turnSystem.startTurn(10);
		clock.advance(TURN_TIMEOUT_MS);
		expect(dice.calls).toHaveLength(1);
		const finished = events.find((e) => e.name === "PlayerTurnFinished");
		expect(finished?.payload).toMatchObject({ autoResolved: true });
		expect(turnSystem.activePlayerId).toBeNull();
	});

	it("does not auto-roll before the timeout, and a manual roll cancels the timeout", () => {
		const { turnSystem, dice, clock } = makeTurnSystem();
		turnSystem.startTurn(10);
		clock.advance(TURN_TIMEOUT_MS - 1);
		expect(dice.calls).toHaveLength(0);
		turnSystem.requestRoll(10);
		expect(dice.calls).toHaveLength(1);
		// Advancing past the old deadline must NOT roll again (timer cancelled).
		clock.advance(TURN_TIMEOUT_MS);
		expect(dice.calls).toHaveLength(1);
	});

	it("auto-resolves the turn when the active player disconnects", () => {
		const { turnSystem, events, dice } = makeTurnSystem();
		turnSystem.startTurn(10);
		turnSystem.handleDisconnect(10);
		expect(dice.calls).toHaveLength(1);
		expect(
			events.find((e) => e.name === "PlayerTurnFinished")?.payload,
		).toMatchObject({ autoResolved: true });
	});

	it("ignores a disconnect for a non-active player", () => {
		const { turnSystem, dice } = makeTurnSystem();
		turnSystem.startTurn(10);
		turnSystem.handleDisconnect(20);
		expect(dice.calls).toHaveLength(0);
		expect(turnSystem.activePlayerId).toBe(10);
	});

	it("can start the next player's turn after one finishes", () => {
		const { turnSystem } = makeTurnSystem();
		turnSystem.startTurn(10);
		turnSystem.requestRoll(10);
		const next = turnSystem.startTurn(20);
		expect(next.status).toBe("ok");
		expect(turnSystem.activePlayerId).toBe(20);
	});

	it("serialize() round-trips the active turn", () => {
		const { turnSystem } = makeTurnSystem();
		turnSystem.startTurn(10);
		const snapshot = turnSystem.serialize();
		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(snapshot.activeTurn?.playerId).toBe(10);
		expect(snapshot.activeTurn?.phase).toBe("waiting_roll");
	});

	it("never calls Date.now (uses the injected clock)", () => {
		const dateNowSpy = jest.spyOn(Date, "now");
		const { turnSystem, clock } = makeTurnSystem();
		turnSystem.startTurn(10);
		turnSystem.requestRoll(10);
		clock.advance(TURN_TIMEOUT_MS);
		expect(dateNowSpy).not.toHaveBeenCalled();
	});
});
