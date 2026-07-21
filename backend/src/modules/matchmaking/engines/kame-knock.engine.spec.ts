import { KameKnockEngine } from "./kame-knock.engine";
import {
	KameKnockSnapshot,
	MatchRoom,
	RoomPlayer,
} from "../matchmaking.types";

function makePlayer(side: number): RoomPlayer {
	return {
		socketId: `socket-${side}`,
		user: {
			id: side + 1,
			username: `player-${side}`,
			isGuest: false,
		},
		side,
		shellSelection: [],
		ready: true,
		connected: true,
	};
}

function makeRoom(powerupsEnabled = true): MatchRoom {
	const engine = new KameKnockEngine();
	const players = [makePlayer(0), makePlayer(1)];
	const state = engine.createInitialState(
		{
			matchId: "match-kame",
			gameId: "kame-knock",
			mode: "casual",
			powerupsEnabled,
			players: players.map((player) => ({
				socketId: player.socketId,
				user: player.user,
				shellSelection: player.shellSelection,
			})),
		},
		players,
	);
	return {
		matchId: "match-kame",
		gameId: "kame-knock",
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

describe("KameKnockEngine", () => {
	it("rejects disabled or unknown powers on release", () => {
		const disabledEngine = new KameKnockEngine();
		const disabledRoom = makeRoom(false);
		const disabledState = disabledRoom.state as KameKnockSnapshot;
		disabledEngine.start(disabledRoom);

		disabledEngine.handleInput(disabledRoom, 1, {
			matchId: disabledRoom.matchId,
			action: "release",
			payload: {
				roundNumber: 1,
				turnNumber: 0,
				x: 0,
				y: 0,
				vx: 220,
				vy: -180,
				power: "giant",
			},
		});

		expect(disabledState.balls[0]?.power).toBe("none");

		const invalidEngine = new KameKnockEngine();
		const invalidRoom = makeRoom(true);
		const invalidState = invalidRoom.state as KameKnockSnapshot;
		invalidEngine.start(invalidRoom);

		invalidEngine.handleInput(invalidRoom, 1, {
			matchId: invalidRoom.matchId,
			action: "release",
			payload: {
				roundNumber: 1,
				turnNumber: 0,
				x: 0,
				y: 0,
				vx: 220,
				vy: -180,
				power: "laser-sword",
			},
		});

		expect(invalidState.balls[0]?.power).toBe("none");
	});

	it("clears cached round target sets when the room closes", () => {
		const engine = new KameKnockEngine();
		const room = makeRoom(true);
		engine.start(room);

		expect(
			(engine as unknown as { roundTargetSets: Map<string, unknown> })
				.roundTargetSets.size,
		).toBe(1);

		engine.onRoomClosed?.(room);

		expect(
			(engine as unknown as { roundTargetSets: Map<string, unknown> })
				.roundTargetSets.size,
		).toBe(0);
	});

	it("owns launch movement and rejects client hit and settlement claims", () => {
		const engine = new KameKnockEngine();
		const room = makeRoom(true);
		engine.start(room);
		const state = room.state as KameKnockSnapshot;

		expect(
			engine.handleInput(room, 1, {
				matchId: room.matchId,
				action: "release",
				payload: {
					roundNumber: 1,
					turnNumber: 0,
					x: 999,
					y: 999,
					vx: 300,
					vy: 0,
					power: "none",
				},
			}),
		).toBe(room);
		expect(room.physicsState?.entities[0]).toMatchObject({ x: 0, y: 0 });
		expect(
			engine.handleInput(room, 1, {
				matchId: room.matchId,
				action: "target:hit",
				payload: { targetId: state.targets[0]?.id, combo: 99, perfect: true },
			}),
		).toBeNull();
		expect(
			engine.handleInput(room, 1, {
				matchId: room.matchId,
				action: "settled",
				payload: {},
			}),
		).toBeNull();

		engine.advanceSimulation?.(room, 100);
		expect(room.physicsState?.entities[0]?.x).toBeGreaterThan(0);
	});

	it("rejects excessive launch velocity", () => {
		const engine = new KameKnockEngine();
		const room = makeRoom(true);
		engine.start(room);
		expect(
			engine.handleInput(room, 1, {
				matchId: room.matchId,
				action: "release",
				payload: { roundNumber: 1, turnNumber: 0, vx: 5_001, vy: 0 },
			}),
		).toBeNull();
		expect(room.physicsState?.entities).toHaveLength(0);
	});

	it("retains server-authored solid-target impact events in physics state", () => {
		const engine = new KameKnockEngine();
		const room = makeRoom(false);
		engine.start(room);
		const state = room.state as KameKnockSnapshot;
		state.targets = [{
			id: 12, kind: "crate", breakable: false, nx: 0.1, ny: 0,
			ageMs: 0, lifetimeMs: Number.POSITIVE_INFINITY, radiusSrc: 28, points: 120,
		}];

		engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "release",
			payload: { roundNumber: 1, turnNumber: 0, vx: 100, vy: 0 },
		});
		engine.advanceSimulation(room, 1000);

		expect(room.physicsState?.impactEvents).toEqual([
			expect.objectContaining({ id: 1, kind: "solid-target", side: 0, objectId: 12 }),
		]);
	});

	it("advances a settled authoritative turn without client settlement input", () => {
		const engine = new KameKnockEngine();
		const room = makeRoom(false);
		const state = room.state as KameKnockSnapshot;
		engine.start(room);

		expect(
			engine.handleInput(room, 1, {
				matchId: room.matchId,
				action: "release",
				payload: {
					roundNumber: 1,
					turnNumber: 0,
					vx: 0,
					vy: 0,
				},
			}),
		).toBe(room);

		engine.advanceSimulation(room, 1000 / 30);
		engine.advanceSimulation(room, 1000 / 30);

		expect(state.activeTurnNumber).toBeNull();
		expect(state.turnNumber).toBe(1);
		expect(state.currentTurn).toBe(1);
		expect(room.physicsState?.entities).toEqual([]);
	});
});
