/**
 * room.service.spec.ts — focused coverage of RoomService.convertSeatToBot
 * (the "Leave game" mid-minigame quit: a live tournament seat is handed to a
 * CPU stand-in so the arena match plays on for everyone else).
 */

import { GameEngineRegistry } from "./engines/game-engine.registry";
import { BOT_SOCKET_PREFIX, SocketUser } from "./matchmaking.types";
import { RoomService } from "./room.service";

const makeUser = (id: number): SocketUser => ({
	id,
	username: `user${id}`,
	isGuest: false,
});

const engines = {
	get: () => ({
		createInitialState: () => ({
			gameId: "kame-knock",
			matchId: "match-1",
			phase: "pending",
			seq: 0,
			players: [],
			winnerSide: null,
		}),
	}),
} as unknown as GameEngineRegistry;

const makeService = () => {
	const service = new RoomService(engines);
	const room = service.createRoom("match-1", "kame-knock", "casual", [
		{ socketId: "sock-10", user: makeUser(10), shellSelection: [] },
		{ socketId: "sock-20", user: makeUser(20), shellSelection: [] },
	]);
	return { service, room };
};

describe("RoomService.convertSeatToBot", () => {
	it("hands a live seat to a CPU stand-in and unmaps the user from the room", () => {
		const { service, room } = makeService();
		const player = room.players[0];
		player.reconnectExpiresAt = Date.now() + 45_000;

		const result = service.convertSeatToBot("match-1", 10);

		expect(result).toBe(room);
		// The seat keeps the user's identity but is played server-side now.
		expect(player.socketId).toBe(`${BOT_SOCKET_PREFIX}10`);
		expect(player.connected).toBe(true);
		expect(player.reconnectExpiresAt).toBeUndefined();
		expect(player.user.id).toBe(10);
		// The user no longer maps to the room: no match:status, no reconnect
		// takeover, free to queue elsewhere.
		expect(service.getUserMatchStatus(10)).toBeNull();
		expect(service.reconnect("sock-new", makeUser(10))).toBeNull();
		// The other seat is untouched and still mapped.
		expect(room.players[1].socketId).toBe("sock-20");
		expect(service.getUserMatchStatus(20)?.room).toBe(room);
	});

	it("clears a pending disconnect timer so no forfeit fires for the converted seat", () => {
		jest.useFakeTimers();
		try {
			const { service, room } = makeService();
			const onTimeout = jest.fn();
			service.markDisconnected("sock-10", onTimeout, 45_000);
			expect(room.players[0].disconnectTimer).toBeDefined();

			service.convertSeatToBot("match-1", 10);

			jest.advanceTimersByTime(60_000);
			expect(onTimeout).not.toHaveBeenCalled();
			expect(room.players[0].disconnectTimer).toBeUndefined();
		} finally {
			jest.useRealTimers();
		}
	});

	it("no-ops for resolved rooms, unknown matches and unseated users", () => {
		const { service, room } = makeService();

		expect(service.convertSeatToBot("missing", 10)).toBeNull();
		expect(service.convertSeatToBot("match-1", 999)).toBeNull();

		service.finish("match-1", 0);
		expect(room.status).toBe("finished");
		expect(service.convertSeatToBot("match-1", 10)).toBeNull();
	});

	it("an already-CPU seat only unmaps the user (offline stand-in quitting)", () => {
		const { service, room } = makeService();
		const player = room.players[0];
		player.socketId = `${BOT_SOCKET_PREFIX}10`;

		const result = service.convertSeatToBot("match-1", 10);

		expect(result).toBe(room);
		expect(player.socketId).toBe(`${BOT_SOCKET_PREFIX}10`);
		expect(service.getUserMatchStatus(10)).toBeNull();
	});
});
