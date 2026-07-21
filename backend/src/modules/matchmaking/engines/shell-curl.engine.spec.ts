import { ShellCurlEngine } from "./shell-curl.engine";
import { CurlingSnapshot, MatchRoom, RoomPlayer } from "../matchmaking.types";

function makePlayer(side: number, shellSelection: string[] = []): RoomPlayer {
	return {
		socketId: `socket-${side}`,
		user: { id: side + 1, username: `player-${side}`, isGuest: false },
		side,
		shellSelection,
		ready: true,
		connected: true,
	};
}

function makeRoom(playerCount = 2, selections: string[][] = []): MatchRoom {
	const engine = new ShellCurlEngine();
	const players = Array.from({ length: playerCount }, (_value, side) =>
		makePlayer(side, selections[side] ?? []),
	);
	const state = engine.createInitialState(
		{
			matchId: "match-curl",
			gameId: "temple-curling",
			mode: "casual",
			powerupsEnabled: true,
			players: players.map((player) => ({
				socketId: player.socketId,
				user: player.user,
				shellSelection: player.shellSelection,
			})),
		},
		players,
	);
	return {
		matchId: "match-curl",
		gameId: "temple-curling",
		mode: "casual",
		status: "pending",
		players,
		spectators: new Map(),
		enteredUserIds: new Set(),
		seq: 0,
		state,
		replayFrames: [],
		replayEvents: [],
		replayEnabled: true,
		replayDisabledReason: null,
		replayStartedAt: null,
		replayLastSampleAt: null,
		replayLastKeyframeAt: null,
		replayLastSnapshot: null,
	};
}

function release(
	engine: ShellCurlEngine,
	room: MatchRoom,
	userId: number,
	payload: Record<string, unknown>,
): MatchRoom | null {
	return engine.handleInput(room, userId, {
		matchId: room.matchId,
		action: "release",
		payload,
	});
}

function settle(engine: ShellCurlEngine, room: MatchRoom): void {
	for (let step = 0; step < 1_000; step++) {
		engine.advanceSimulation(room, 1000 / 30);
		if (!room.physicsState?.entities.some((entity) => !entity.stopped))
			return;
	}
	throw new Error("authoritative curling shot did not settle");
}

