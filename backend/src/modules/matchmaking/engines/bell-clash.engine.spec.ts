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
		seq: 0,
		state,
		replayFrames: [],
		replayEvents: [],
		replayLastCapturedSeq: null,
		replayStartedAt: null,
		replayLastRecordedAt: null,
	};
}

describe("BellClashEngine", () => {
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

});
