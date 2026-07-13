import { ArenaSimulationService } from "./arena-simulation.service";
import { GameSessionService } from "./game-session.service";
import { MatchRoom } from "./matchmaking.types";
import { RoomService } from "./room.service";

function room(): MatchRoom {
	return {
		matchId: "bell-room",
		gameId: "bell-clash",
		mode: "casual",
		status: "active",
		players: [],
		spectators: new Map(),
		seq: 0,
		state: { seq: 0 } as MatchRoom["state"],
		physicsState: {
			matchId: "bell-room",
			physicsSeq: 1,
			serverTime: 0,
			entities: [],
			pickups: [],
			scoreEvents: [],
			nextEntityId: 1,
			nextPickupId: 1,
			nextScoreEventId: 1,
			bellCooldownMs: [],
		},
		replayFrames: [],
		replayEvents: [],
		replayLastCapturedSeq: null,
		replayStartedAt: null,
		replayLastRecordedAt: null,
	};
}

describe("ArenaSimulationService", () => {
	it("runs fixed simulation steps from elapsed timer time", () => {
		jest.useFakeTimers();
		const activeRoom = room();
		activeRoom.physicsState?.entities.push({
			id: 1,
			ownerSide: 0,
			shotNumber: 1,
			primary: true,
			x: 0,
			y: 0,
			vx: 100,
			vy: 0,
			radius: 52,
			rotation: 0,
			angularVelocity: 0,
			power: "none",
			stopped: false,
			alpha: 1,
			ghostCollisionAvailable: false,
		});
		const rooms = {
			getActiveRooms: jest.fn().mockReturnValue([activeRoom]),
		} as unknown as RoomService;
		const sessions = {
			advanceSimulation: jest.fn().mockReturnValue(true),
		} as unknown as GameSessionService;
		const service = new ArenaSimulationService(rooms, sessions);
		const broadcast = jest.fn();

		service.start(broadcast);
		jest.advanceTimersByTime(120);
		service.stop();
		jest.useRealTimers();

		expect(
			(sessions.advanceSimulation as jest.Mock).mock.calls.length,
		).toBeGreaterThanOrEqual(2);
	});

	it("publishes the initial physics projection exactly once while idle", () => {
		const activeRoom = room();
		const rooms = {
			getActiveRooms: jest.fn().mockReturnValue([activeRoom]),
		} as unknown as RoomService;
		const sessions = {
			advanceSimulation: jest.fn().mockReturnValue(false),
		} as unknown as GameSessionService;
		const service = new ArenaSimulationService(rooms, sessions);
		const broadcast = jest.fn();

		service.tick(broadcast);
		service.tick(broadcast);

		expect(broadcast).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenCalledWith(activeRoom.matchId);
	});

	it("forces the final empty projection after a lifecycle transition", () => {
		const activeRoom = room();
		activeRoom.physicsState?.entities.push({
			id: 1,
			ownerSide: 0,
			shotNumber: 3,
			primary: true,
			x: 0,
			y: 0,
			vx: 0,
			vy: 0,
			radius: 52,
			rotation: 0,
			angularVelocity: 0,
			power: "none",
			stopped: false,
			alpha: 1,
			ghostCollisionAvailable: false,
		});
		const rooms = {
			getActiveRooms: jest.fn().mockReturnValue([activeRoom]),
		} as unknown as RoomService;
		const sessions = {
			advanceSimulation: jest.fn(() => {
				if (activeRoom.physicsState) activeRoom.physicsState.entities = [];
				return true;
			}),
		} as unknown as GameSessionService;
		const service = new ArenaSimulationService(rooms, sessions);
		const broadcast = jest.fn();

		service.tick(broadcast);

		expect(broadcast).toHaveBeenCalledWith(activeRoom.matchId);
	});
});
