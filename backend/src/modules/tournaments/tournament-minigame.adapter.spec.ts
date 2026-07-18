/**
 * tournament-minigame.adapter.spec.ts — socket-bound SPEC-015 adapter tests.
 *
 * Covers: the candidate catalog comes from the ONE engine registry filtered by
 * player-count bounds (never a duplicated id list); launch seats every active
 * player from a live socket, creates a CASUAL match through MatchFactory and
 * starts it through the single server-initiated launch rail; a player without
 * a socket aborts the launch; lifecycle signals map the raw room into
 * tournament-shaped results (winnerSide → userId, outcomes per player);
 * reconcile reads the durable rows one-shot.
 */

import { Logger } from "@nestjs/common";
import { Repository } from "typeorm";
import { MatchFactoryService } from "../matchmaking/match-factory.service";
import { MatchLifecycleEvents } from "../matchmaking/match-lifecycle.events";
import { MatchmakingGateway } from "../matchmaking/matchmaking.gateway";
import { GameEngineRegistry } from "../matchmaking/engines/game-engine.registry";
import { Match } from "../matchmaking/entities/match.entity";
import { MatchPlayer } from "../matchmaking/entities/match-player.entity";
import { MatchRoom, SocketUser } from "../matchmaking/matchmaking.types";
import { PresenceService } from "../presence/presence.service";
import { User } from "../users/entities/user.entity";
import { MinigameLifecycleSignal } from "./minigame/minigame.types";
import { TournamentMinigameAdapter } from "./tournament-minigame.adapter";

const socketUser = (id: number): SocketUser =>
	({ id, username: `user-${id}`, isGuest: false }) as SocketUser;

const fakeRoom = (winnerSide: number | null): MatchRoom =>
	({
		matchId: "match-1",
		gameId: "kame-knock",
		players: [
			{ side: 0, user: socketUser(10) },
			{ side: 1, user: socketUser(20) },
		],
		state: { winnerSide },
	}) as unknown as MatchRoom;

function makeAdapter(overrides: { offlineUsers?: number[] } = {}) {
	const offline = new Set(overrides.offlineUsers ?? []);
	const createMatch = jest.fn().mockResolvedValue(fakeRoom(null));
	const startServerInitiatedMatch = jest.fn().mockResolvedValue(fakeRoom(null));
	const lifecycle = new MatchLifecycleEvents();

	const matchFactory = { createMatch } as unknown as MatchFactoryService;
	const gateway = { startServerInitiatedMatch } as unknown as MatchmakingGateway;
	const registry = {
		list: () => [
			{ gameId: "kame-knock", minPlayers: 2, maxPlayers: 5 },
			{ gameId: "duo-only", minPlayers: 2, maxPlayers: 2 },
		],
	} as unknown as GameEngineRegistry;
	const presence = {
		getSocketIds: (userId: number) => (offline.has(userId) ? [] : [`sock-${userId}`]),
		getUser: (socketId: string) =>
			socketUser(Number(socketId.replace("sock-", ""))),
	} as unknown as PresenceService;
	const matchRepo = {
		findOne: jest.fn().mockResolvedValue({ id: "match-1", status: "finished" }),
	} as unknown as Repository<Match>;
	const matchPlayerRepo = {
		find: jest.fn().mockResolvedValue([
			{ userId: 10, side: 0, outcome: "win" },
			{ userId: 20, side: 1, outcome: "loss" },
		]),
	} as unknown as Repository<MatchPlayer>;
	const userRepo = {
		findOne: jest.fn(({ where }: { where: { id: number } }) =>
			Promise.resolve({
				id: where.id,
				username: `user-${where.id}`,
				turtleName: null,
				shellSkin: "base",
				trailEffect: "trail_classic",
				hubBackground: "night_bg",
				hubBackgroundAlter: null,
				isGuest: false,
			}),
		),
	} as unknown as Repository<User>;

	const adapter = new TournamentMinigameAdapter(
		matchFactory,
		lifecycle,
		gateway,
		registry,
		presence,
		matchRepo,
		matchPlayerRepo,
		userRepo,
	);
	return { adapter, createMatch, startServerInitiatedMatch, lifecycle, matchRepo };
}

