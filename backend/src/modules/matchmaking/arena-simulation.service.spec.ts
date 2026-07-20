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
		replayEnabled: true,
		replayDisabledReason: null,
		replayStartedAt: null,
		replayLastSampleAt: null,
		replayLastKeyframeAt: null,
		replayLastSnapshot: null,
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
			captureReplayFrame: jest.fn(),
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

	it("coalesces catch-up projections into one broadcast per room", () => {
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
			captureReplayFrame: jest.fn(),
		} as unknown as GameSessionService;
		const service = new ArenaSimulationService(rooms, sessions);
		const internals = service as unknown as {
			lastTickAt: number;
			runFixedSteps: (broadcast: (matchId: string) => void) => void;
		};
		internals.lastTickAt = 0;
		const now = jest.spyOn(performance, "now").mockReturnValue(100);
		const broadcast = jest.fn();

		internals.runFixedSteps(broadcast);
		now.mockRestore();

		expect(sessions.advanceSimulation).toHaveBeenCalledTimes(2);
		expect(broadcast).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenCalledWith(activeRoom.matchId);
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

	it("decimates sustained-motion broadcasts to below the 30 Hz tick rate (R9)", () => {
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
			// Always moving, never settled → the decimation path (not the settle
			// fast-path) governs broadcasting.
			advanceSimulation: jest.fn().mockReturnValue(true),
			captureReplayFrame: jest.fn(),
		} as unknown as GameSessionService;
		const service = new ArenaSimulationService(rooms, sessions);
		const broadcast = jest.fn();

		const ticks = 30;
		for (let i = 0; i < ticks; i++) service.tick(broadcast);

		// 30 simulation ticks must yield fewer broadcasts (≈20) — strictly fewer
		// than one-per-tick, proving the decimation is now live.
		expect(broadcast.mock.calls.length).toBeLessThan(ticks);
		expect(broadcast.mock.calls.length).toBeGreaterThanOrEqual(ticks - 12);
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
			captureReplayFrame: jest.fn(),
		} as unknown as GameSessionService;
		const service = new ArenaSimulationService(rooms, sessions);
		const broadcast = jest.fn();

		service.tick(broadcast);

		expect(broadcast).toHaveBeenCalledWith(activeRoom.matchId);
	});
});
