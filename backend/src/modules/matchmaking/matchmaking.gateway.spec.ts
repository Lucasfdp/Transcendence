import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import type { Socket } from "socket.io";
import { ChatService } from "../chat/chat.service";
import { FriendsService } from "../friends/friends.service";
import { NotificationsService } from "../notifications/notifications.service";
import { UsersService } from "../users/users.service";
import { ArenaSimulationService } from "./arena-simulation.service";
import { GameSessionService } from "./game-session.service";
import { MatchmakingGateway } from "./matchmaking.gateway";
import { MatchmakingService } from "./matchmaking.service";
import type {
	BambooBashSnapshot,
	MatchRoom,
	RoomPlayer,
	SocketUser,
} from "./matchmaking.types";
import { PresenceService } from "./presence.service";
import {
	PRIVATE_LOBBY_NOT_FOUND_MESSAGE,
	PrivateLobbiesService,
} from "./private-lobbies.service";
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
	connect: jest.fn(),
	setInGame: jest.fn(),
	clearInGame: jest.fn(),
	disconnect: jest.fn(),
	isOnline: jest.fn().mockReturnValue(false),
	getSocketIds: jest.fn().mockReturnValue([]),
	// Presence broadcast (Decision 3). Default "online"/null; tests that assert
	// on a transition override getStatus per call.
	getStatus: jest.fn().mockReturnValue("online"),
	getGameId: jest.fn().mockReturnValue(null),
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
		reconnect: jest.Mock;
		markDisconnected: jest.Mock;
		setReady: jest.Mock;
		getRoom: jest.Mock;
		getActiveRooms: jest.Mock;
		getUserMatchStatus: jest.Mock;
	};
	let matchmaking: { removeSocket: jest.Mock };
	let privateLobbies: {
		removeLobbyForUser: jest.Mock;
		joinLobby: jest.Mock;
		joinPinLobby: jest.Mock;
		getLobbyByPin: jest.Mock;
		getStartedMatchByPin: jest.Mock;
	};
	let sessions: {
		startIfReady: jest.Mock;
		advanceSimulation: jest.Mock;
		handleInput: jest.Mock;
		captureReplayFrame: jest.Mock;
	};
	let replays: { captureFrame: jest.Mock; recordEvent: jest.Mock };
	let chatService: {
		sendMessage: jest.Mock;
		sendGifMessage: jest.Mock;
		markRead: jest.Mock;
		listConversations: jest.Mock;
		pushUnreadInboxToSocket: jest.Mock;
	};
	let notificationsService: {
		markRead: jest.Mock;
		markAllRead: jest.Mock;
		pushLiveEvent: jest.Mock;
	};
	let friendsService: { getFriendIds: jest.Mock };

	beforeEach(async () => {
		presence = makePresenceMock();
		usersService = makeUsersServiceMock();
		rooms = {
			removeSpectator: jest.fn(),
			reconnect: jest.fn(),
			markDisconnected: jest.fn().mockReturnValue(null),
			setReady: jest.fn(),
			getRoom: jest.fn(),
			getActiveRooms: jest.fn().mockReturnValue([]),
			getUserMatchStatus: jest.fn().mockReturnValue(null),
		};
		matchmaking = { removeSocket: jest.fn() };
		privateLobbies = {
			removeLobbyForUser: jest.fn().mockReturnValue(null),
			joinLobby: jest.fn(),
			joinPinLobby: jest.fn(),
			getLobbyByPin: jest.fn().mockReturnValue(null),
			getStartedMatchByPin: jest.fn().mockReturnValue(null),
		};
		sessions = {
			startIfReady: jest.fn(),
			advanceSimulation: jest.fn(),
			handleInput: jest.fn(),
			captureReplayFrame: jest.fn(),
		};
		replays = { captureFrame: jest.fn(), recordEvent: jest.fn() };
		chatService = {
			sendMessage: jest.fn(),
			sendGifMessage: jest.fn(),
			markRead: jest.fn().mockResolvedValue(undefined),
			listConversations: jest.fn().mockResolvedValue([]),
			pushUnreadInboxToSocket: jest.fn().mockResolvedValue(undefined),
		};
		notificationsService = {
			markRead: jest.fn().mockResolvedValue(undefined),
			markAllRead: jest.fn().mockResolvedValue(undefined),
			pushLiveEvent: jest.fn(),
		};
		friendsService = {
			getFriendIds: jest.fn().mockResolvedValue([]),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				MatchmakingGateway,
				// Real service — resolves the RoomService/GameSessionService mocks
				// below, so the arena broadcast test drives real pacing logic.
				ArenaSimulationService,
				{ provide: JwtService, useValue: {} },
				{ provide: UsersService, useValue: usersService },
				{ provide: PresenceService, useValue: presence },
				{ provide: MatchmakingService, useValue: matchmaking },
				{ provide: RoomService, useValue: rooms },
				{ provide: GameSessionService, useValue: sessions },
				{ provide: NotificationsService, useValue: notificationsService },
				{ provide: PrivateLobbiesService, useValue: privateLobbies },
				{ provide: FriendsService, useValue: friendsService },
				{ provide: ReplayService, useValue: replays },
				{ provide: ChatService, useValue: chatService },
			],
		}).compile();

		gateway = module.get(MatchmakingGateway);
	});

	describe("arena simulation broadcasts", () => {
		it("publishes a compact public physics entity without server-only trails", () => {
			const room = makeRoom({
				physicsState: {
					matchId: "match-1",
					physicsSeq: 2,
					serverTime: 100,
					entities: [
						{
							id: 7,
							ownerSide: 1,
							primary: true,
							x: 10,
							y: 20,
							vx: 30,
							vy: 40,
							radius: 28,
							rotation: 0,
							angularVelocity: 0,
							power: "none",
							stopped: false,
							alpha: 1,
							ghostCollisionAvailable: false,
							trail: [{ x: 1, y: 2 }],
						} as never,
					],
					pickups: [],
					scoreEvents: [],
					nextEntityId: 8,
					nextPickupId: 1,
					nextScoreEventId: 1,
					bellCooldownMs: [],
				},
			});

			const projection = (
				gateway as unknown as {
					publicPhysicsState: (value: MatchRoom) => { entities: unknown[] };
				}
			).publicPhysicsState(room);

			expect(projection.entities).toEqual([
				expect.objectContaining({ id: 7, ownerSide: 1, x: 10, y: 20 }),
			]);
			expect(projection.entities[0]).not.toHaveProperty("trail");
			expect(projection.entities[0]).not.toHaveProperty("ghostCollisionAvailable");
		});

		it("broadcasts physics separately and does not repeat lifecycle state", () => {
			const room = makeRoom({
				status: "active",
				state: { seq: 4 } as MatchRoom["state"],
				physicsState: {
					matchId: "match-1",
					physicsSeq: 7,
					serverTime: 100,
					entities: [],
					pickups: [],
					scoreEvents: [],
					nextEntityId: 1,
					nextPickupId: 1,
					nextScoreEventId: 1,
					bellCooldownMs: [],
				},
			});
			const emit = jest.fn();
			rooms.getRoom.mockReturnValue(room);
			gateway.server = { to: jest.fn().mockReturnValue({ emit }) } as never;

			const emitPhysics = () =>
				(
					gateway as unknown as { emitPhysicsState: (id: string) => void }
				).emitPhysicsState(room.matchId);
			emitPhysics();
			emitPhysics();

			expect(replays.captureFrame).toHaveBeenCalledWith(room, true);
			expect(gateway.server.to).toHaveBeenCalledWith(room.matchId);
			expect(emit).toHaveBeenCalledWith(
				"game:physics-state",
				expect.objectContaining({ matchId: room.matchId, physicsSeq: 7 }),
			);
			expect(emit.mock.calls.filter(([event]) => event === "game:state")).toHaveLength(1);
		});

		it("includes Bamboo Bash world and score state in the physics projection", () => {
			const room = makeRoom({
				state: {
					gameId: "bamboo-bash",
					bamboos: [{ id: 4, nx: 0.2, ny: -0.1, stage: 2, ageMs: 5_000 }],
					liveRoundScores: [150, 0],
				} as MatchRoom["state"],
				physicsState: {
					matchId: "match-1",
					physicsSeq: 9,
					serverTime: 300,
					entities: [],
					pickups: [{ id: 2, type: "rocket", x: 30, y: 40, radius: 20 }],
					scoreEvents: [{ id: 3, side: 0, points: 150, bambooId: 4 }],
					pickupEvents: [{ id: 5, side: 0, type: "rocket", x: 30, y: 40 }],
					nextEntityId: 1,
					nextPickupId: 3,
					nextScoreEventId: 4,
				},
			});
			const emit = jest.fn();
			rooms.getRoom.mockReturnValue(room);
			gateway.server = { to: jest.fn().mockReturnValue({ emit }) } as never;

			(
				gateway as unknown as { emitPhysicsState: (id: string) => void }
			).emitPhysicsState(room.matchId);

			expect(emit).toHaveBeenCalledWith(
				"game:physics-state",
				expect.objectContaining({
					physicsSeq: 9,
					bamboos: (room.state as BambooBashSnapshot).bamboos,
					liveRoundScores: [150, 0],
					scoreEvents: [{ id: 3, side: 0, points: 150, bambooId: 4 }],
					pickupEvents: [{ id: 5, side: 0, type: "rocket", x: 30, y: 40 }],
				}),
			);
		});
	});

	describe("match rejoin", () => {
		it("hydrates the rejoining socket with the current lifecycle and physics state", () => {
			const room = makeRoom({
				state: {
					gameId: "bamboo-bash",
					seq: 4,
					bamboos: [],
					liveRoundScores: [100, 0],
				} as MatchRoom["state"],
				physicsState: {
					matchId: "match-1",
					physicsSeq: 12,
					serverTime: 500,
					entities: [],
					pickups: [],
					scoreEvents: [],
					nextEntityId: 1,
					nextPickupId: 1,
					nextScoreEventId: 1,
				},
			});
			const socket = {
				id: "socket-rejoin",
				data: { user: makePlayer(1).user },
				join: jest.fn(),
				emit: jest.fn(),
			} as unknown as Socket;
			rooms.reconnect.mockReturnValue(room);

			gateway.onMatchRejoin(socket);

			expect(rooms.reconnect).toHaveBeenCalledWith("socket-rejoin", makePlayer(1).user);
			expect(socket.join).toHaveBeenCalledWith(room.matchId);
			expect(socket.emit).toHaveBeenCalledWith("game:state", room.state);
			expect(socket.emit).toHaveBeenCalledWith(
				"game:physics-state",
				expect.objectContaining({ physicsSeq: 12, liveRoundScores: [100, 0] }),
			);
		});
	});

	describe("Bell Clash launch projection", () => {
		it("publishes the authoritative physics state immediately after release", async () => {
			const room = makeRoom({
				gameId: "bell-clash",
				state: {
					seq: 4,
					roundNumber: 1,
					shotCounts: [1, 0],
				} as MatchRoom["state"],
				physicsState: {
					matchId: "match-1",
					physicsSeq: 8,
					serverTime: 200,
					entities: [],
					pickups: [],
					scoreEvents: [],
					nextEntityId: 1,
					nextPickupId: 1,
					nextScoreEventId: 1,
					bellCooldownMs: [],
				},
			});
			const emit = jest.fn();
			gateway.server = { to: jest.fn().mockReturnValue({ emit }) } as never;
			sessions.handleInput.mockReturnValue(room);
			rooms.getRoom.mockReturnValue(room);

			const ack = await gateway.onGameInput(
				makeSocket({ data: { user: makePlayer(1).user } }),
				{
					matchId: room.matchId,
					action: "release",
					payload: { roundNumber: 1, vx: 100, vy: 0 },
				},
			);

			expect(ack).toEqual({ accepted: true });
			expect(emit.mock.calls[0]).toEqual([
				"game:physics-state",
				expect.objectContaining({ physicsSeq: 8 }),
			]);
			expect(emit).not.toHaveBeenCalledWith(
			"game:bell-throw",
			expect.anything(),
		);
			expect(replays.recordEvent).toHaveBeenCalledWith(
				room,
				"game:bell-throw",
				expect.objectContaining({ matchId: room.matchId }),
			);
		});
	});

	describe("Bamboo Bash launch projection", () => {
		it("publishes the authoritative physics state immediately after release", async () => {
			const room = makeRoom({
				state: {
					gameId: "bamboo-bash",
					seq: 4,
					roundNumber: 1,
					bamboos: [],
					liveRoundScores: [0, 0],
					lastPowerBySide: ["none", "none"],
				} as MatchRoom["state"],
				physicsState: {
					matchId: "match-1",
					physicsSeq: 10,
					serverTime: 400,
					entities: [],
					pickups: [],
					scoreEvents: [],
					nextEntityId: 1,
					nextPickupId: 1,
					nextScoreEventId: 1,
				},
			});
			const emit = jest.fn();
			gateway.server = { to: jest.fn().mockReturnValue({ emit }) } as never;
			sessions.handleInput.mockReturnValue(room);
			rooms.getRoom.mockReturnValue(room);

			const ack = await gateway.onGameInput(
				makeSocket({ data: { user: makePlayer(1).user } }),
				{
					matchId: room.matchId,
					action: "release",
					payload: { roundNumber: 1, vx: 100, vy: 0 },
				},
			);

			expect(ack).toEqual({ accepted: true });
			expect(emit).toHaveBeenCalledWith(
				"game:physics-state",
				expect.objectContaining({ physicsSeq: 10, bamboos: [] }),
			);
			expect(emit).not.toHaveBeenCalledWith(
				"game:bamboo-throw",
				expect.anything(),
			);
		});
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

		it("should fan out presence:changed only for players whose coarse status actually changed (Decision 3)", async () => {
			// Player 1 transitions online→in-game; player 2 was already in-game so
			// must NOT re-broadcast. Keyed on userId + a first-call toggle so the
			// result is independent of the loop's getStatus call order.
			const seenPlayerOne = { value: false };
			presence.getStatus.mockImplementation((uid: number) => {
				if (uid === 2) return "in-game";
				if (seenPlayerOne.value) return "in-game";
				seenPlayerOne.value = true;
				return "online";
			});
			presence.getGameId.mockReturnValue("bamboo-bash");
			friendsService.getFriendIds.mockResolvedValue([99]);

			callSyncRoomPresence(makeRoom({ status: "active", gameId: "bamboo-bash" }));
			await Promise.resolve();

			expect(friendsService.getFriendIds).toHaveBeenCalledTimes(1);
			expect(friendsService.getFriendIds).toHaveBeenCalledWith(1);
			expect(notificationsService.pushLiveEvent).toHaveBeenCalledWith(
				"presence:changed",
				99,
				{ userId: 1, status: "in-game", gameId: "bamboo-bash" },
			);
		});
	});

	// ── broadcastPresence (Decision 3) ─────────────────────────────────────────

	describe("broadcastPresence", () => {
		const callBroadcast = (userId: number, isGuest = false): Promise<void> =>
			(
				gateway as unknown as {
					broadcastPresence: (u: number, g?: boolean) => Promise<void>;
				}
			).broadcastPresence(userId, isGuest);

		it("pushes presence:changed to each online friend with the coarse status + gameId", async () => {
			presence.getStatus.mockReturnValue("in-game");
			presence.getGameId.mockReturnValue("kame-knock");
			friendsService.getFriendIds.mockResolvedValue([10, 20]);

			await callBroadcast(1);

			expect(friendsService.getFriendIds).toHaveBeenCalledWith(1);
			expect(notificationsService.pushLiveEvent).toHaveBeenCalledWith(
				"presence:changed",
				10,
				{ userId: 1, status: "in-game", gameId: "kame-knock" },
			);
			expect(notificationsService.pushLiveEvent).toHaveBeenCalledWith(
				"presence:changed",
				20,
				{ userId: 1, status: "in-game", gameId: "kame-knock" },
			);
		});

		it("short-circuits for a guest without querying friends", async () => {
			await callBroadcast(1, true);

			expect(friendsService.getFriendIds).not.toHaveBeenCalled();
			expect(notificationsService.pushLiveEvent).not.toHaveBeenCalled();
		});

		it("does not throw when getFriendIds rejects (non-fatal)", async () => {
			friendsService.getFriendIds.mockRejectedValue(new Error("db down"));

			await expect(callBroadcast(1)).resolves.toBeUndefined();
			expect(notificationsService.pushLiveEvent).not.toHaveBeenCalled();
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
			expect(roomEmit).toHaveBeenCalledWith(
				"lobby:matched",
				expect.objectContaining({ matchId: "match-invite-1", side: 0 }),
			);
			expect(roomEmit).toHaveBeenCalledWith(
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

	describe("onLobbyJoinPin", () => {
		const makeConnSocket = (id: string, userId: number, username: string): Socket =>
			({
				id,
				data: { user: { id: userId, username, isGuest: false } },
				emit: jest.fn(),
			}) as unknown as Socket;

		it("should pass the current game id when joining by PIN", async () => {
			const socket = makeConnSocket("socket-joiner", 20, "joiner");
			privateLobbies.joinPinLobby.mockResolvedValue({
				matched: false,
				lobby: {
					lobbyId: "lobby-pin-1",
					pin: "2ABCDE",
					gameId: "temple-curling",
					playerCount: 3,
					participants: [],
					createdAt: Date.now(),
				},
			});

			await gateway.onLobbyJoinPin(socket, {
				pin: "2ABCDE",
				gameId: "temple-curling",
				shellSelection: [],
			});

			expect(privateLobbies.joinPinLobby).toHaveBeenCalledWith(
				"2ABCDE",
				"temple-curling",
				"socket-joiner",
				expect.objectContaining({ id: 20 }),
				[],
			);
		});

		it("should emit a clear not-found error when no PIN lobby matches this game", async () => {
			const socket = makeConnSocket("socket-joiner", 20, "joiner");
			privateLobbies.joinPinLobby.mockResolvedValue(null);

			await gateway.onLobbyJoinPin(socket, {
				pin: "1ABCDE",
				gameId: "temple-curling",
				shellSelection: [],
			});

			expect(socket.emit).toHaveBeenCalledWith("lobby:error", {
				message: PRIVATE_LOBBY_NOT_FOUND_MESSAGE,
			});
		});
	});

	// ── chat:send / chat:read — thin gateway glue added in Batch 2 ────────────

	describe("onChatSend", () => {
		const makeConnSocket = (userId: number): Socket =>
			({
				id: "socket-1",
				data: { user: { id: userId, username: `user${userId}`, isGuest: false } },
				emit: jest.fn(),
			}) as unknown as Socket & { emit: jest.Mock };

		const installFakeServer = () => {
			const roomEmit = jest.fn();
			(gateway as unknown as { server: unknown }).server = {
				to: jest.fn().mockReturnValue({ emit: roomEmit }),
			};
			return { roomEmit };
		};

		it("should persist the message and broadcast it to the conversation room", async () => {
			const socket = makeConnSocket(1);
			const { roomEmit } = installFakeServer();
			const message = { id: 1, conversationId: 10, body: "hey" };
			chatService.sendMessage.mockResolvedValue(message);

			await gateway.onChatSend(socket, { conversationId: 10, body: "hey" });

			expect(chatService.sendMessage).toHaveBeenCalledWith(10, 1, "hey");
			expect(roomEmit).toHaveBeenCalledWith("chat:message", message);
		});

		it("should emit chat:error instead of throwing when the service rejects", async () => {
			const socket = makeConnSocket(1);
			installFakeServer();
			chatService.sendMessage.mockRejectedValue(
				new Error("You are not a participant in this conversation"),
			);

			await gateway.onChatSend(socket, { conversationId: 10, body: "hey" });

			expect(socket.emit).toHaveBeenCalledWith("chat:error", {
				message: "You are not a participant in this conversation",
			});
		});

		it("should do nothing when the socket has no authenticated user", async () => {
			const socket = { id: "socket-1", data: {}, emit: jest.fn() } as unknown as Socket;
			installFakeServer();

			await gateway.onChatSend(socket, { conversationId: 10, body: "hey" });

			expect(chatService.sendMessage).not.toHaveBeenCalled();
		});
	});

	describe("onChatSendGif", () => {
		const makeConnSocket = (userId: number): Socket =>
			({
				id: "socket-1",
				data: { user: { id: userId, username: `user${userId}`, isGuest: false } },
				emit: jest.fn(),
			}) as unknown as Socket & { emit: jest.Mock };

		const installFakeServer = () => {
			const roomEmit = jest.fn();
			(gateway as unknown as { server: unknown }).server = {
				to: jest.fn().mockReturnValue({ emit: roomEmit }),
			};
			return { roomEmit };
		};

		it("should resolve the gif and broadcast it to the conversation room", async () => {
			const socket = makeConnSocket(1);
			const { roomEmit } = installFakeServer();
			const message = { id: 1, conversationId: 10, type: "gif", body: "Hello" };
			chatService.sendGifMessage.mockResolvedValue(message);

			await gateway.onChatSendGif(socket, { conversationId: 10, slug: "hello-hi-662" });

			expect(chatService.sendGifMessage).toHaveBeenCalledWith(10, 1, "hello-hi-662");
			expect(roomEmit).toHaveBeenCalledWith("chat:message", message);
		});

		it("should emit chat:error instead of throwing when the service rejects", async () => {
			const socket = makeConnSocket(1);
			installFakeServer();
			chatService.sendGifMessage.mockRejectedValue(new Error("GIF not found"));

			await gateway.onChatSendGif(socket, { conversationId: 10, slug: "missing" });

			expect(socket.emit).toHaveBeenCalledWith("chat:error", {
				message: "GIF not found",
			});
		});

		it("should do nothing when the socket has no authenticated user", async () => {
			const socket = { id: "socket-1", data: {}, emit: jest.fn() } as unknown as Socket;
			installFakeServer();

			await gateway.onChatSendGif(socket, { conversationId: 10, slug: "hello-hi-662" });

			expect(chatService.sendGifMessage).not.toHaveBeenCalled();
		});
	});

	describe("onChatRead", () => {
		const makeConnSocket = (userId: number): Socket =>
			({
				id: "socket-1",
				data: { user: { id: userId, username: `user${userId}`, isGuest: false } },
				emit: jest.fn(),
			}) as unknown as Socket;

		it("should mark the conversation read for the authenticated user", async () => {
			await gateway.onChatRead(makeConnSocket(1), { conversationId: 10 });

			expect(chatService.markRead).toHaveBeenCalledWith(10, 1);
		});

		it("should not throw when markRead rejects (non-fatal)", async () => {
			chatService.markRead.mockRejectedValue(new Error("db down"));

			await expect(
				gateway.onChatRead(makeConnSocket(1), { conversationId: 10 }),
			).resolves.toBeUndefined();
		});

		it("should do nothing when the socket has no authenticated user", async () => {
			const socket = { id: "socket-1", data: {}, emit: jest.fn() } as unknown as Socket;

			await gateway.onChatRead(socket, { conversationId: 10 });

			expect(chatService.markRead).not.toHaveBeenCalled();
		});
	});

	// ── onNotificationRead / onNotificationReadAll (Bug Audit M2) ─────────────

	describe("onNotificationRead", () => {
		const makeConnSocket = (userId: number, isGuest = false): Socket =>
			({
				id: "socket-1",
				data: { user: { id: userId, username: `user${userId}`, isGuest } },
				emit: jest.fn(),
			}) as unknown as Socket;

		it("should mark the notification read for a valid integer id", async () => {
			await gateway.onNotificationRead(makeConnSocket(1), { notificationId: 42 });

			expect(notificationsService.markRead).toHaveBeenCalledWith(1, 42);
		});

		it("should reject a missing notificationId instead of matching an arbitrary row", async () => {
			await gateway.onNotificationRead(
				makeConnSocket(1),
				{} as { notificationId?: number },
			);

			expect(notificationsService.markRead).not.toHaveBeenCalled();
		});

		it("should reject a non-numeric notificationId", async () => {
			await gateway.onNotificationRead(makeConnSocket(1), {
				notificationId: "42" as unknown as number,
			});

			expect(notificationsService.markRead).not.toHaveBeenCalled();
		});

		it("should reject a non-integer (float) notificationId", async () => {
			await gateway.onNotificationRead(makeConnSocket(1), { notificationId: 1.5 });

			expect(notificationsService.markRead).not.toHaveBeenCalled();
		});

		it("should do nothing for a guest socket", async () => {
			await gateway.onNotificationRead(makeConnSocket(1, true), {
				notificationId: 42,
			});

			expect(notificationsService.markRead).not.toHaveBeenCalled();
		});

		it("should not throw when markRead rejects (non-fatal)", async () => {
			notificationsService.markRead.mockRejectedValue(new Error("db down"));

			await expect(
				gateway.onNotificationRead(makeConnSocket(1), { notificationId: 42 }),
			).resolves.toBeUndefined();
		});
	});

	describe("onNotificationReadAll", () => {
		const makeConnSocket = (userId: number, isGuest = false): Socket =>
			({
				id: "socket-1",
				data: { user: { id: userId, username: `user${userId}`, isGuest } },
				emit: jest.fn(),
			}) as unknown as Socket;

		it("should mark all notifications read for the authenticated user", async () => {
			await gateway.onNotificationReadAll(makeConnSocket(1));

			expect(notificationsService.markAllRead).toHaveBeenCalledWith(1);
		});

		it("should do nothing for a guest socket", async () => {
			await gateway.onNotificationReadAll(makeConnSocket(1, true));

			expect(notificationsService.markAllRead).not.toHaveBeenCalled();
		});
	});

	// ── joinChatRooms (private, invoked on connect) ───────────────────────────

	describe("joinChatRooms", () => {
		const callJoinChatRooms = (socket: Socket, userId: number): Promise<void> =>
			(
				gateway as unknown as {
					joinChatRooms: (s: Socket, id: number) => Promise<void>;
				}
			).joinChatRooms(socket, userId);

		it("should join the socket to every conversation room the user belongs to", async () => {
			chatService.listConversations.mockResolvedValue([
				{ id: 1 },
				{ id: 2 },
			]);
			const socket = { id: "socket-1", join: jest.fn() } as unknown as Socket & {
				join: jest.Mock;
			};

			await callJoinChatRooms(socket, 1);

			expect(socket.join).toHaveBeenCalledWith("chat:1");
			expect(socket.join).toHaveBeenCalledWith("chat:2");
		});

		it("should not throw when listConversations rejects (non-fatal)", async () => {
			chatService.listConversations.mockRejectedValue(new Error("db down"));
			const socket = { id: "socket-1", join: jest.fn() } as unknown as Socket & {
				join: jest.Mock;
			};

			await expect(callJoinChatRooms(socket, 1)).resolves.toBeUndefined();
			expect(socket.join).not.toHaveBeenCalled();
		});
	});
});
