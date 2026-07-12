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
		seq: 0,
		state,
		replayFrames: [],
		replayEvents: [],
		replayLastCapturedSeq: null,
		replayStartedAt: null,
		replayLastRecordedAt: null,
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
});
