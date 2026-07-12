import { BambooBashEngine } from "./bamboo-bash.engine";
import {
	BambooBashSnapshot,
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

function makeRoom(): MatchRoom {
	const engine = new BambooBashEngine();
	const players = [makePlayer(0), makePlayer(1)];
	const state = engine.createInitialState(
		{
			matchId: "match-bamboo",
			gameId: "bamboo-bash",
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
		matchId: "match-bamboo",
		gameId: "bamboo-bash",
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

describe("BambooBashEngine", () => {
	it("advances launched balls from the server simulation", () => {
		const engine = new BambooBashEngine();
		const room = makeRoom();
		const state = room.state as BambooBashSnapshot;
		engine.start(room);

		engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "release",
			payload: {
				roundNumber: 1,
				x: -0.22,
				y: 0,
				vx: 240,
				vy: -80,
			},
		});

		const before = { x: state.balls[0].x, y: state.balls[0].y };
		expect(engine.advanceSimulation(room, 1_000 / 30)).toBe(true);
		expect(state.balls[0]).not.toMatchObject(before);
		expect(state.entities[0]).toMatchObject(state.balls[0]);
	});
});
