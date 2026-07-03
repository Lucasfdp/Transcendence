import { GameResultsService } from "../game-results/game-results.service";
import { UsersService } from "../users/users.service";
import { Match } from "./entities/match.entity";
import { MatchPlayer } from "./entities/match-player.entity";
import { UserRating } from "./entities/user-rating.entity";
import { GameEngineRegistry } from "./engines/game-engine.registry";
import { GameSessionService } from "./game-session.service";
import { MatchRoom, RoomPlayer } from "./matchmaking.types";
import { ReplayService } from "./replay.service";
import { RoomService } from "./room.service";

function makePlayer(
	side: number,
	overrides: Partial<RoomPlayer> = {},
): RoomPlayer {
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
		...overrides,
	};
}

function makeRoom(overrides: Partial<MatchRoom> = {}): MatchRoom {
	const players = overrides.players ?? [makePlayer(0), makePlayer(1)];
	return {
		matchId: "match-1",
		gameId: "temple-curling",
		mode: "casual",
		status: "finished",
		players,
		spectators: new Map(),
		seq: 1,
		state: {
			matchId: "match-1",
			seq: 1,
			gameId: "temple-curling",
			mode: "casual",
			powerupsEnabled: true,
			phase: "finished",
			currentTurn: 0,
			turnNumber: 0,
			maxTurns: 0,
			currentEnd: 0,
			throwsInEnd: 0,
			stonesPerPlayer: 3,
			totalEnds: 3,
			score: [1, 0],
			endScores: [[null, null]],
			map: { gameId: "temple-curling" },
			players: [],
			objects: [],
			activeStoneId: null,
			winnerSide: 0,
		},
		replayFrames: [],
		replayEvents: [],
		replayLastCapturedSeq: null,
		replayStartedAt: null,
		replayLastRecordedAt: null,
		replayLastSimulationAt: null,
		...overrides,
	};
}

describe("GameSessionService", () => {
	let service: GameSessionService;
	let roomService: jest.Mocked<RoomService>;
	let engines: jest.Mocked<GameEngineRegistry>;
	let usersService: jest.Mocked<UsersService>;
	let gameResultsService: jest.Mocked<GameResultsService>;
	let replayService: { persistReplayForRoom: jest.Mock };
	let matchRepo: { update: jest.Mock };
	let matchPlayerRepo: { update: jest.Mock };
	let ratingRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
	let dataSource: { transaction: jest.Mock };

	beforeEach(() => {
		roomService = {
			getRoom: jest.fn(),
			start: jest.fn(),
			finish: jest.fn((matchId, winnerSide, abandoned) => {
				const room = roomService.getRoom(matchId);
				if (!room) return null;
				room.status = abandoned ? "abandoned" : "finished";
				room.state.phase = abandoned ? "abandoned" : "finished";
				room.state.winnerSide = winnerSide;
				return room;
			}),
		} as unknown as jest.Mocked<RoomService>;
		engines = { get: jest.fn() } as unknown as jest.Mocked<GameEngineRegistry>;
		usersService = {
			findById: jest.fn(async (id: number) => ({ id, isGuest: false })),
		} as unknown as jest.Mocked<UsersService>;
		gameResultsService = {
			submitResult: jest.fn(),
		} as unknown as jest.Mocked<GameResultsService>;
		replayService = { persistReplayForRoom: jest.fn() };
		matchRepo = { update: jest.fn() };
		matchPlayerRepo = { update: jest.fn() };
		ratingRepo = {
			findOne: jest.fn(),
			create: jest.fn((rating) => rating),
			save: jest.fn(),
		};
		// Transaction mock routes getRepository() to the same repo mocks the
		// tests assert against, so the transactional persistence path is covered.
		dataSource = {
			transaction: jest.fn(
				async (
					callback: (manager: {
						getRepository: (entity: unknown) => unknown;
					}) => unknown,
				) =>
					callback({
						getRepository: (entity: unknown) => {
							if (entity === Match) return matchRepo;
							if (entity === MatchPlayer) return matchPlayerRepo;
							if (entity === UserRating) return ratingRepo;
							throw new Error("Unknown repository");
						},
					}),
			),
		};

		service = new GameSessionService(
			roomService,
			engines,
			usersService,
			gameResultsService,
			replayService as never,
			dataSource as never,
			matchRepo as never,
			matchPlayerRepo as never,
			ratingRepo as never,
		);
	});

	it("grants win to the online winner and loss to connected losers", async () => {
		const room = makeRoom();
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		expect(gameResultsService.submitResult).toHaveBeenCalledTimes(2);
		expect(gameResultsService.submitResult).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ id: 1 }),
			{ gameId: "temple-curling", outcome: "win" },
		);
		expect(gameResultsService.submitResult).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ id: 2 }),
			{ gameId: "temple-curling", outcome: "loss" },
		);
		expect(room.rewardsGranted).toBe(true);
	});

	it("does not grant rewards twice for the same finished room", async () => {
		const room = makeRoom();
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);
		await service.finishIfEnded(room);

		expect(gameResultsService.submitResult).toHaveBeenCalledTimes(2);
	});

	it("grants draw rewards to connected players on draw", async () => {
		const room = makeRoom({
			state: { ...makeRoom().state, winnerSide: null },
		});
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		expect(gameResultsService.submitResult).toHaveBeenCalledTimes(2);
		expect(gameResultsService.submitResult).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ id: 1 }),
			{ gameId: "temple-curling", outcome: "draw" },
		);
		expect(gameResultsService.submitResult).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ id: 2 }),
			{ gameId: "temple-curling", outcome: "draw" },
		);
		expect(room.rewardsGranted).toBe(true);
	});

	it("does not grant rewards for abandoned matches", async () => {
		const room = makeRoom({ status: "abandoned" });
		room.state.phase = "abandoned";
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		expect(gameResultsService.submitResult).not.toHaveBeenCalled();
		expect(room.rewardsGranted).toBe(true);
	});

	it("does not grant loss rewards to disconnected losers", async () => {
		const room = makeRoom({
			players: [makePlayer(0), makePlayer(1, { connected: false })],
		});
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		expect(gameResultsService.submitResult).toHaveBeenCalledTimes(1);
		expect(gameResultsService.submitResult).toHaveBeenCalledWith(
			expect.objectContaining({ id: 1 }),
			{ gameId: "temple-curling", outcome: "win" },
		);
	});
});
