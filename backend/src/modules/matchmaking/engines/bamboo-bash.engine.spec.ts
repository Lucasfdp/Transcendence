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

	describe("BambooBashEngine", () => {
	it("projects a stopped authoritative shell for every player before launch", () => {
		const engine = new BambooBashEngine();
		const room = makeRoom();
		engine.start(room);

		expect(room.physicsState?.entities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ ownerSide: 0, stopped: true }),
				expect.objectContaining({ ownerSide: 1, stopped: true }),
			]),
		);
	});

	it("advances bamboo growth from the server tick without client input", () => {
		const engine = new BambooBashEngine();
		const room = makeRoom();
		const state = room.state as BambooBashSnapshot;
		engine.start(room);

		expect(engine.advanceSimulation(room, 5_000)).toBe(true);
		expect(state.bamboos.length).toBeGreaterThan(2);
		expect(state.bamboos.find((bamboo) => bamboo.id === 1)?.stage).toBe(2);
		expect(room.physicsState?.physicsSeq).toBeGreaterThan(1);
	});

	it("rejects client transform reports after launching authoritatively", () => {
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

		const syncResult = engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "bamboo:sync",
			payload: {
				roundNumber: 1,
				x: 0.1,
				y: -0.3,
				vx: 20,
				vy: -10,
				stopped: false,
			},
		});

		expect(syncResult).toBeNull();
		expect(state.balls[0]?.x).toBeCloseTo(-0.22);
		expect(state.balls[0]?.y).toBeCloseTo(0);
		expect(state.balls[0]).toMatchObject({ vx: 240, vy: -80 });
		expect(
			state.entities.find((entity) => entity.ownerSide === 0),
		).toMatchObject(state.balls[0] ?? {});
	});

	it("launches the next shell from its authoritative settled position", () => {
		const engine = new BambooBashEngine();
		const room = makeRoom();
		engine.start(room);
		engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "release",
			payload: { roundNumber: 1, vx: 240, vy: -80 },
		});
		const physics = room.physicsState;
		if (!physics) throw new Error("Expected Bamboo physics state");
		const firstShell = physics.entities.find(
			(entity) => entity.ownerSide === 0 && entity.primary,
		);
		if (!firstShell) throw new Error("Expected first player shell");
		firstShell.x = 123;
		firstShell.y = -234;
		firstShell.vx = 0;
		firstShell.vy = 0;
		firstShell.stopped = true;

		engine.handleInput(room, 1, {
			matchId: room.matchId,
			action: "release",
			payload: { roundNumber: 1, vx: 120, vy: 60 },
		});

		expect(
			room.physicsState?.entities.find((entity) => entity.ownerSide === 0),
		).toMatchObject({
			x: 123,
			y: -234,
			vx: 120,
			vy: 60,
			stopped: false,
		});
	});
});
