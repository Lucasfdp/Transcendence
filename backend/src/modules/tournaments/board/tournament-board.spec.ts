import { Logger } from "@nestjs/common";

import {
	ActionConfig,
	ActionContext,
	ExecutionResult,
} from "../actions/action.interface";
import { AnyTournamentEvent } from "../events/tournament-event.types";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { ManualClock } from "../infra/clock";
import { TileActionRunner } from "./board.types";
import { V1_PLACEHOLDER_BOARD } from "./board-registry";
import { TournamentBoard, TournamentBoardOptions } from "./tournament-board";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PARTICIPANT_IDS = [10, 20, 30, 40];

/** Recording runner: captures every `run` call, returns one success per Action. */
class RecordingRunner implements TileActionRunner {
	readonly calls: { actions: readonly ActionConfig[]; context: ActionContext }[] = [];
	run(actions: readonly ActionConfig[], context: ActionContext): ExecutionResult[] {
		this.calls.push({ actions, context });
		return actions.map(() => ({ status: "success" }) as ExecutionResult);
	}
}

interface Harness {
	board: TournamentBoard;
	bus: TournamentEventBus;
	clock: ManualClock;
	events: AnyTournamentEvent[];
	runner: RecordingRunner;
}

function makeBoard(overrides: Partial<TournamentBoardOptions> = {}): Harness {
	const bus = new TournamentEventBus();
	const clock = new ManualClock(1_000);
	const events: AnyTournamentEvent[] = [];
	bus.onAny((event) => events.push(event));
	const runner = new RecordingRunner();
	const board = new TournamentBoard({
		tournamentId: TOURNAMENT_ID,
		definition: V1_PLACEHOLDER_BOARD,
		participantIds: PARTICIPANT_IDS,
		bus,
		clock,
		actionRunner: overrides.actionRunner ?? runner,
		...overrides,
	});
	return { board, bus, clock, events, runner };
}

function names(events: AnyTournamentEvent[]): string[] {
	return events.map((event) => event.name);
}

