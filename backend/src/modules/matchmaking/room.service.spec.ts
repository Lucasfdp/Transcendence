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

describe("RoomService seat-hijack protection (R1)", () => {
	it("a second live socket for the same user does not steal the seat or arm a forfeit", () => {
		jest.useFakeTimers();
		try {
			const { service, room } = makeService();
			const seat = room.players[0];
			const onTimeout = jest.fn();
			// Tab A (sock-10) is live and playing.
			const liveSockets = new Set(["sock-10", "sock-20"]);
			const isLive = (id: string) => liveSockets.has(id);

			// Tab B connects for the same user while tab A is still live.
			const result = service.reconnect("sock-10b", makeUser(10), isLive);
			expect(result?.outcome).toBe("occupied");
			// The seat is untouched — still bound to tab A, still connected.
			expect(seat.socketId).toBe("sock-10");
			expect(seat.connected).toBe(true);

			// Tab B closing must not disconnect the live seat (it never held it).
			expect(
				service.markDisconnected("sock-10b", onTimeout, 45_000),
			).toBeNull();
			jest.advanceTimersByTime(60_000);
			expect(onTimeout).not.toHaveBeenCalled();
			expect(seat.connected).toBe(true);

			// A genuine drop of tab A then arms the forfeit window as normal, and a
			// real reconnect (tab A now dead) rebinds the vacant seat.
			liveSockets.delete("sock-10");
			expect(service.markDisconnected("sock-10", onTimeout, 45_000)).toBe(
				room,
			);
			expect(seat.connected).toBe(false);
			const rebind = service.reconnect("sock-10c", makeUser(10), isLive);
			expect(rebind?.outcome).toBe("rebound");
			expect(seat.socketId).toBe("sock-10c");
			expect(seat.connected).toBe(true);

			service.deleteRoom("match-1");
		} finally {
			jest.clearAllTimers();
			jest.useRealTimers();
		}
	});
});

describe("RoomService memory bounds (R2)", () => {
	it("resolves markDisconnected through the socket index, including after reconnect rebinds the seat", () => {
		jest.useFakeTimers();
		try {
			const { service, room } = makeService();
			const onTimeout = jest.fn();

			// Original socket.
			expect(service.markDisconnected("sock-10", onTimeout, 45_000)).toBe(
				room,
			);
			// Reconnect on a fresh socket, then the old socket id must no longer
			// resolve to the seat (index rebound), while the new one does.
			service.reconnect("sock-10b", makeUser(10));
			expect(
				service.markDisconnected("sock-10", onTimeout, 45_000),
			).toBeNull();
			expect(service.markDisconnected("sock-10b", onTimeout, 45_000)).toBe(
				room,
			);
			service.deleteRoom("match-1");
		} finally {
			jest.clearAllTimers();
			jest.useRealTimers();
		}
	});

	it("evicts a room and purges its indexes on deleteRoom", () => {
		const { service } = makeService();
		service.addSpectator("match-1", "spec-1", makeUser(30));

		expect(service.deleteRoom("match-1")).toBe(true);
		expect(service.getRoom("match-1")).toBeNull();
		// Seat and spectator sockets no longer resolve anywhere.
		expect(
			service.markDisconnected("sock-10", jest.fn(), 45_000),
		).toBeNull();
		expect(service.removeSpectator("spec-1")).toBeNull();
		// Idempotent.
		expect(service.deleteRoom("match-1")).toBe(false);
	});

	it("sweeps finished rooms only once the retention window has elapsed", () => {
		const { service, room } = makeService();
		service.finish("match-1", 0);
		expect(room.finishedAt).toBeDefined();

		// Fresh finish: retained.
		expect(service.sweepFinishedRooms(room.finishedAt! + 1_000)).toBe(0);
		expect(service.getRoom("match-1")).not.toBeNull();

		// Past the TTL: evicted.
		expect(
			service.sweepFinishedRooms(room.finishedAt! + 11 * 60 * 1000),
		).toBe(1);
		expect(service.getRoom("match-1")).toBeNull();
	});

	it("removes a spectator through the index without scanning rooms", () => {
		const { service, room } = makeService();
		service.addSpectator("match-1", "spec-1", makeUser(30));

		expect(service.removeSpectator("spec-1")).toBe(room);
		expect(room.spectators.has("spec-1")).toBe(false);
		expect(service.removeSpectator("spec-1")).toBeNull();
	});
});
