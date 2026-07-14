import { Logger } from "@nestjs/common";

import { ActionEngine } from "./action-engine";
import {
	ActionFactory,
	ActionRegistry,
	ConditionRegistry,
} from "./action-registry";
import { ActionContext, ActionServices, BoardCommands } from "./action.interface";
import { registerBaseActionsAndConditions } from "./base-actions";
import { registerTileActions } from "./tile-actions";
import { ManualClock } from "../infra/clock";
import { TournamentEventBus } from "../events/tournament-event-bus";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Records the board commands a Tile Action issued. */
class FakeBoard implements BoardCommands {
	readonly moves: { playerId: number; steps: number }[] = [];
	readonly teleports: { playerId: number; tileId: string }[] = [];
	constructor(private readonly reject = false) {}
	movePlayer(playerId: number, steps: number): { status: "moved" | "rejected" } {
		this.moves.push({ playerId, steps });
		return { status: this.reject ? "rejected" : "moved" };
	}
	teleportPlayer(playerId: number, tileId: string): { status: "moved" | "rejected" } {
		this.teleports.push({ playerId, tileId });
		return { status: this.reject ? "rejected" : "moved" };
	}
}

function makeEngine(): { engine: ActionEngine; factory: ActionFactory } {
	const clock = new ManualClock(1_000);
	const actions = new ActionRegistry();
	const conditions = new ConditionRegistry();
	registerBaseActionsAndConditions(actions, conditions);
	registerTileActions(actions);
	const engine = new ActionEngine({ clock });
	const factory = new ActionFactory(actions, conditions, { engine });
	return { engine, factory };
}

function ctxWith(board?: BoardCommands, playerId = 10): ActionContext {
	return {
		tournamentId: TOURNAMENT_ID,
		playerId,
		round: 1,
		eventBus: new TournamentEventBus(),
		services: { board } as unknown as ActionServices,
	};
}

