import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { MatchPlayer } from "./entities/match-player.entity";
import { Match } from "./entities/match.entity";
import { GameEngineRegistry } from "./engines/game-engine.registry";
import {
	PRIVATE_LOBBY_NOT_FOUND_MESSAGE,
	PrivateLobbiesService,
} from "./private-lobbies.service";
import { RoomService } from "./room.service";
import { SocketUser } from "./matchmaking.types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMatchRepo = () => ({
	create: jest.fn((v) => v),
	save: jest.fn(async (v) => ({ ...v, id: "match-uuid" })),
});

const mockMatchPlayerRepo = () => ({
	create: jest.fn((v) => v),
	save: jest.fn(async () => []),
});

const mockRoomService = () => ({
	hasActiveRoom: jest.fn().mockReturnValue(false),
	createRoom: jest.fn().mockReturnValue({
		matchId: "match-uuid",
		gameId: "temple-curling",
		mode: "casual",
		status: "pending",
		players: [
			{ user: { id: 1, username: "host", isGuest: false }, side: 0, socketId: "s1", shellSelection: [], ready: false, connected: true },
			{ user: { id: 2, username: "joiner", isGuest: false }, side: 1, socketId: "s2", shellSelection: [], ready: false, connected: true },
		],
		spectators: new Map(),
		seq: 0,
		state: { phase: "pending" },
	}),
});

const mockEngineRegistry = () => ({});

