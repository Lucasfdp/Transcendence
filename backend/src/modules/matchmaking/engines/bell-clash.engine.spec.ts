import { BellClashEngine } from "./bell-clash.engine";
import {
	BellClashSnapshot,
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
	const engine = new BellClashEngine();
	const players = [makePlayer(0), makePlayer(1)];
	const state = engine.createInitialState(
		{
			matchId: "match-bell",
			gameId: "bell-clash",
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
		matchId: "match-bell",
		gameId: "bell-clash",
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

describe("BellClashEngine", () => {
	function releaseAndSettle(
		engine: BellClashEngine,
		room: MatchRoom,
		userId: number,
	): void {
		const state = room.state as BellClashSnapshot;
		expect(
			engine.handleInput(room, userId, {
				matchId: room.matchId,
				action: "release",
				payload: {
					roundNumber: state.roundNumber,
					vx: 0,
					vy: 0,
					power: "none",
				},
			}),
		).toBe(room);
		engine.advanceSimulation(room, 1000 / 30);
	}

	it("rejects powers when powerups are disabled", () => {
		const engine = new BellClashEngine();
		const room = makeRoom(false);
		const state = room.state as BellClashSnapshot;
		engine.start(room);

		engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "release",
			payload: {
				roundNumber: 1,
				x: 0,
				y: 0,
				vx: 260,
				vy: -90,
				power: "giant",
			},
		});

		expect(state.balls[0]?.power).toBe("none");
	});

	it("allows each power only once per round", () => {
		const engine = new BellClashEngine();
		const room = makeRoom(true);
		const state = room.state as BellClashSnapshot;
		engine.start(room);

		engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "release",
			payload: {
				roundNumber: 1,
				x: 0,
				y: 0,
				vx: 260,
				vy: -90,
				power: "giant",
			},
		});

		expect(state.balls[0]?.power).toBe("giant");
		for (let step = 0; step < 600; step++) {
			engine.advanceSimulation(room, 1000 / 30);
			if (room.physicsState?.entities.every((entity) => entity.stopped)) break;
		}
		expect(room.physicsState?.entities.every((entity) => entity.stopped)).toBe(
			true,
		);

		engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "release",
			payload: {
				roundNumber: 1,
				x: 0,
				y: 0,
				vx: 230,
				vy: -110,
				power: "giant",
			},
		});

		expect(state.balls[0]?.power).toBe("none");
	});

	it("rejects a power the player did not select, but allows a selected one (P3)", () => {
		const engine = new BellClashEngine();
		const room = makeRoom(true);
		const state = room.state as BellClashSnapshot;
		// This player owns only "giant"; a modified client asking for "rocket"
		// must not get it.
		room.players[0].shellSelection = ["giant"];
		engine.start(room);

		engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "release",
			payload: { roundNumber: 1, x: 0, y: 0, vx: 260, vy: -90, power: "rocket" },
		});
		expect(state.balls[0]?.power).toBe("none");

		for (let step = 0; step < 600; step++) {
			engine.advanceSimulation(room, 1000 / 30);
			if (room.physicsState?.entities.every((entity) => entity.stopped))
				break;
		}

		engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "release",
			payload: { roundNumber: 1, x: 0, y: 0, vx: 230, vy: -110, power: "giant" },
		});
		expect(state.balls[0]?.power).toBe("giant");
	});

	it("rejects client-authored scoring", () => {
		const engine = new BellClashEngine();
		const room = makeRoom();
		const state = room.state as BellClashSnapshot;
		engine.start(room);

		const result = engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "bell:hit",
			payload: { roundNumber: 1, points: 10_000 },
		});

		expect(result).toBeNull();
		expect(state.liveRoundScores).toEqual([0, 0]);
	});

	it("rejects launch speeds outside the slingshot envelope", () => {
		const engine = new BellClashEngine();
		const room = makeRoom();
		engine.start(room);

		const result = engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "release",
			payload: { roundNumber: 1, x: 0, y: 0, vx: 50_000, vy: 0 },
		});

		expect(result).toBeNull();
		expect(room.physicsState?.entities).toHaveLength(0);
	});

	it("advances the round only after every final shot is settled", () => {
		const engine = new BellClashEngine();
		const room = makeRoom(false);
		const state = room.state as BellClashSnapshot;
		engine.start(room);

		for (let shot = 0; shot < 3; shot++) releaseAndSettle(engine, room, 1);
		expect(state.roundNumber).toBe(1);
		expect(state.roundScores).toEqual([null, null]);

		for (let shot = 0; shot < 3; shot++) releaseAndSettle(engine, room, 2);
		expect(state.roundNumber).toBe(2);
		expect(state.shotCounts).toEqual([0, 0]);
		expect(room.physicsState?.entities).toHaveLength(0);
	});

});
