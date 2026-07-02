import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import type { Socket } from "socket.io";
import { FriendsService } from "../friends/friends.service";
import { NotificationsService } from "../notifications/notifications.service";
import { UsersService } from "../users/users.service";
import { GameSessionService } from "./game-session.service";
import { MatchmakingGateway } from "./matchmaking.gateway";
import { MatchmakingService } from "./matchmaking.service";
import type { MatchRoom, RoomPlayer, SocketUser } from "./matchmaking.types";
import { PresenceService } from "./presence.service";
import { PrivateLobbiesService } from "./private-lobbies.service";
import { ReplayService } from "./replay.service";
import { RoomService } from "./room.service";

/**
 * Focused spec for the presence-sync glue added in Batch 2:
 *   - syncRoomPresence(): keeps PresenceService's in-game markers aligned
 *     with a room's lifecycle (active/pending -> in-game, finished/abandoned -> cleared).
 *   - handleDisconnect(): records UsersService.markSeen() once a non-guest
 *     user's *last* socket disconnects.
 *
 * This gateway has 10 constructor dependencies and no existing test harness
 * (see SOCIAL_TAB_HANDOFF.md §6/§8) — everything except PresenceService and
 * UsersService is mocked as a minimal no-op stub since this spec only
 * exercises the two presence-related code paths, not the full gateway
 * surface (queueing, rooms, lobbies, replays, etc. already have their own
 * service-level specs).
 */

const makePresenceMock = () => ({
	setInGame: jest.fn(),
	clearInGame: jest.fn(),
	disconnect: jest.fn(),
	isOnline: jest.fn().mockReturnValue(false),
	getSocketIds: jest.fn().mockReturnValue([]),
});

const makeUsersServiceMock = () => ({
	markSeen: jest.fn().mockResolvedValue(undefined),
	findById: jest.fn(),
});

const makePlayer = (userId: number, overrides: Partial<RoomPlayer> = {}): RoomPlayer => ({
	socketId: `socket-${userId}`,
	user: { id: userId, username: `user${userId}`, isGuest: false },
	side: 0,
	shellSelection: [],
	ready: true,
	connected: true,
	...overrides,
});

const makeRoom = (overrides: Partial<MatchRoom> = {}): MatchRoom =>
	({
		matchId: "match-1",
		gameId: "bamboo-bash",
		mode: "ranked",
		status: "active",
		players: [makePlayer(1), makePlayer(2)],
		spectators: new Map(),
		seq: 0,
		state: {} as MatchRoom["state"],
		replayFrames: [],
		...overrides,
	}) as MatchRoom;

const makeSocket = (overrides: Partial<{ id: string; data: Record<string, unknown> }> = {}): Socket =>
	({
		id: "socket-abc",
		data: {},
		...overrides,
	}) as unknown as Socket;