const HOST: SocketUser = { id: 1, username: "host", isGuest: false };
const JOINER: SocketUser = { id: 2, username: "joiner", isGuest: false };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PrivateLobbiesService", () => {
	let service: PrivateLobbiesService;
	let roomService: ReturnType<typeof mockRoomService>;

	beforeEach(async () => {
		roomService = mockRoomService();

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				PrivateLobbiesService,
				{ provide: getRepositoryToken(Match), useValue: mockMatchRepo() },
				{ provide: getRepositoryToken(MatchPlayer), useValue: mockMatchPlayerRepo() },
				{ provide: RoomService, useValue: roomService },
				{ provide: GameEngineRegistry, useValue: mockEngineRegistry() },
			],
		}).compile();

		service = module.get(PrivateLobbiesService);
	});

	afterEach(() => jest.useRealTimers());

	// ── createLobby ──────────────────────────────────────────────────────────

	describe("createLobby", () => {
		it("should create and store a lobby for the host", () => {
			jest.useFakeTimers();
			const onExpiry = jest.fn();
			const lobby = service.createLobby("s1", HOST, "temple-curling", [], onExpiry);

			expect(lobby.lobbyId).toBeTruthy();
			expect(lobby.host.id).toBe(1);
			expect(lobby.gameId).toBe("temple-curling");
			expect(service.getLobby(lobby.lobbyId)).not.toBeNull();
		});

		it("should throw BadRequestException when host is already in a match", () => {
			roomService.hasActiveRoom.mockReturnValue(true);

			expect(() =>
				service.createLobby("s1", HOST, "temple-curling", [], jest.fn()),
			).toThrow(BadRequestException);
		});

		it("should throw BadRequestException when host already has an open lobby", () => {
			jest.useFakeTimers();
			service.createLobby("s1", HOST, "temple-curling", [], jest.fn());

			expect(() =>
				service.createLobby("s1", HOST, "bamboo-bash", [], jest.fn()),
			).toThrow(BadRequestException);
		});

		it("should call onExpiry and remove the lobby after 2 minutes", () => {
			jest.useFakeTimers();
			const onExpiry = jest.fn();
			const lobby = service.createLobby("s1", HOST, "temple-curling", [], onExpiry);

			jest.advanceTimersByTime(2 * 60 * 1_000);

			expect(onExpiry).toHaveBeenCalledWith(expect.objectContaining({ lobbyId: lobby.lobbyId }));
			expect(service.getLobby(lobby.lobbyId)).toBeNull();
		});
	});

	// ── setInvitee / getLobbyForUser ─────────────────────────────────────────

	describe("setInvitee", () => {
		it("should set pendingInviteeId on the lobby", () => {
			jest.useFakeTimers();
			const lobby = service.createLobby("s1", HOST, "temple-curling", [], jest.fn());

			service.setInvitee(lobby.lobbyId, 99);

			expect(service.getLobby(lobby.lobbyId)?.pendingInviteeId).toBe(99);
		});
	});

	// ── joinLobby ────────────────────────────────────────────────────────────

	describe("joinLobby", () => {
		it("should create a match + room and return them on successful join", async () => {
			jest.useFakeTimers();
			const lobby = service.createLobby("s1", HOST, "temple-curling", [], jest.fn());

			const result = await service.joinLobby(lobby.lobbyId, "s2", JOINER, []);

			expect(result).not.toBeNull();
			expect(result?.matchId).toBe("match-uuid");
			expect(roomService.createRoom).toHaveBeenCalledWith(
				"match-uuid",
				"temple-curling",
				"casual",
				expect.arrayContaining([
					expect.objectContaining({ user: HOST }),
					expect.objectContaining({ user: JOINER }),
				]),
				expect.objectContaining({ powerupsEnabled: false }),
			);
		});

		it("should remove the lobby after a successful join", async () => {
			jest.useFakeTimers();
			const lobby = service.createLobby("s1", HOST, "temple-curling", [], jest.fn());

			await service.joinLobby(lobby.lobbyId, "s2", JOINER, []);

			expect(service.getLobby(lobby.lobbyId)).toBeNull();
		});

		it("should return null when the lobby does not exist (expired or cancelled)", async () => {
			const result = await service.joinLobby("nonexistent", "s2", JOINER, []);
			expect(result).toBeNull();
		});

		it("should throw BadRequestException when joiner is already in a match", async () => {
			jest.useFakeTimers();
			roomService.hasActiveRoom.mockReturnValueOnce(false).mockReturnValueOnce(true);
			const lobby = service.createLobby("s1", HOST, "temple-curling", [], jest.fn());

			await expect(
				service.joinLobby(lobby.lobbyId, "s2", JOINER, []),
			).rejects.toThrow(BadRequestException);
		});
	});

	describe("PIN lobbies", () => {
		it("should prefix private room PINs with the Normal game identifier", () => {
			jest.useFakeTimers();
			const expectedPrefixes = [
				["kame-knock", "0"],
				["bamboo-bash", "1"],
				["temple-curling", "2"],
				["bell-clash", "3"],
			] as const;

			for (const [gameId, prefix] of expectedPrefixes) {
				const host = { ...HOST, id: HOST.id + Number(prefix) };
				const lobby = service.createPinLobby(
					`s${prefix}`,
					host,
					gameId,
					2,
					true,
					[],
					jest.fn(),
				);

				expect(lobby.pin).toMatch(new RegExp(`^${prefix}`));
				expect(lobby.pin).toHaveLength(6);
			}
		});

		it("should reject a PIN entered from a different game lobby", async () => {
			jest.useFakeTimers();
			const lobby = service.createPinLobby(
				"s1",
				HOST,
				"temple-curling",
				2,
				true,
				[],
				jest.fn(),
			);

			await expect(
				service.joinPinLobby(lobby.pin!, "bamboo-bash", "s2", JOINER, []),
			).rejects.toThrow(PRIVATE_LOBBY_NOT_FOUND_MESSAGE);
		});
	});

	// ── cancelLobby ──────────────────────────────────────────────────────────

	describe("cancelLobby", () => {
		it("should remove the lobby and clear its expiry timer", () => {
			jest.useFakeTimers();
			const onExpiry = jest.fn();
			const lobby = service.createLobby("s1", HOST, "temple-curling", [], onExpiry);

			service.cancelLobby(lobby.lobbyId);

			// Timer must be cleared — advancing time should NOT call onExpiry
			jest.advanceTimersByTime(2 * 60 * 1_000);
			expect(onExpiry).not.toHaveBeenCalled();
			expect(service.getLobby(lobby.lobbyId)).toBeNull();
		});

		it("should return null for a non-existent lobby", () => {
			expect(service.cancelLobby("does-not-exist")).toBeNull();
		});
	});

	// ── removeLobbyForUser ───────────────────────────────────────────────────

	describe("removeLobbyForUser", () => {
		it("should cancel and return the host's lobby on disconnect", () => {
			jest.useFakeTimers();
			const lobby = service.createLobby("s1", HOST, "temple-curling", [], jest.fn());

			const removed = service.removeLobbyForUser(HOST.id);

			expect(removed?.lobbyId).toBe(lobby.lobbyId);
			expect(service.getLobby(lobby.lobbyId)).toBeNull();
		});

		it("should return null when user has no open lobby", () => {
			expect(service.removeLobbyForUser(999)).toBeNull();
		});
	});
});
