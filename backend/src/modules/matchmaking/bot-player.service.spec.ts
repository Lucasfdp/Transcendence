/**
 * bot-player.service.spec.ts — CPU players vs the REAL game engines.
 *
 * The strongest guarantee we can give: two bot seats play every one of the
 * four arena games THROUGH the real engine (`handleInput` validation and turn
 * gating included) all the way to a finished match with a winner decided by
 * the server-authoritative physics. The gateway is faked down to its
 * engine-dispatch core (the per-game broadcast blocks are presentation), the
 * loop advances the engines' fixed simulation exactly like
 * ArenaSimulationService's 30 Hz timer, and Date.now is virtual — kept in step
 * with the simulated time — so pacing delays and round clocks elapse
 * instantly.
 */

import { Logger } from "@nestjs/common";
import { BellClashEngine } from "./engines/bell-clash.engine";
import { BambooBashEngine } from "./engines/bamboo-bash.engine";
import { GameEngineRegistry } from "./engines/game-engine.registry";
import { KameKnockEngine } from "./engines/kame-knock.engine";
import { ShellCurlEngine } from "./engines/shell-curl.engine";
import { MatchmakingGateway } from "./matchmaking.gateway";
import { GameInputPayload, SocketUser } from "./matchmaking.types";
import { RoomService } from "./room.service";
import { BOT_SOCKET_PREFIX, BotPlayerService, isBotSeat } from "./bot-player.service";

const botUser = (id: number): SocketUser =>
	({ id, username: `bot-user-${id}`, isGuest: false }) as SocketUser;

function makeHarness(gameId: string) {
	const registry = new GameEngineRegistry(
		new ShellCurlEngine(),
		new BambooBashEngine(),
		new KameKnockEngine(),
		new BellClashEngine(),
	);
	const rooms = new RoomService(registry);
	const room = rooms.createRoom("match-bot", gameId, "casual", [
		{ socketId: `${BOT_SOCKET_PREFIX}10`, user: botUser(10), shellSelection: [] },
		{ socketId: `${BOT_SOCKET_PREFIX}20`, user: botUser(20), shellSelection: [] },
	]);
	for (const player of room.players) {
		rooms.setReady(room.matchId, player.user.id);
	}
	rooms.start(room.matchId);

	// The gateway faked down to its engine-dispatch core (same contract as
	// handleUserInput: route to the engine, ack accepted/rejected).
	const gateway = {
		handleUserInput: async (userId: number, payload: GameInputPayload) => {
			const result = registry
				.get(room.gameId)
				.handleInput(room, userId, payload);
			return { accepted: result !== null };
		},
	} as unknown as MatchmakingGateway;

	const bots = new BotPlayerService(rooms, gateway);
	return { room, registry, bots };
}

/** Simulated wall-clock per loop step, advanced in ArenaSimulationService-sized ticks. */
const STEP_MS = 700;
const SIMULATION_TICK_MS = 1_000 / 30;

/**
 * Build the room UNDER virtual time (round clocks capture Date.now at start),
 * then tick until the match finishes (or bail). Each step lets the bots act,
 * then advances the server physics by the same amount of simulated time so
 * `physics.serverTime` keeps pace with the virtual Date.now.
 */
async function playToCompletion(gameId: string, maxSteps = 2000): Promise<ReturnType<typeof makeHarness>> {
	let virtualNow = 1_000_000;
	const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => virtualNow);
	try {
		const harness = makeHarness(gameId);
		const engine = harness.registry.get(gameId);
		for (let step = 0; step < maxSteps; step++) {
			if (harness.room.status !== "active") return harness;
			virtualNow += STEP_MS;
			await harness.bots.tick();
			for (
				let elapsed = 0;
				elapsed < STEP_MS && harness.room.status === "active";
				elapsed += SIMULATION_TICK_MS
			) {
				engine.advanceSimulation?.(harness.room, SIMULATION_TICK_MS);
			}
		}
		throw new Error(
			`bots did not finish ${harness.room.gameId} within ${maxSteps} steps ` +
				`(status ${harness.room.status})`,
		);
	} finally {
		nowSpy.mockRestore();
	}
}

