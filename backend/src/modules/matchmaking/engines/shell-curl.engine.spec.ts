import { ShellCurlEngine } from "./shell-curl.engine";
import { CurlingSnapshot, MatchRoom, RoomPlayer } from "../matchmaking.types";

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

function makeRoom(playerCount = 2): MatchRoom {
	const engine = new ShellCurlEngine();
	const players = Array.from({ length: playerCount }, (_value, side) =>
		makePlayer(side),
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

describe("ShellCurlEngine", () => {
	it("resolves abandon winners from the connected non-abandoning players", () => {
		const engine = new ShellCurlEngine();
		const room = makeRoom(3);
		const state = room.state as CurlingSnapshot;
		state.score = [2, 9, 5];
		room.players[2].connected = false;

		expect(engine.abandon(room, room.players[0])).toBe(1);
	});

	it("rejects duplicate settled packets once the pending turn has been consumed", () => {
		const engine = new ShellCurlEngine();
		const room = makeRoom(2);
		engine.start(room);

		engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "release",
			payload: { vx: 320, vy: -120 },
		});

		const firstSettledPayload = {
			objects: (room.state as CurlingSnapshot).objects.map((object) => ({
				id: object.id,
				side: object.side,
				x: object.x,
				y: object.y,
				vx: 0,
				vy: 0,
				moving: false,
				power: object.power,
			})),
		};

		const firstResult = engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "settled",
			payload: firstSettledPayload,
		});

		expect(firstResult).toBe(room);
		expect((room.state as CurlingSnapshot).turnNumber).toBe(1);

		(room.state as CurlingSnapshot).currentTurn = 0;

		const duplicateResult = engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "settled",
			payload: firstSettledPayload,
		});

		expect(duplicateResult).toBeNull();
		expect((room.state as CurlingSnapshot).turnNumber).toBe(1);
	});
});