describe("TournamentBoard (SPEC-002)", () => {
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

	it("seats every participant on the starting tile", () => {
		const { board } = makeBoard();
		for (const playerId of PARTICIPANT_IDS) {
			expect(board.getPosition(playerId)).toBe("tile-0");
		}
	});

	it("movePlayer walks the successor edge and emits the pipeline in order", () => {
		const { board, events, runner } = makeBoard();
		const result = board.movePlayer(10, 3);

		expect(result.status).toBe("moved");
		if (result.status === "moved") {
			expect(result.fromTileId).toBe("tile-0");
			expect(result.toTileId).toBe("tile-3");
			expect(result.steps).toBe(3);
			expect(result.forced).toBe(false);
		}
		expect(board.getPosition(10)).toBe("tile-3");
		expect(names(events)).toEqual([
			"PlayerMoved",
			"TileEntered",
			"TileResolved",
			"MovementFinished",
		]);
		// The runner received exactly the destination tile's actions.
		expect(runner.calls).toHaveLength(1);
		expect(runner.calls[0].actions).toEqual(board.getTile("tile-3")?.actions);
	});

	it("walks backward for negative steps (predecessor edge)", () => {
		const { board } = makeBoard();
		// tile-7 connects to tile-0, so one step back from tile-0 is tile-7.
		const result = board.movePlayer(10, -1);
		expect(result.status).toBe("moved");
		expect(board.getPosition(10)).toBe("tile-7");
	});

	it("wraps around the ring", () => {
		const { board } = makeBoard();
		expect((board.movePlayer(10, 8) as { toTileId: string }).toTileId).toBe("tile-0");
		board.movePlayer(20, 10);
		expect(board.getPosition(20)).toBe("tile-2");
	});

	it("lets players share a tile (no collision)", () => {
		const { board } = makeBoard();
		board.movePlayer(10, 2);
		board.movePlayer(20, 2);
		expect(board.getPlayersOn("tile-2").sort()).toEqual([10, 20]);
	});

	it("teleportPlayer relocates and resolves with forced=true", () => {
		const { board, events } = makeBoard();
		const result = board.teleportPlayer(10, "tile-5");
		expect(result.status).toBe("moved");
		if (result.status === "moved") {
			expect(result.forced).toBe(true);
			expect(result.toTileId).toBe("tile-5");
			expect(result.steps).toBe(0);
		}
		expect(board.getPosition(10)).toBe("tile-5");
		const moved = events.find((e) => e.name === "PlayerMoved");
		expect(moved?.payload).toMatchObject({ toTileId: "tile-5", forced: true });
	});

	it("rejects a teleport to an unknown tile without throwing or moving", () => {
		const { board, events } = makeBoard();
		const result = board.teleportPlayer(10, "no-such-tile");
		expect(result.status).toBe("rejected");
		if (result.status === "rejected") {
			expect(result.reason).toBe("unknown_tile");
		}
		expect(board.getPosition(10)).toBe("tile-0");
		expect(events).toHaveLength(0);
	});

	it("rejects a move for an unknown player", () => {
		const { board } = makeBoard();
		const result = board.movePlayer(999, 1);
		expect(result.status).toBe("rejected");
		if (result.status === "rejected") {
			expect(result.reason).toBe("unknown_player");
		}
	});

	it("enforces the anti-loop limit: a chained relocation resolves only once more", () => {
		// A runner whose tile Actions teleport the SAME player every time it runs.
		// External move → resolve (depth 1) → teleport (allowed) → resolve (depth 2)
		// → teleport (SUPPRESSED). run() therefore fires exactly twice and the
		// second teleport is rejected — no infinite loop (SPEC-002 anti-loop).
		const teleportResults: string[] = [];
		let runCount = 0;
		const loopingRunner: TileActionRunner = {
			run: () => {
				runCount += 1;
				const r = board.teleportPlayer(10, "tile-4");
				teleportResults.push(r.status === "rejected" ? r.reason : r.status);
				return [{ status: "success" }];
			},
		};
		const { board } = makeBoard({ actionRunner: loopingRunner });

		const result = board.movePlayer(10, 1);
		expect(result.status).toBe("moved");
		expect(runCount).toBe(2);
		// One re-entrant teleport moved; the deeper one was suppressed. (The
		// suppressed one resolves first, before the outer teleport returns.)
		expect([...teleportResults].sort()).toEqual(["moved", "relocation_limit"]);
		expect(board.getPosition(10)).toBe("tile-4");
	});

	it("reset re-seats everyone at the starting tile", () => {
		const { board } = makeBoard();
		board.movePlayer(10, 3);
		board.reset();
		expect(board.getPosition(10)).toBe("tile-0");
	});

	it("serialize() produces a JSON-safe snapshot that round-trips", () => {
		const { board } = makeBoard();
		board.movePlayer(10, 2);
		const snapshot = board.serialize();
		const roundTripped = JSON.parse(JSON.stringify(snapshot));
		expect(roundTripped).toEqual(snapshot);
		expect(roundTripped.boardId).toBe(V1_PLACEHOLDER_BOARD.id);
		const p10 = roundTripped.positions.find(
			(p: { playerId: number }) => p.playerId === 10,
		);
		expect(p10.tileId).toBe("tile-2");
	});

	it("stamps the current round from getRound onto emitted events", () => {
		const { board, events } = makeBoard({ getRound: () => 4 });
		board.movePlayer(10, 1);
		expect(events.every((e) => e.round === 4)).toBe(true);
	});

	it("never calls Math.random or Date.now", () => {
		const randomSpy = jest.spyOn(Math, "random");
		const dateNowSpy = jest.spyOn(Date, "now");
		const { board } = makeBoard();
		board.movePlayer(10, 3);
		board.teleportPlayer(20, "tile-6");
		board.serialize();
		expect(randomSpy).not.toHaveBeenCalled();
		expect(dateNowSpy).not.toHaveBeenCalled();
	});
});