describe("BotPlayerService — CPU players vs the real engines", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("marks bot seats by socket prefix only", () => {
		expect(
			isBotSeat({ socketId: "bot:42" } as never),
		).toBe(true);
		expect(isBotSeat({ socketId: "abc123" } as never)).toBe(false);
	});

	it.each(["temple-curling", "kame-knock", "bell-clash", "bamboo-bash"])(
		"two bots play %s to a finished match through the real engine",
		async (gameId) => {
			const harness = await playToCompletion(gameId);

			expect(harness.room.status).toBe("finished");
			expect(harness.room.state.phase).toBe("finished");
			// The ENGINE decided the winner from the bots' reported play; a tie
			// (winnerSide null) is legal, but scores must exist per seat.
			const score = (harness.room.state as { score: number[] }).score;
			expect(score).toHaveLength(2);
			expect(score.every((value) => Number.isFinite(value))).toBe(true);
		},
		30_000,
	);

	it("bots sit out the start-countdown hold before their first action", async () => {
		const registry = new GameEngineRegistry(
			new ShellCurlEngine(),
			new BambooBashEngine(),
			new KameKnockEngine(),
			new BellClashEngine(),
		);
		const rooms = new RoomService(registry);
		let virtualNow = 1_000_000;
		const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => virtualNow);
		try {
			const room = rooms.createRoom("match-hold", "kame-knock", "casual", [
				{ socketId: "bot:1", user: botUser(1), shellSelection: [] },
				{ socketId: "bot:2", user: botUser(2), shellSelection: [] },
			]);
			for (const player of room.players) {
				rooms.setReady(room.matchId, player.user.id);
			}
			rooms.start(room.matchId);

			const handleUserInput = jest.fn();
			const bots = new BotPlayerService(rooms, {
				handleUserInput,
			} as unknown as MatchmakingGateway);

			// Within the countdown window (clients show "3, 2, 1, GO!"): the
			// bots must not move, no matter how many ticks pass.
			for (let elapsed = 0; elapsed < 4_900; elapsed += 700) {
				await bots.tick();
				virtualNow += 700;
			}
			expect(handleUserInput).not.toHaveBeenCalled();

			// Past the hold (+ the per-seat act delay): the bots play.
			for (let elapsed = 0; elapsed < 4_000; elapsed += 700) {
				virtualNow += 700;
				await bots.tick();
			}
			expect(handleUserInput).toHaveBeenCalled();
		} finally {
			nowSpy.mockRestore();
		}
	});

	it("bots also sit out the round-transition countdown at every round boundary", async () => {
		const registry = new GameEngineRegistry(
			new ShellCurlEngine(),
			new BambooBashEngine(),
			new KameKnockEngine(),
			new BellClashEngine(),
		);
		const rooms = new RoomService(registry);
		let virtualNow = 1_000_000;
		const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => virtualNow);
		try {
			const room = rooms.createRoom("match-round-hold", "kame-knock", "casual", [
				{ socketId: "bot:1", user: botUser(1), shellSelection: [] },
				{ socketId: "bot:2", user: botUser(2), shellSelection: [] },
			]);
			for (const player of room.players) {
				rooms.setReady(room.matchId, player.user.id);
			}
			rooms.start(room.matchId);

			const handleUserInput = jest.fn().mockResolvedValue({ accepted: true });
			const bots = new BotPlayerService(rooms, {
				handleUserInput,
			} as unknown as MatchmakingGateway);

			// Clear the match-start hold (same margins as the test above) so the
			// bot is actively playing before we simulate a round boundary.
			for (let elapsed = 0; elapsed < 4_900; elapsed += 700) {
				await bots.tick();
				virtualNow += 700;
			}
			expect(handleUserInput).not.toHaveBeenCalled();
			for (let elapsed = 0; elapsed < 4_000; elapsed += 700) {
				virtualNow += 700;
				await bots.tick();
			}
			expect(handleUserInput).toHaveBeenCalled();
			handleUserInput.mockClear();

			// The engine advances `roundNumber` the instant a round ends, with no
			// server-side delay of its own — simulate that boundary directly.
			(room.state as { roundNumber: number }).roundNumber += 1;

			// Within the round's own "3, 2, 1, GO!" window (worst case 3.2s
			// countdown + up to 3s pause = 6.2s): the bots must not move.
			for (let elapsed = 0; elapsed < 4_100; elapsed += 700) {
				await bots.tick();
				virtualNow += 700;
			}
			expect(handleUserInput).not.toHaveBeenCalled();

			// Past the round hold: the bots resume for the new round.
			for (let elapsed = 0; elapsed < 4_000; elapsed += 700) {
				virtualNow += 700;
				await bots.tick();
			}
			expect(handleUserInput).toHaveBeenCalled();
		} finally {
			nowSpy.mockRestore();
		}
	});

	it("rolls an independent round-start delay per bot seat, not a shared room-wide draw", async () => {
		const registry = new GameEngineRegistry(
			new ShellCurlEngine(),
			new BambooBashEngine(),
			new KameKnockEngine(),
			new BellClashEngine(),
		);
		const rooms = new RoomService(registry);
		let virtualNow = 1_000_000;
		const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => virtualNow);
		try {
			// Bell Clash: both seats can shoot in the same round with no turn
			// gating, so a shared room-wide hold would show up here as both
			// bots' plans landing on the exact same instant.
			const room = rooms.createRoom("match-independent-round-hold", "bell-clash", "casual", [
				{ socketId: "bot:1", user: botUser(1), shellSelection: [] },
				{ socketId: "bot:2", user: botUser(2), shellSelection: [] },
			]);
			for (const player of room.players) {
				rooms.setReady(room.matchId, player.user.id);
			}
			rooms.start(room.matchId);

			const handleUserInput = jest.fn().mockResolvedValue({ accepted: true });
			const bots = new BotPlayerService(rooms, {
				handleUserInput,
			} as unknown as MatchmakingGateway);

			// Clear the match-start hold so both seats already have a plan.
			for (let elapsed = 0; elapsed < 8_900; elapsed += 700) {
				await bots.tick();
				virtualNow += 700;
			}
			expect(handleUserInput).toHaveBeenCalled();

			// Simulate a round boundary — this is what re-arms each seat's plan.
			(room.state as { roundNumber: number }).roundNumber += 1;
			await bots.tick();

			const plans = (bots as unknown as {
				plans: Map<string, { nextActionAt: number }>;
			}).plans;
			const [seatA, seatB] = room.players;
			const nextActionAtA = plans.get(`${room.matchId}|${seatA.side}`)?.nextActionAt;
			const nextActionAtB = plans.get(`${room.matchId}|${seatB.side}`)?.nextActionAt;

			expect(nextActionAtA).toBeDefined();
			expect(nextActionAtB).toBeDefined();
			// Two independent continuous draws landing on the exact same
			// millisecond would indicate a shared room-wide value again.
			expect(nextActionAtA).not.toEqual(nextActionAtB);
		} finally {
			nowSpy.mockRestore();
		}
	});

	it("bots never act on rooms without bot seats", async () => {
		const registry = new GameEngineRegistry(
			new ShellCurlEngine(),
			new BambooBashEngine(),
			new KameKnockEngine(),
			new BellClashEngine(),
		);
		const rooms = new RoomService(registry);
		const room = rooms.createRoom("match-humans", "kame-knock", "casual", [
			{ socketId: "sock-1", user: botUser(1), shellSelection: [] },
			{ socketId: "sock-2", user: botUser(2), shellSelection: [] },
		]);
		for (const player of room.players) {
			rooms.setReady(room.matchId, player.user.id);
		}
		rooms.start(room.matchId);

		const handleUserInput = jest.fn();
		const bots = new BotPlayerService(rooms, {
			handleUserInput,
		} as unknown as MatchmakingGateway);
		const nowSpy = jest
			.spyOn(Date, "now")
			.mockImplementation(() => 99_999_999);
		await bots.tick();
		nowSpy.mockRestore();

		expect(handleUserInput).not.toHaveBeenCalled();
	});
});
