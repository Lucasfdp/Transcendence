/**
 * bot-player.service.spec.ts — CPU players vs the REAL game engines.
 *
 * The strongest guarantee we can give: two bot seats play every one of the
 * four arena games THROUGH the real engine (`handleInput` validation and turn
 * gating included) all the way to a finished match with a winner decided by
 * the engine's own scoring. The gateway is faked down to its engine-dispatch
 * core (the per-game broadcast blocks are presentation), Date.now is virtual
 * so the pacing delays and round clocks elapse instantly.
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
	return { room, bots };
}

/**
 * Build the room UNDER virtual time (round clocks capture Date.now at start),
 * then tick until the match finishes (or bail).
 */
async function playToCompletion(gameId: string, maxSteps = 2000): Promise<ReturnType<typeof makeHarness>> {
	let virtualNow = 1_000_000;
	const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => virtualNow);
	try {
		const harness = makeHarness(gameId);
		for (let step = 0; step < maxSteps; step++) {
			if (harness.room.status !== "active") return harness;
			virtualNow += 700;
			await harness.bots.tick();
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