describe("Tile Actions (SPEC-006)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("nothing resolves to success and does nothing", () => {
		const { engine, factory } = makeEngine();
		const action = factory.create({ type: "nothing" });
		expect(action).not.toBeNull();
		expect(engine.execute(action!, ctxWith()).status).toBe("success");
	});

	it("teleport drives Board.teleportPlayer and mirrors success", () => {
		const { engine, factory } = makeEngine();
		const board = new FakeBoard();
		const action = factory.create({ type: "teleport", parameters: { tileId: "tile-4" } });
		const result = engine.execute(action!, ctxWith(board));
		expect(result.status).toBe("success");
		expect(board.teleports).toEqual([{ playerId: 10, tileId: "tile-4" }]);
	});

	it("teleport mirrors a Board rejection as failed", () => {
		const { engine, factory } = makeEngine();
		const board = new FakeBoard(true);
		const action = factory.create({ type: "teleport", parameters: { tileId: "tile-4" } });
		expect(engine.execute(action!, ctxWith(board)).status).toBe("failed");
	});

	it("teleport without a tileId fails validation", () => {
		const { engine, factory } = makeEngine();
		const action = factory.create({ type: "teleport", parameters: {} });
		expect(engine.execute(action!, ctxWith(new FakeBoard())).status).toBe("failed");
	});

	it("teleport skips (benign) when no Board service is present", () => {
		const { engine, factory } = makeEngine();
		const action = factory.create({ type: "teleport", parameters: { tileId: "tile-4" } });
		expect(engine.execute(action!, ctxWith(undefined)).status).toBe("skipped");
	});

	it("movePlayer drives Board.movePlayer with the configured steps", () => {
		const { engine, factory } = makeEngine();
		const board = new FakeBoard();
		const action = factory.create({ type: "movePlayer", parameters: { steps: -2 } });
		const result = engine.execute(action!, ctxWith(board));
		expect(result.status).toBe("success");
		expect(board.moves).toEqual([{ playerId: 10, steps: -2 }]);
	});

	it("movePlayer targets an explicit playerId when configured", () => {
		const { engine, factory } = makeEngine();
		const board = new FakeBoard();
		const action = factory.create({
			type: "movePlayer",
			parameters: { steps: 3, playerId: 99 },
		});
		engine.execute(action!, ctxWith(board, 10));
		expect(board.moves).toEqual([{ playerId: 99, steps: 3 }]);
	});

	it("movePlayer without steps fails validation", () => {
		const { engine, factory } = makeEngine();
		const action = factory.create({ type: "movePlayer", parameters: {} });
		expect(engine.execute(action!, ctxWith(new FakeBoard())).status).toBe("failed");
	});

	it("randomEvent triggers the Random Events service for the acting player", () => {
		const { engine, factory } = makeEngine();
		const triggers: { playerId: number; round: number }[] = [];
		const ctx: ActionContext = {
			tournamentId: TOURNAMENT_ID,
			playerId: 10,
			round: 2,
			eventBus: new TournamentEventBus(),
			services: {
				randomEvents: {
					trigger: (playerId: number, round: number) =>
						triggers.push({ playerId, round }),
				},
			} as unknown as ActionServices,
		};
		const action = factory.create({ type: "randomEvent" });
		expect(engine.execute(action!, ctx).status).toBe("success");
		expect(triggers).toEqual([{ playerId: 10, round: 2 }]);
	});

	it("randomEvent skips (benign) when no Random Events service is present", () => {
		const { engine, factory } = makeEngine();
		const action = factory.create({ type: "randomEvent" });
		expect(engine.execute(action!, ctxWith(undefined)).status).toBe("skipped");
	});

	// ── AttemptStealAction (SPEC-006) ─────────────────────────────────────────

	function stealCtx(
		steal: unknown,
		transferResult: unknown,
		captured: { transfer: unknown[]; events: string[] },
		playerId = 10,
	): ActionContext {
		const bus = new TournamentEventBus();
		bus.onAny((e) => captured.events.push(e.name));
		return {
			tournamentId: TOURNAMENT_ID,
			playerId,
			round: 1,
			eventBus: bus,
			clock: new ManualClock(1_000),
			services: {
				economy: {
					transfer: (...args: unknown[]) => {
						captured.transfer.push(args);
						return transferResult;
					},
				},
				steal,
			} as unknown as ActionServices,
		};
	}

	it("attemptSteal transfers from a seeded victim and emits StealStarted+StealSucceeded", () => {
		const { engine, factory } = makeEngine();
		const captured = { transfer: [] as unknown[], events: [] as string[] };
		const steal = {
			candidates: () => [20, 30],
			pickIndex: () => 0,
			isProtected: () => false,
		};
		const ctx = stealCtx(steal, { status: "success" }, captured);
		const action = factory.create({ type: "attemptSteal", parameters: { amount: 25 } });
		const result = engine.execute(action!, ctx);

		expect(result.status).toBe("success");
		// transfer(victim=20, thief=10, amount=25, reason, source)
		expect(captured.transfer[0]).toEqual([20, 10, 25, "action:attemptSteal", "steal"]);
		expect(captured.events).toEqual(["StealStarted", "StealSucceeded"]);
	});

	it("attemptSteal with no eligible victim emits StealFailed(no_victim) and skips", () => {
		const { engine, factory } = makeEngine();
		const captured = { transfer: [] as unknown[], events: [] as string[] };
		const steal = { candidates: () => [], pickIndex: () => 0, isProtected: () => false };
		const ctx = stealCtx(steal, { status: "success" }, captured);
		const action = factory.create({ type: "attemptSteal", parameters: { amount: 25 } });
		expect(engine.execute(action!, ctx).status).toBe("skipped");
		expect(captured.transfer).toHaveLength(0);
		expect(captured.events).toEqual(["StealStarted", "StealFailed"]);
	});

	it("attemptSteal against a protected victim emits StealFailed(prevented) and skips", () => {
		const { engine, factory } = makeEngine();
		const captured = { transfer: [] as unknown[], events: [] as string[] };
		const steal = { candidates: () => [20], pickIndex: () => 0, isProtected: () => true };
		const ctx = stealCtx(steal, { status: "success" }, captured);
		const action = factory.create({ type: "attemptSteal", parameters: { amount: 25 } });
		expect(engine.execute(action!, ctx).status).toBe("skipped");
		expect(captured.transfer).toHaveLength(0);
		expect(captured.events).toEqual(["StealStarted", "StealFailed"]);
	});

	it("attemptSteal mirrors an economy rejection as failed + StealFailed(rejected)", () => {
		const { engine, factory } = makeEngine();
		const captured = { transfer: [] as unknown[], events: [] as string[] };
		const steal = { candidates: () => [20], pickIndex: () => 0, isProtected: () => false };
		const ctx = stealCtx(steal, { status: "rejected", rejection: "overflow" }, captured);
		const action = factory.create({ type: "attemptSteal", parameters: { amount: 25 } });
		expect(engine.execute(action!, ctx).status).toBe("failed");
		expect(captured.events).toEqual(["StealStarted", "StealFailed"]);
	});

	it("attemptSteal without a positive amount fails validation", () => {
		const { engine, factory } = makeEngine();
		const captured = { transfer: [] as unknown[], events: [] as string[] };
		const steal = { candidates: () => [20], pickIndex: () => 0, isProtected: () => false };
		const ctx = stealCtx(steal, { status: "success" }, captured);
		const action = factory.create({ type: "attemptSteal", parameters: {} });
		expect(engine.execute(action!, ctx).status).toBe("failed");
	});

	it("attemptSteal skips (benign) when no steal service is present", () => {
		const { engine, factory } = makeEngine();
		const action = factory.create({ type: "attemptSteal", parameters: { amount: 25 } });
		expect(engine.execute(action!, ctxWith(undefined)).status).toBe("skipped");
	});
});