describe("MatchmakingGateway", () => {
	let gateway: MatchmakingGateway;
	let presence: ReturnType<typeof makePresenceMock>;
	let usersService: ReturnType<typeof makeUsersServiceMock>;
	let rooms: {
		removeSpectator: jest.Mock;
		markDisconnected: jest.Mock;
		setReady: jest.Mock;
		getRoom: jest.Mock;
	};
	let matchmaking: { removeSocket: jest.Mock };
	let privateLobbies: { removeLobbyForUser: jest.Mock; joinLobby: jest.Mock };
	let sessions: { startIfReady: jest.Mock };
	let replays: { captureFrame: jest.Mock };

	beforeEach(async () => {
		presence = makePresenceMock();
		usersService = makeUsersServiceMock();
		rooms = {
			removeSpectator: jest.fn(),
			markDisconnected: jest.fn().mockReturnValue(null),
			setReady: jest.fn(),
			getRoom: jest.fn(),
		};
		matchmaking = { removeSocket: jest.fn() };
		privateLobbies = {
			removeLobbyForUser: jest.fn().mockReturnValue(null),
			joinLobby: jest.fn(),
		};
		sessions = { startIfReady: jest.fn() };
		replays = { captureFrame: jest.fn() };

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				MatchmakingGateway,
				{ provide: JwtService, useValue: {} },
				{ provide: UsersService, useValue: usersService },
				{ provide: PresenceService, useValue: presence },
				{ provide: MatchmakingService, useValue: matchmaking },
				{ provide: RoomService, useValue: rooms },
				{ provide: GameSessionService, useValue: sessions },
				{ provide: NotificationsService, useValue: {} },
				{ provide: PrivateLobbiesService, useValue: privateLobbies },
				{ provide: FriendsService, useValue: {} },
				{ provide: ReplayService, useValue: replays },
			],
		}).compile();

		gateway = module.get(MatchmakingGateway);
	});

	// ── syncRoomPresence (private — invoked via cast, no public seam) ──────────

	describe("syncRoomPresence", () => {
		const callSyncRoomPresence = (room: MatchRoom): void => {
			(gateway as unknown as { syncRoomPresence: (r: MatchRoom) => void }).syncRoomPresence(room);
		};

		it("should mark every player in-game when the room is active", () => {
			const room = makeRoom({ status: "active", gameId: "bamboo-bash" });
			callSyncRoomPresence(room);

			expect(presence.setInGame).toHaveBeenCalledWith(1, "bamboo-bash");
			expect(presence.setInGame).toHaveBeenCalledWith(2, "bamboo-bash");
			expect(presence.clearInGame).not.toHaveBeenCalled();
		});

		it("should mark every player in-game when the room is pending", () => {
			const room = makeRoom({ status: "pending", gameId: "kame-knock" });
			callSyncRoomPresence(room);

			expect(presence.setInGame).toHaveBeenCalledWith(1, "kame-knock");
			expect(presence.setInGame).toHaveBeenCalledWith(2, "kame-knock");
		});

		it("should clear in-game for every player when the room has finished", () => {
			const room = makeRoom({ status: "finished" });
			callSyncRoomPresence(room);

			expect(presence.clearInGame).toHaveBeenCalledWith(1);
			expect(presence.clearInGame).toHaveBeenCalledWith(2);
			expect(presence.setInGame).not.toHaveBeenCalled();
		});

		it("should clear in-game for every player when the room was abandoned", () => {
			const room = makeRoom({ status: "abandoned" });
			callSyncRoomPresence(room);

			expect(presence.clearInGame).toHaveBeenCalledWith(1);
			expect(presence.clearInGame).toHaveBeenCalledWith(2);
		});

		it("should do nothing for a room with no players", () => {
			const room = makeRoom({ status: "active", players: [] });
			callSyncRoomPresence(room);

			expect(presence.setInGame).not.toHaveBeenCalled();
			expect(presence.clearInGame).not.toHaveBeenCalled();
		});
	});

	// ── handleDisconnect — markSeen-on-fully-offline ───────────────────────────

	describe("handleDisconnect", () => {
		it("should call usersService.markSeen when a non-guest user's last socket disconnects", async () => {
			const disconnectedUser: SocketUser = { id: 5, username: "kame", isGuest: false };
			presence.disconnect.mockReturnValue(disconnectedUser);
			presence.isOnline.mockReturnValue(false);

			await gateway.handleDisconnect(makeSocket());

			expect(usersService.markSeen).toHaveBeenCalledWith(5);
		});

		it("should not call markSeen for a guest user", async () => {
			const disconnectedUser: SocketUser = { id: 6, username: "guest6", isGuest: true };
			presence.disconnect.mockReturnValue(disconnectedUser);
			presence.isOnline.mockReturnValue(false);

			await gateway.handleDisconnect(makeSocket());

			expect(usersService.markSeen).not.toHaveBeenCalled();
		});

		it("should not call markSeen when the user still has another socket online", async () => {
			const disconnectedUser: SocketUser = { id: 7, username: "kame7", isGuest: false };
			presence.disconnect.mockReturnValue(disconnectedUser);
			presence.isOnline.mockReturnValue(true); // another tab is still connected

			await gateway.handleDisconnect(makeSocket());

			expect(usersService.markSeen).not.toHaveBeenCalled();
		});

		it("should not call markSeen when presence.disconnect finds no matching user", async () => {
			presence.disconnect.mockReturnValue(null);

			await gateway.handleDisconnect(makeSocket());

			expect(usersService.markSeen).not.toHaveBeenCalled();
		});

		it("should not throw when markSeen rejects (non-fatal)", async () => {
			const disconnectedUser: SocketUser = { id: 8, username: "kame8", isGuest: false };
			presence.disconnect.mockReturnValue(disconnectedUser);
			presence.isOnline.mockReturnValue(false);
			usersService.markSeen.mockRejectedValue(new Error("db down"));

			await expect(gateway.handleDisconnect(makeSocket())).resolves.toBeUndefined();
		});
	});

	// ── onLobbyJoin — invite matches must start immediately (Task A fix) ──────
	//
	// Root cause under test: private-lobby invite matches used to be created
	// "pending" and left that way forever (nobody ever emitted room:ready), so
	// the engine rejected all input ("Launching..." never resolved) and
	// phase-gated HUD panels never rendered (missing borders). The fix mirrors
	// normal matchmaking's room:ready -> startIfReady hand-off inline in
	// onLobbyJoin: mark both players ready, start the session, and broadcast
	// the resulting (now active) game:state to the whole match room.
	describe("onLobbyJoin", () => {
		const makeConnSocket = (id: string, userId: number, username: string): Socket =>
			({
				id,
				data: { user: { id: userId, username, isGuest: false } },
				emit: jest.fn(),
			}) as unknown as Socket;

		const makeRoomSocket = (id: string) =>
			({ id, join: jest.fn(), emit: jest.fn() }) as unknown as Socket & {
				join: jest.Mock;
				emit: jest.Mock;
			};

		const installFakeServer = (
			sockets: Array<ReturnType<typeof makeRoomSocket>>,
		) => {
			const roomEmit = jest.fn();
			const socketsMap = new Map(sockets.map((s) => [s.id, s]));
			(gateway as unknown as { server: unknown }).server = {
				sockets: { sockets: socketsMap },
				to: jest.fn().mockReturnValue({ emit: roomEmit }),
			};
			return { roomEmit };
		};

		it("should mark both players ready, start the session, and broadcast an active game:state to both sockets", async () => {
			const hostSocket = makeRoomSocket("socket-host");
			const joinerSocket = makeRoomSocket("socket-joiner");
			const { roomEmit } = installFakeServer([hostSocket, joinerSocket]);

			const pendingRoom = makeRoom({
				matchId: "match-invite-1",
				status: "pending",
				gameId: "temple-curling",
				players: [
					makePlayer(10, { side: 0, socketId: "socket-host", ready: false }),
					makePlayer(20, { side: 1, socketId: "socket-joiner", ready: false }),
				],
			});
			const activeRoom: MatchRoom = { ...pendingRoom, status: "active" };

			privateLobbies.joinLobby.mockResolvedValue({
				matchId: "match-invite-1",
				room: pendingRoom,
			});
			sessions.startIfReady.mockResolvedValue(activeRoom);
			rooms.getRoom.mockReturnValue(activeRoom);
			presence.getSocketIds.mockImplementation((userId: number) =>
				userId === 10 ? ["socket-host"] : ["socket-joiner"],
			);

			const joinerConnSocket = makeConnSocket("socket-joiner", 20, "joiner");

			await gateway.onLobbyJoin(joinerConnSocket, {
				lobbyId: "lobby-1",
				shellSelection: [],
			});

			expect(rooms.setReady).toHaveBeenCalledWith("match-invite-1", 10);
			expect(rooms.setReady).toHaveBeenCalledWith("match-invite-1", 20);
			expect(sessions.startIfReady).toHaveBeenCalledWith("match-invite-1");

			expect(hostSocket.join).toHaveBeenCalledWith("match-invite-1");
			expect(joinerSocket.join).toHaveBeenCalledWith("match-invite-1");
			expect(hostSocket.emit).toHaveBeenCalledWith(
				"lobby:matched",
				expect.objectContaining({ matchId: "match-invite-1", side: 0 }),
			);
			expect(joinerSocket.emit).toHaveBeenCalledWith(
				"lobby:matched",
				expect.objectContaining({ matchId: "match-invite-1", side: 1 }),
			);

			// emitState() re-reads the room from RoomService and broadcasts to the
			// whole match room — this is the assertion that actually proves the
			// bug is fixed: both players receive an *active* game:state instead
			// of being left on the pending snapshot.
			expect(roomEmit).toHaveBeenCalledWith("game:state", activeRoom.state);
		});

		it("should emit lobby:error and touch no room state when the lobby no longer exists", async () => {
			const socket = makeConnSocket("socket-joiner", 20, "joiner");
			privateLobbies.joinLobby.mockResolvedValue(null);

			await gateway.onLobbyJoin(socket, { lobbyId: "missing", shellSelection: [] });

			expect(socket.emit).toHaveBeenCalledWith("lobby:error", {
				message: "Lobby no longer exists",
			});
			expect(rooms.setReady).not.toHaveBeenCalled();
			expect(sessions.startIfReady).not.toHaveBeenCalled();
		});

		it("should emit lobby:error and not start a session when joinLobby rejects (e.g. joiner already in an active match)", async () => {
			const socket = makeConnSocket("socket-joiner", 20, "joiner");
			privateLobbies.joinLobby.mockRejectedValue(
				new Error("You are already in an active match"),
			);

			await gateway.onLobbyJoin(socket, { lobbyId: "lobby-1", shellSelection: [] });

			expect(socket.emit).toHaveBeenCalledWith("lobby:error", {
				message: "You are already in an active match",
			});
			expect(rooms.setReady).not.toHaveBeenCalled();
			expect(sessions.startIfReady).not.toHaveBeenCalled();
		});
	});
});
