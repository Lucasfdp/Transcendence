/**
 * nplayer-integration.spec.ts — end-to-end proof of the "Multiplayer game with
 * more than two players" major (P1).
 *
 * Unlike the per-engine unit specs, this drives a FULL 5-seat match through the
 * real engines and the real RoomService for every game, and asserts the whole
 * lifecycle a demo would exercise: N-per-side scoring, turn rotation, a settled
 * winner, mid-match disconnect/rejoin of a middle seat, and a spectator joining
 * live. It is the repeatable, CI-friendly evidence the module was missing, and
 * the net the P2/P3/P5 fairness fixes land inside.
 */

import { GameEngineRegistry } from "./engines/game-engine.registry";
import { BellClashEngine } from "./engines/bell-clash.engine";
import { BambooBashEngine } from "./engines/bamboo-bash.engine";
import { KameKnockEngine } from "./engines/kame-knock.engine";
import { ShellCurlEngine } from "./engines/shell-curl.engine";
import { MatchRoom, SocketUser } from "./matchmaking.types";
import { RoomService } from "./room.service";

const STEP_MS = 1000 / 30;
const GAMES = [
	"temple-curling",
	"kame-knock",
	"bell-clash",
	"bamboo-bash",
] as const;

function makeRegistry(): GameEngineRegistry {
	return new GameEngineRegistry(
		new ShellCurlEngine(),
		new BambooBashEngine(),
		new KameKnockEngine(),
		new BellClashEngine(),
	);
}

function makeUser(index: number): SocketUser {
	return { id: index + 1, username: `p${index}`, isGuest: false };
}

function seatInputs(count: number) {
	return Array.from({ length: count }, (_value, index) => ({
		socketId: `sock-${index}`,
		user: makeUser(index),
		shellSelection: [] as string[],
	}));
}

describe("Multiplayer 3+ players — end-to-end (P1)", () => {
	let clock: number;
	let nowSpy: jest.SpyInstance;

	beforeEach(() => {
		// A controllable wall clock: bamboo's round timer is wall-clock anchored,
		// so the driver advances this in lockstep with simulation steps.
		clock = 1_700_000_000_000;
		nowSpy = jest.spyOn(Date, "now").mockImplementation(() => clock);
	});

	afterEach(() => {
		nowSpy.mockRestore();
	});

	/**
	 * Release for every seat that can act, then advance the simulation (and the
	 * wall clock) until the shots settle or a timed round elapses — repeating
	 * until the match reaches a terminal state. Returns the set of distinct
	 * `currentTurn` values observed, so turn rotation can be asserted.
	 */
	function driveToFinish(
		registry: GameEngineRegistry,
		room: MatchRoom,
	): Set<number> {
		const engine = registry.get(room.gameId);
		const turnsSeen = new Set<number>();
		for (let outer = 0; outer < 400 && room.status === "active"; outer++) {
			const state = room.state as unknown as Record<string, unknown>;
			if (typeof state.currentTurn === "number")
				turnsSeen.add(state.currentTurn);
			for (const player of room.players) {
				engine.handleInput(room, player.user.id, {
					matchId: room.matchId,
					action: "release",
					payload: {
						roundNumber: state.roundNumber as number,
						turnNumber: state.turnNumber as number,
						vx: 120,
						vy: -40,
					},
				});
			}
			let idle = 0;
			for (let step = 0; step < 1_200 && room.status === "active"; step++) {
				const moving = engine.advanceSimulation(room, STEP_MS);
				clock += STEP_MS;
				if (moving) idle = 0;
				else if (++idle >= 4) break;
			}
		}
		return turnsSeen;
	}

	it.each(GAMES)(
		"drives a full 5-player %s match to a settled winner",
		(gameId) => {
			// One registry drives both room-state creation and simulation so the
			// same engine instances back the room throughout.
			const registry = makeRegistry();
			const roomService = new RoomService(registry);
			const room = roomService.createRoom(
				`match-${gameId}`,
				gameId,
				"casual",
				seatInputs(5),
			);
			registry.get(gameId).start(room);
			expect(room.status).toBe("active");

			driveToFinish(registry, room);

			// The match settled into a terminal state within the budget.
			expect(["finished", "abandoned"]).toContain(room.status);
			// Per-side scoring is array-per-seat for all five players.
			const score = (room.state as { score: number[] }).score;
			expect(score).toHaveLength(5);
			// A settled winner is a valid seat index or a genuine draw (null).
			const winnerSide = room.state.winnerSide;
			expect(
				winnerSide === null ||
					(Number.isInteger(winnerSide) &&
						winnerSide >= 0 &&
						winnerSide < 5),
			).toBe(true);
		},
	);

	it("rotates turns, survives a middle-seat disconnect/rejoin, and admits a live spectator", () => {
		const registry = makeRegistry();
		const roomService = new RoomService(registry);
		const room = roomService.createRoom(
			"match-curl-5",
			"temple-curling",
			"casual",
			seatInputs(5),
		);
		registry.get("temple-curling").start(room);

		// A spectator can join the live match.
		const spectatorRoom = roomService.addSpectator(
			room.matchId,
			"spectator-1",
			makeUser(99),
		);
		expect(spectatorRoom).toBe(room);
		expect(room.spectators.has("spectator-1")).toBe(true);

		// Disconnect the middle seat (side 2) mid-match, then rejoin it.
		const middle = room.players[2];
		roomService.markDisconnected(middle.socketId, () => undefined, 45_000);
		expect(middle.connected).toBe(false);
		expect(middle.reconnectExpiresAt).toBeDefined();
		const rejoin = roomService.reconnect(
			"sock-2-new",
			middle.user,
			() => false,
		);
		expect(rejoin?.outcome).toBe("rebound");
		expect(middle.connected).toBe(true);
		expect(middle.socketId).toBe("sock-2-new");

		const turnsSeen = driveToFinish(registry, room);

		// Turn order genuinely rotated across seats (not stuck on seat 0).
		expect(turnsSeen.size).toBeGreaterThan(1);
		expect(["finished", "abandoned"]).toContain(room.status);
		expect((room.state as { score: number[] }).score).toHaveLength(5);
	});
});