describe("ShellCurlEngine", () => {
	// createInitialState now picks a random starting seat (BaseEngine.
	// randomStartingTurn) — pinned to 0 here so every OTHER test in this file
	// keeps its existing "seat 0 goes first" assumption; the dedicated
	// starting-seat tests below override this per-test to exercise the
	// actual randomisation.
	beforeEach(() => {
		jest.spyOn(Math, "random").mockReturnValue(0);
	});
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("resolves abandon winners from the connected non-abandoning players", () => {
		const engine = new ShellCurlEngine();
		const room = makeRoom(3);
		const state = room.state as CurlingSnapshot;
		state.score = [2, 9, 5];
		room.players[2].connected = false;
		expect(engine.abandon(room, room.players[0])).toBe(1);
	});

	it("includes a temporarily disconnected leader in abandon resolution (P5)", () => {
		const engine = new ShellCurlEngine();
		const room = makeRoom(4);
		const state = room.state as CurlingSnapshot;
		state.score = [1, 9, 3, 2]; // seat 1 leads
		room.players[1].connected = false; // leader briefly inside its reconnect window
		// Seat 2 abandons: the disconnected leader (seat 1) must still take the
		// win, not a trailing but connected seat.
		expect(engine.abandon(room, room.players[2])).toBe(1);
	});

	it("owns source-space movement and rejects client settlement claims", () => {
		const engine = new ShellCurlEngine();
		const room = makeRoom();
		engine.start(room);
		expect(release(engine, room, 1, { x: 1, y: 1, vx: 300, vy: 0 })).toBe(
			room,
		);
		expect(room.physicsState?.entities[0]).toMatchObject({ x: 90, y: 440 });
		expect(
			engine.handleInput(room, 1, {
				matchId: room.matchId,
				action: "settled",
				payload: { objects: [] },
			}),
		).toBeNull();
		engine.advanceSimulation(room, 1000 / 30);
		expect(room.physicsState?.entities[0]?.x).toBeGreaterThan(90);
	});

	it("keeps lifecycle state stable while a physics projection is moving", () => {
		const engine = new ShellCurlEngine();
		const room = makeRoom();
		engine.start(room);
		expect(release(engine, room, 1, { vx: 300, vy: 0 })).toBe(room);
		const lifecycleSequence = room.state.seq;

		engine.advanceSimulation(room, 1000 / 30);

		expect(room.physicsState?.physicsSeq).toBeGreaterThan(0);
		expect(room.state.seq).toBe(lifecycleSequence);
	});

	it("retains server-authored bumper impact events in physics state", () => {
		const engine = new ShellCurlEngine();
		const room = makeRoom();
		engine.start(room);
		(room.state as CurlingSnapshot).map = {
			gameId: "temple-curling",
			bumpers: [{ fx: 0.07, fy: 0.5 }],
		};

		release(engine, room, 1, { vx: 300, vy: 0 });
		engine.advanceSimulation(room, 1000 / 30);

		expect(room.physicsState?.impactEvents).toEqual([
			expect.objectContaining({ id: 1, kind: "bumper", side: 0, objectId: 0 }),
		]);
	});

	it("requires selected powers and consumes an active power only once per game", () => {
		const engine = new ShellCurlEngine();
		const room = makeRoom(2, [["rocket"], []]);
		const state = room.state as CurlingSnapshot;
		engine.start(room);
		release(engine, room, 1, { vx: 100, vy: 0, power: "giant" });
		expect(room.physicsState?.entities[0]?.power).toBe("none");
		settle(engine, room);
		expect(state.currentTurn).toBe(1);
		release(engine, room, 2, { vx: 0, vy: 0 });
		settle(engine, room);
		expect(state.currentTurn).toBe(0);
		release(engine, room, 1, { vx: 100, vy: 0, power: "rocket" });
		expect(room.physicsState?.entities.at(-1)?.power).toBe("rocket");
		settle(engine, room);
		release(engine, room, 2, { vx: 0, vy: 0 });
		settle(engine, room);
		release(engine, room, 1, { vx: 100, vy: 0, power: "rocket" });
		expect(room.physicsState?.entities.at(-1)?.power).toBe("none");
		expect(state.usedPowersBySide[0]).toEqual(["rocket"]);
	});

	it("allows the active power roster when the matchmaking UI sends no explicit selection", () => {
		const engine = new ShellCurlEngine();
		const room = makeRoom(2, [[], []]);
		engine.start(room);

		expect(
			release(engine, room, 1, { vx: 100, vy: 0, power: "rocket" }),
		).toBe(room);
		expect(room.physicsState?.entities[0]?.power).toBe("rocket");
	});

	it("creates authoritative power pickups when the match enables them", () => {
		const engine = new ShellCurlEngine();
		const room = makeRoom();

		engine.start(room);

		expect(room.physicsState?.pickups).toHaveLength(3);
		expect(room.physicsState?.pickups[0]).toMatchObject({
			id: 1,
			type: "heavy",
			radius: 18,
		});
	});

	it("scores an exactly tied closest stone as a blank end", () => {
		const engine = new ShellCurlEngine();
		const scoreEnd = (
			engine as unknown as {
				scoreEnd(objects: CurlingSnapshot["objects"]): {
					scoringSide: number | null;
					points: number;
				};
			}
		).scoreEnd.bind(engine);
		const centreX = (1570 - 380) / 1570;
		const offset = 40 / 1570;

		expect(
			scoreEnd([
				{ id: 1, side: 0, x: centreX - offset, y: 0.5, power: "none" },
				{ id: 2, side: 1, x: centreX + offset, y: 0.5, power: "none" },
			]),
		).toEqual({ scoringSide: null, points: 0 });
	});

	it("rotates the lead each end so the hammer is not always the last seat (P2)", () => {
		const engine = new ShellCurlEngine();
		const room = makeRoom(3);
		const state = room.state as CurlingSnapshot;
		engine.start(room);
		const leadByEnd: number[] = [];
		let observedEnd = -1;
		for (let throwNumber = 0; throwNumber < state.maxTurns; throwNumber++) {
			if (state.currentEnd !== observedEnd) {
				observedEnd = state.currentEnd;
				leadByEnd[observedEnd] = state.currentTurn;
			}
			const side = state.currentTurn;
			expect(release(engine, room, side + 1, { vx: 0, vy: 0 })).toBe(room);
			settle(engine, room);
		}
		// End 0 leads with seat 0, end 1 with seat 1, end 2 with seat 2.
		expect(leadByEnd).toEqual([0, 1, 2]);
	});

	it("starts a fresh match with a random seat instead of always seat 0 (least the same seat always plays first)", () => {
		// Math.random() = 0.5 of 3 seats → randomStartingTurn = 1.
		jest.spyOn(Math, "random").mockReturnValue(0.5);
		const engine = new ShellCurlEngine();
		const room = makeRoom(3);
		const state = room.state as CurlingSnapshot;
		expect(state.startingTurn).toBe(1);
		expect(state.currentTurn).toBe(1);

		engine.start(room);
		const leadByEnd: number[] = [];
		let observedEnd = -1;
		for (let throwNumber = 0; throwNumber < state.maxTurns; throwNumber++) {
			if (state.currentEnd !== observedEnd) {
				observedEnd = state.currentEnd;
				leadByEnd[observedEnd] = state.currentTurn;
			}
			const side = state.currentTurn;
			expect(release(engine, room, side + 1, { vx: 0, vy: 0 })).toBe(room);
			settle(engine, room);
		}
		// The whole rotation is offset by the random starting seat (1), not
		// reset back to 0 — end 0 leads with seat 1, end 1 with seat 2 (2%3),
		// end 2 with seat 0 (3%3) — `side` itself (colour/identity) is
		// untouched throughout.
		expect(leadByEnd).toEqual([1, 2, 0]);
	});

	it.each([2, 5])(
		"preserves three ends and turn order for %i players",
		(playerCount) => {
			const engine = new ShellCurlEngine();
			const room = makeRoom(playerCount);
			const state = room.state as CurlingSnapshot;
			engine.start(room);
			for (
				let throwNumber = 0;
				throwNumber < state.maxTurns;
				throwNumber++
			) {
				const side = state.currentTurn;
				expect(release(engine, room, side + 1, { vx: 0, vy: 0 })).toBe(
					room,
				);
				settle(engine, room);
			}
			expect(state.currentEnd).toBe(3);
			expect(state.endScores).toHaveLength(3);
			expect(room.status).toBe("finished");
		},
	);
});
