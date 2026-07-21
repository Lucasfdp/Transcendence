import { GameResultsService } from "../game-results/game-results.service";
import { Profile } from "../profiles/entities/profile.entity";
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
		enteredUserIds: new Set(),
		seq: 1,
		state: {
			matchId: "match-1",
			seq: 1,
			gameId: "temple-curling",
			mode: "casual",
			powerupsEnabled: true,
			phase: "finished",
			currentTurn: 0,
			startingTurn: 0,
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
		replayEnabled: true,
		replayDisabledReason: null,
		replayStartedAt: null,
		replayLastSampleAt: null,
		replayLastKeyframeAt: null,
		replayLastSnapshot: null,
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
	let profileRepo: { findOne: jest.Mock; save: jest.Mock };

	beforeEach(() => {
		roomService = {
			getRoom: jest.fn(),
			start: jest.fn(),
			convertSeatToBot: jest.fn((matchId: string) =>
				roomService.getRoom(matchId),
			),
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
		// Rankings Bug Audit M4: `matchRepo.update` is now a conditional
		// `WHERE status = 'active'` update that reports how many rows it
		// touched — default to "found and updated the active match" so every
		// existing test keeps exercising the normal path unchanged. Tests for
		// the M4 guard itself override this to `{ affected: 0 }`.
		matchRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
		matchPlayerRepo = { update: jest.fn() };
		ratingRepo = {
			findOne: jest.fn(),
			create: jest.fn((rating) => rating),
			save: jest.fn(),
		};
		profileRepo = {
			findOne: jest.fn(async () => ({ totalLosses: 0, gamesPlayed: 0 })),
			save: jest.fn(async (p) => p),
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
							if (entity === Profile) return profileRepo;
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

	// ── Rankings Bug Audit §5.2: tournament minigame wins → overall ranking ──
	//
	// Tournament minigames are launched by `TournamentMinigameAdapter.launch`
	// as ordinary `mode: "casual"` matches on the normal matchmaking rail
	// (`MatchFactoryService.createMatch`, carrying `MatchRoom.tournamentId`
	// purely as metadata) — `persistFinishedRoom` has no special case for it.
	// This regression test asserts that flow end-to-end at this layer: a
	// tournament-launched room's finish reaches `submitResult` with a "win"
	// outcome for the winner exactly like any other casual match, which is
	// what increments the winner's `user_game_stats.totalWins` (covered at
	// the persistence layer by `game-results.service.spec.ts`) and therefore
	// the overall leaderboard total.
	it("still grants a win to the winner of a tournament-launched minigame (Rankings Bug Audit §5.2)", async () => {
		const room = makeRoom({ tournamentId: "tournament-1" });
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
			state: { ...makeRoom().state, winnerSide: null, score: [1, 1] },
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

	it("does not grant XP/coin rewards to CPU bot accounts (users.isBot)", async () => {
		// A CPU-owned ACCOUNT (tournament add-cpu bot) earns nothing; note
		// this is distinct from a bot SEAT standing in for an offline real
		// player, which must keep crediting the real (isBot: false) user.
		usersService.findById = jest.fn(async (id: number) => ({
			id,
			isGuest: false,
			isBot: id === 2,
		})) as never;
		const room = makeRoom({
			players: [makePlayer(0), makePlayer(1)],
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
			{ id: room.matchId, status: "active" },
			expect.objectContaining({ winnerUserId: 1, winnerSide: 0 }),
		);
	});

	it("abandon() records a loss on the abandoning player's record (leaving = a loss)", async () => {
		const room = makeRoom({ status: "active" });
		roomService.getRoom.mockReturnValue(room);
		engine.abandon.mockReturnValue(0); // side 0 wins; side 1 abandoned

		await service.abandon(room, room.players[1]);

		expect(profileRepo.findOne).toHaveBeenCalledWith({
			where: { user: { id: room.players[1].user.id } },
		});
		expect(profileRepo.save).toHaveBeenCalledWith(
			expect.objectContaining({ totalLosses: 1, gamesPlayed: 1 }),
		);
		// Abandon path grants no consolation XP/coins.
		expect(gameResultsService.submitResult).not.toHaveBeenCalled();
	});

	it("abandon() does not record a loss for a guest or a CPU stand-in", async () => {
		const guestRoom = makeRoom({
			status: "active",
			players: [makePlayer(0), makePlayer(1, { user: { id: 2, username: "g", isGuest: true } })],
		});
		roomService.getRoom.mockReturnValue(guestRoom);
		engine.abandon.mockReturnValue(0);
		await service.abandon(guestRoom, guestRoom.players[1]);
		expect(profileRepo.save).not.toHaveBeenCalled();

		jest.clearAllMocks();
		profileRepo.findOne.mockResolvedValue({ totalLosses: 0, gamesPlayed: 0 });
		const botRoom = makeRoom({
			status: "active",
			players: [makePlayer(0), makePlayer(1, { socketId: "bot:2" })],
		});
		roomService.getRoom.mockReturnValue(botRoom);
		engine.abandon.mockReturnValue(0);
		await service.abandon(botRoom, botRoom.players[1]);
		expect(profileRepo.save).not.toHaveBeenCalled();
	});

	it("abandon() keeps a 3+ player match alive with a CPU stand-in instead of ending it (P5)", async () => {
		const room = makeRoom({
			status: "active",
			players: [makePlayer(0), makePlayer(1), makePlayer(2)],
		});
		roomService.getRoom.mockReturnValue(room);

		const result = await service.abandon(room, room.players[1]);

		expect(result?.outcome).toBe("continued");
		expect(roomService.convertSeatToBot).toHaveBeenCalledWith(
			"match-1",
			room.players[1].user.id,
		);
		// The match is NOT settled: no forfeit finish, no persistence, no loss.
		expect(roomService.finish).not.toHaveBeenCalled();
		expect(engine.onRoomClosed).not.toHaveBeenCalled();
		expect(profileRepo.save).not.toHaveBeenCalled();
	});

	it("abandon() still forfeits a 3+ match once only one human remains (P5)", async () => {
		const room = makeRoom({
			status: "active",
			players: [
				makePlayer(0),
				makePlayer(1),
				makePlayer(2, { socketId: "bot:3" }),
			],
		});
		roomService.getRoom.mockReturnValue(room);
		engine.abandon.mockReturnValue(0);

		// Seat 1 leaves; the only other non-bot human is seat 0, so this still
		// continues. Now seat 0 leaves — no other human remains → forfeit.
		await service.abandon(room, room.players[1]);
		room.players[1].socketId = "bot:2"; // seat 1 is now a stand-in
		jest.clearAllMocks();
		roomService.getRoom.mockReturnValue(room);
		roomService.finish.mockReturnValue(room);
		engine.abandon.mockReturnValue(2);

		const result = await service.abandon(room, room.players[0]);
		expect(result?.outcome).toBe("finished");
		expect(roomService.finish).toHaveBeenCalledWith("match-1", 2, true);
	});

	it("abort() tears the match down as a winnerless abandon (no rewards, engine cleaned)", async () => {
		const room = makeRoom({ status: "active" });
		room.state.winnerSide = 0;
		roomService.getRoom.mockReturnValue(room);

		const finished = await service.abort(room);

		// Finished as abandoned with no winner.
		expect(roomService.finish).toHaveBeenCalledWith("match-1", null, true);
		expect(finished?.status).toBe("abandoned");
		expect(finished?.state.winnerSide).toBeNull();
		expect(engine.onRoomClosed).toHaveBeenCalledWith(room);
		// Persisted as abandoned with a null winner; no XP/coins granted.
		expect(matchRepo.update).toHaveBeenCalledWith(
			{ id: "match-1", status: "active" },
			expect.objectContaining({ status: "abandoned", winnerUserId: null }),
		);
		expect(gameResultsService.submitResult).not.toHaveBeenCalled();
	});

	it("cleans engine room state when an abandon is persisted", async () => {
		const room = makeRoom({ status: "active" });
		room.state.phase = "active";
		roomService.getRoom.mockReturnValue(room);
		engine.abandon.mockReturnValue(0);

		await service.abandon(room, room.players[1]);

		expect(engine.onRoomClosed).toHaveBeenCalledWith(room);
	});

	// ── Rankings Bug Audit M4: durable idempotency guard ─────────────────────

	it("skips rewards, ratings, and replay persistence when the match row is no longer active", async () => {
		// Simulates a duplicate re-entry into finish/abandon for a match another
		// persistence pass already finished: the `WHERE status = 'active'`
		// update matches 0 rows.
		matchRepo.update.mockResolvedValue({ affected: 0 });
		const room = makeRoom();
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		expect(matchPlayerRepo.update).not.toHaveBeenCalled();
		expect(gameResultsService.submitResult).not.toHaveBeenCalled();
		expect(replayService.persistReplayForRoom).not.toHaveBeenCalled();
		// Still marked granted locally so a second in-process retry short-circuits
		// on the fast in-memory path instead of re-entering the transaction.
		expect(room.rewardsGranted).toBe(true);
	});

	it("still grants rewards normally when the match row is active", async () => {
		matchRepo.update.mockResolvedValue({ affected: 1 });
		const room = makeRoom();
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		expect(gameResultsService.submitResult).toHaveBeenCalledTimes(2);
		expect(replayService.persistReplayForRoom).toHaveBeenCalledWith(room);
		expect(room.rewardsGranted).toBe(true);
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
		return {
			userId,
			gameId: "temple-curling",
			rating,
			wins: 0,
			losses: 0,
			draws: 0,
		};
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
		matchRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
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

	// ── Rankings Bug Audit N9: first ranked match for brand-new players ───────

	it("initialises finite rating defaults for first-time ranked players (no NaN)", async () => {
		// TypeORM's create() does NOT apply `@Column({ default })` values on
		// the JS object — those are database-level defaults. With
		// `findOne -> null` (a player's very first ranked match) the pre-fix
		// code fed `undefined` into the Elo maths, saved NaN rating/wins,
		// Postgres rejected the INSERT, and the entire match-persistence
		// transaction rolled back: no rating, no XP, no recorded outcome.
		// The mocked `create` above mirrors TypeORM by returning its input
		// untouched, so this test fails on the pre-fix code.
		ratingRepo.findOne = jest.fn().mockResolvedValue(null);

		const room = makeRoom({ mode: "ranked" });
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		// Both start from the initialised 1000 default: +16 / -16 at K=32.
		expect(savedRatings[1]).toBe(1016);
		expect(savedRatings[2]).toBe(984);
		for (const call of ratingRepo.save.mock.calls) {
			const saved = call[0] as {
				rating: number;
				wins: number;
				losses: number;
				draws: number;
			};
			expect(Number.isFinite(saved.rating)).toBe(true);
			expect(Number.isFinite(saved.wins)).toBe(true);
			expect(Number.isFinite(saved.losses)).toBe(true);
			expect(Number.isFinite(saved.draws)).toBe(true);
		}
	});

	// ── Rankings Bug Audit M3: ranked draws ───────────────────────────────────

	it("increments draws and applies a 0.5-score Elo delta for a ranked draw", async () => {
		const p0 = makeRating(1, 1000);
		const p1 = makeRating(2, 1000);
		ratingRepo.findOne = jest
			.fn()
			.mockResolvedValueOnce(p0)
			.mockResolvedValueOnce(p1);

		const room = makeRoom({
			mode: "ranked",
			state: { ...makeRoom().state, winnerSide: null, score: [1, 1] },
		});
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		// Equal starting ratings, 0.5 score for both sides -> expected 0.5,
		// delta 0, but `draws` still increments (the pre-fix bug: this whole
		// method used to be skipped for a draw, so neither the rating nor
		// `draws` ever changed).
		expect(savedRatings[1]).toBe(1000);
		expect(savedRatings[2]).toBe(1000);
		expect(p0.draws).toBe(1);
		expect(p1.draws).toBe(1);
		expect(p0.wins).toBe(0);
		expect(p0.losses).toBe(0);
	});

	it("moves rating toward the higher-rated player on an uneven draw", async () => {
		const underdog = makeRating(1, 900);
		const favorite = makeRating(2, 1100);
		ratingRepo.findOne = jest
			.fn()
			.mockResolvedValueOnce(underdog)
			.mockResolvedValueOnce(favorite);

		const room = makeRoom({
			mode: "ranked",
			state: { ...makeRoom().state, winnerSide: null, score: [1, 1] },
		});
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		// The underdog drawing a higher-rated opponent gains rating; the
		// favorite drawing a lower-rated opponent loses rating.
		expect(savedRatings[1]).toBeGreaterThan(900);
		expect(savedRatings[2]).toBeLessThan(1100);
	});

	// ── P4: pairwise multiplayer Elo ──────────────────────────────────────────

	it("scores a 3-player match pairwise: a clear loser loses rating and records a loss, not a draw", async () => {
		const p0 = makeRating(1, 1000);
		const p1 = makeRating(2, 1000);
		const p2 = makeRating(3, 1000);
		ratingRepo.findOne = jest
			.fn()
			.mockResolvedValueOnce(p0)
			.mockResolvedValueOnce(p1)
			.mockResolvedValueOnce(p2);

		// Seats 0 and 1 tie for first; seat 2 is a clear last.
		const room = makeRoom({
			mode: "ranked",
			players: [makePlayer(0), makePlayer(1), makePlayer(2)],
			state: {
				...makeRoom().state,
				winnerSide: null,
				score: [5, 5, 1],
			},
		});
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		// Tied leaders gain equally; the loser loses; the deltas are zero-sum.
		expect(savedRatings[1]).toBe(1008);
		expect(savedRatings[2]).toBe(1008);
		expect(savedRatings[3]).toBe(984);
		expect(
			savedRatings[1] + savedRatings[2] + savedRatings[3],
		).toBe(3000);
		// The clear loser records a loss — the old average-based design recorded
		// a draw here (winnerSide === null) and could even gain rating.
		expect(p2.losses).toBe(1);
		expect(p2.draws).toBe(0);
		expect(p0.draws).toBe(1);
		expect(p1.draws).toBe(1);
	});

	// ── Rankings Bug Audit L5: divide-by-zero guard ───────────────────────────

	it("does not throw or write a rating for a single-player ranked room", async () => {
		const room = makeRoom({
			mode: "ranked",
			players: [makePlayer(0)],
			state: { ...makeRoom().state, winnerSide: 0, score: [1] },
		});
		roomService.getRoom.mockReturnValue(room);

		await expect(service.finishIfEnded(room)).resolves.not.toThrow();
		expect(ratingRepo.save).not.toHaveBeenCalled();
	});

	// ── Rankings Bug Audit L6: row lock ────────────────────────────────────────

	it("locks the rating row with pessimistic_write before reading it", async () => {
		const p0 = makeRating(1, 1000);
		const p1 = makeRating(2, 1000);
		const findOneMock = jest
			.fn()
			.mockResolvedValueOnce(p0)
			.mockResolvedValueOnce(p1);
		ratingRepo.findOne = findOneMock;

		const room = makeRoom({ mode: "ranked" });
		roomService.getRoom.mockReturnValue(room);

		await service.finishIfEnded(room);

		expect(findOneMock).toHaveBeenCalledWith(
			expect.objectContaining({ lock: { mode: "pessimistic_write" } }),
		);
	});
});
