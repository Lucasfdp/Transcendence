import { GameResultsService } from "../game-results/game-results.service";
import { UsersService } from "../users/users.service";
import { Match } from "./entities/match.entity";
import { MatchPlayer } from "./entities/match-player.entity";
import { UserRating } from "./entities/user-rating.entity";
import { GameEngineRegistry } from "./engines/game-engine.registry";
import { GameSessionService } from "./game-session.service";
import { MatchLifecycleEvents } from "./match-lifecycle.events";
import { MatchRoom, RoomPlayer } from "./matchmaking.types";
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
			ballsPerPlayer: 3,
			totalEnds: 3,
			score: [1, 0],
			endScores: [[null, null]],
			map: { gameId: "temple-curling" },
			players: [],
			objects: [],
			entities: [],
			activeBallId: null,
			winnerSide: 0,
		},
		replayFrames: [],
		replayEvents: [],
		replayLastCapturedSeq: null,
		replayStartedAt: null,
		replayLastRecordedAt: null,
		...overrides,
	};
}

describe("GameSessionService", () => {
	let service: GameSessionService;
	let roomService: jest.Mocked<RoomService>;
	let engines: jest.Mocked<GameEngineRegistry>;
	let engine: {
		abandon: jest.Mock;
		onRoomClosed: jest.Mock;
	};
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
		engine = {
			abandon: jest.fn(),
			onRoomClosed: jest.fn(),
		};
		engines.get.mockReturnValue(engine as never);
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
			new MatchLifecycleEvents(),
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

	it("still grants loss rewards to a disconnected loser (outcome-based eligibility)", async () => {
		const room = makeRoom({
			players: [makePlayer(0), makePlayer(1, { connected: false })],
		});
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		expect(gameResultsService.submitResult).toHaveBeenCalledTimes(2);
		expect(gameResultsService.submitResult).toHaveBeenCalledWith(
			expect.objectContaining({ id: 2 }),
			{ gameId: "temple-curling", outcome: "loss" },
		);
	});

	it("still grants win rewards to a winner whose socket blips at match end (Bug Audit M6)", async () => {
		const room = makeRoom({
			players: [
				makePlayer(0, { connected: false }),
				makePlayer(1, { connected: true }),
			],
		});
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		expect(gameResultsService.submitResult).toHaveBeenCalledTimes(2);
		expect(gameResultsService.submitResult).toHaveBeenCalledWith(
			expect.objectContaining({ id: 1 }),
			{ gameId: "temple-curling", outcome: "win" },
		);
	});

	it("still does not grant rewards to guests regardless of connection state", async () => {
		usersService.findById = jest.fn(async (id: number) => ({
			id,
			isGuest: id === 2,
		})) as never;
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

	it("persists winnerUserId by matching player.side instead of player array position", async () => {
		const room = makeRoom({
			players: [makePlayer(1), makePlayer(0)],
		});
		room.state.winnerSide = 0;
		room.state.score = [3, 1];
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		expect(matchRepo.update).toHaveBeenCalledWith(
			room.matchId,
			expect.objectContaining({ winnerUserId: 1, winnerSide: 0 }),
		);
	});

	it("cleans engine room state when an abandon is persisted", async () => {
		const room = makeRoom({ status: "active" });
		room.state.phase = "active";
		roomService.getRoom.mockReturnValue(room);
		engine.abandon.mockReturnValue(0);

		await service.abandon(room, room.players[1]);

		expect(engine.onRoomClosed).toHaveBeenCalledWith(room);
	});
});

describe("GameSessionService — applyEloRatings (Bug Audit H1)", () => {
	let service: GameSessionService;
	let roomService: jest.Mocked<RoomService>;
	let usersService: jest.Mocked<UsersService>;
	let gameResultsService: jest.Mocked<GameResultsService>;
	let replayService: { persistReplayForRoom: jest.Mock };
	let matchRepo: { update: jest.Mock };
	let matchPlayerRepo: { update: jest.Mock };
	let ratingRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
	let dataSource: { transaction: jest.Mock };
	let savedRatings: Record<number, number>;

	function makeRating(userId: number, rating: number) {
		return { userId, gameId: "temple-curling", rating, wins: 0, losses: 0 };
	}

	beforeEach(() => {
		savedRatings = {};
		roomService = {
			getRoom: jest.fn(),
			finish: jest.fn((matchId, winnerSide) => {
				const room = roomService.getRoom(matchId);
				if (!room) return null;
				room.status = "finished";
				room.state.phase = "finished";
				room.state.winnerSide = winnerSide;
				return room;
			}),
		} as unknown as jest.Mocked<RoomService>;
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
			save: jest.fn(async (rating) => {
				savedRatings[rating.userId] = rating.rating;
				return rating;
			}),
		};
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
			{
				get: jest.fn(() => ({ onRoomClosed: jest.fn() })),
			} as unknown as jest.Mocked<GameEngineRegistry>,
			usersService,
			gameResultsService,
			replayService as never,
			dataSource as never,
			matchRepo as never,
			matchPlayerRepo as never,
			ratingRepo as never,
			new MatchLifecycleEvents(),
		);
	});

	it("computes a zero-sum, order-independent delta for a 2-player ranked match", async () => {
		// Both directions of iteration must yield the same +/- delta magnitude:
		// with the pre-fix bug, player 0's delta fed into player 1's expected
		// score because ratings[0].rating was already mutated in place.
		const p0 = makeRating(1, 1000);
		const p1 = makeRating(2, 1000);
		ratingRepo.findOne = jest
			.fn()
			.mockResolvedValueOnce(p0)
			.mockResolvedValueOnce(p1);

		const room = makeRoom({ mode: "ranked" });
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		// Equal starting ratings, winner side 0 -> +16 / -16 at K=32.
		expect(savedRatings[1]).toBe(1016);
		expect(savedRatings[2]).toBe(984);
	});
});