describe("TournamentMinigameAdapter (SPEC-015 socket-bound)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("candidates come from the engine registry filtered by player bounds", () => {
		const { adapter } = makeAdapter();
		expect(adapter.candidates(4)).toEqual(["kame-knock"]);
		expect(adapter.candidates(2)).toEqual(["kame-knock", "duo-only"]);
		expect(adapter.candidates(6)).toEqual([]);
	});

	it("launch seats live sockets, creates a CASUAL match and uses the launch rail", async () => {
		const { adapter, createMatch, startServerInitiatedMatch } = makeAdapter();
		const result = await adapter.launch({
			tournamentId: "t-1",
			round: 2,
			minigameId: "kame-knock",
			playerIds: [10, 20],
		});

		expect(result).toEqual({ status: "launched", matchId: "match-1" });
		expect(createMatch).toHaveBeenCalledWith({
			gameId: "kame-knock",
			mode: "casual",
			players: [
				{ socketId: "sock-10", user: socketUser(10), shellSelection: [] },
				{ socketId: "sock-20", user: socketUser(20), shellSelection: [] },
			],
			tournamentId: "t-1",
		});
		expect(startServerInitiatedMatch).toHaveBeenCalledWith(
			fakeRoom(null),
			"tournament:minigame-start",
		);
	});

	it("an offline player is seated as a CPU stand-in (bot: socket, real identity)", async () => {
		const { adapter, createMatch } = makeAdapter({ offlineUsers: [20] });
		const result = await adapter.launch({
			tournamentId: "t-1",
			round: 2,
			minigameId: "kame-knock",
			playerIds: [10, 20],
		});

		expect(result).toEqual({ status: "launched", matchId: "match-1" });
		const seated = createMatch.mock.calls[0][0].players;
		expect(seated[0]).toEqual({
			socketId: "sock-10",
			user: socketUser(10),
			shellSelection: [],
		});
		// The stand-in carries the REAL user's identity so outcomes credit them,
		// with the bot: socket marker BotPlayerService drives.
		expect(seated[1].socketId).toBe("bot:20");
		expect(seated[1].user.id).toBe(20);
		expect(seated[1].user.username).toBe("user-20");
	});

	it("maps lifecycle transitions into tournament signals (winnerSide → userId)", () => {
		const { adapter, lifecycle } = makeAdapter();
		const signals: MinigameLifecycleSignal[] = [];
		const unsubscribe = adapter.subscribe((s) => signals.push(s));

		lifecycle.emit({ type: "started", room: fakeRoom(null) });
		lifecycle.emit({ type: "finished", room: fakeRoom(1) });

		expect(signals[0]).toEqual({ type: "started", matchId: "match-1" });
		expect(signals[1].type).toBe("finished");
		expect(signals[1].result?.winnerId).toBe(20); // side 1 → user 20
		expect(signals[1].result?.outcomes.get(10)).toBe("loss");
		expect(signals[1].result?.outcomes.get(20)).toBe("win");

		unsubscribe();
		lifecycle.emit({ type: "finished", room: fakeRoom(0) });
		expect(signals).toHaveLength(2); // unsubscribed
	});

	it("a tie (winnerSide null) maps every player to draw with no winner", () => {
		const { adapter, lifecycle } = makeAdapter();
		const signals: MinigameLifecycleSignal[] = [];
		adapter.subscribe((s) => signals.push(s));
		lifecycle.emit({ type: "finished", room: fakeRoom(null) });

		expect(signals[0].result?.winnerId).toBeNull();
		expect(signals[0].result?.outcomes.get(10)).toBe("draw");
		// No per-side scores on this fake room → everyone is a tie-break
		// candidate (the coordinator's roulette settles it).
		expect(signals[0].result?.tiedPlayerIds).toBeUndefined();
	});

	it("a tie with per-side scores reports only the players tied for the TOP score", () => {
		const { adapter, lifecycle } = makeAdapter();
		const signals: MinigameLifecycleSignal[] = [];
		adapter.subscribe((s) => signals.push(s));

		const room = {
			matchId: "match-1",
			gameId: "kame-knock",
			players: [
				{ side: 0, user: socketUser(10) },
				{ side: 1, user: socketUser(20) },
				{ side: 2, user: socketUser(30) },
			],
			state: { winnerSide: null, score: [7, 3, 7] },
		} as unknown as MatchRoom;
		lifecycle.emit({ type: "finished", room });

		expect(signals[0].result?.winnerId).toBeNull();
		expect(signals[0].result?.tiedPlayerIds).toEqual([10, 30]);
	});

	it("reconcile reads the durable rows one-shot; unfinished matches yield null", async () => {
		const { adapter, matchRepo } = makeAdapter();
		const result = await adapter.reconcile("match-1");
		expect(result?.winnerId).toBe(10);
		expect(result?.outcomes.get(20)).toBe("loss");

		(matchRepo.findOne as jest.Mock).mockResolvedValue({
			id: "match-1",
			status: "active",
		});
		expect(await adapter.reconcile("match-1")).toBeNull();
	});
});
