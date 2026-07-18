/**
 * tournament.gateway.spec.ts — WS handler tests (SPEC-022).
 *
 * Covers: `tournament:join` validation (auth, unknown tournament, non-
 * participant) and the snapshot-envelope ack; `tournament:intent` validation
 * and forwarding of RollDiceIntent to the Runtime (accepted/rejected acks,
 * never state); unknown intents rejected; leave/disconnect exits the room,
 * flips the connected flag and auto-resolves the leaver's active turn.
 */

import { Logger } from "@nestjs/common";
import { Repository } from "typeorm";
import { Server, Socket } from "socket.io";
import { User } from "../users/entities/user.entity";
import { ManualClock } from "./infra/clock";
import { TOURNAMENT_SETTINGS_V1 } from "./config/settings.catalog";
import { TournamentRuntime } from "./runtime/tournament-runtime";
import { TournamentRuntimeService } from "./runtime/tournament-runtime.service";
import { TournamentGateway } from "./tournament.gateway";
import { TournamentLobbyService } from "./tournament-lobby.service";
import { TournamentSyncService, tournamentRoomName } from "./tournament-sync.service";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PARTICIPANT_IDS = [10, 20, 30, 40];

const flushMicrotasks = (): Promise<void> =>
	new Promise((resolve) => setImmediate(resolve));

interface FakeSocket {
	data: Record<string, unknown>;
	join: jest.Mock;
	leave: jest.Mock;
}

function makeSocket(userId: number | null): FakeSocket {
	return {
		data: userId === null ? {} : { user: { id: userId, username: `user-${userId}` } },
		join: jest.fn(),
		leave: jest.fn(),
	};
}

async function makeHarness() {
	const server = {
		to: () => ({ emit: () => undefined }),
	} as unknown as Server;

	const userRepo = {
		find: jest.fn().mockResolvedValue(
			PARTICIPANT_IDS.map((id) => ({ id, username: `user-${id}` })),
		),
	} as unknown as Repository<User>;

	const clock = new ManualClock(1_000);
	const runtime = new TournamentRuntime({
		tournamentId: TOURNAMENT_ID,
		seed: "seed-a",
		participantIds: PARTICIPANT_IDS,
		settings: { ...TOURNAMENT_SETTINGS_V1, maxRound: 2 },
		clock,
		onSnapshot: () => undefined,
		interactiveTurns: true,
	});

	const runtimeService = {
		getRuntime: (id: string) => (id === TOURNAMENT_ID ? runtime : undefined),
		cancelTournament: jest.fn().mockResolvedValue(undefined),
		convertMinigameSeatToBot: jest.fn(),
	} as unknown as TournamentRuntimeService;

	const sync = new TournamentSyncService(userRepo);
	sync.setServer(server);
	await sync.attach(TOURNAMENT_ID, runtime);
	runtime.start();
	await flushMicrotasks();

	const lobby = {
		markParticipantLeft: jest.fn().mockResolvedValue(undefined),
	} as unknown as TournamentLobbyService;

	const gateway = new TournamentGateway(runtimeService, sync, lobby);
	return { gateway, runtime, sync, lobby, clock, runtimeService };
}

describe("TournamentGateway (SPEC-022)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "verbose").mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it("join: a participant enters the room and receives the current envelope", async () => {
		const { gateway } = await makeHarness();
		const socket = makeSocket(10);

		const ack = gateway.handleJoin(socket as unknown as Socket, {
			tournamentId: TOURNAMENT_ID,
		});

		expect(ack.ok).toBe(true);
		if (ack.ok) {
			expect(ack.envelope.snapshot.phase).toBe("PLAYER_TURNS");
			expect(ack.envelope.snapshot.tournamentId).toBe(TOURNAMENT_ID);
		}
		expect(socket.join).toHaveBeenCalledWith(tournamentRoomName(TOURNAMENT_ID));
		expect(socket.data.tournamentId).toBe(TOURNAMENT_ID);
	});

	it("join: rejects unauthenticated sockets, unknown tournaments and non-participants", async () => {
		const { gateway } = await makeHarness();

		expect(
			gateway.handleJoin(makeSocket(null) as unknown as Socket, {
				tournamentId: TOURNAMENT_ID,
			}),
		).toEqual({ ok: false, reason: "not_participant" });

		expect(
			gateway.handleJoin(makeSocket(10) as unknown as Socket, {
				tournamentId: "missing",
			}),
		).toEqual({ ok: false, reason: "not_running" });

		expect(
			gateway.handleJoin(makeSocket(999) as unknown as Socket, {
				tournamentId: TOURNAMENT_ID,
			}),
		).toEqual({ ok: false, reason: "not_participant" });
	});

	it("intent: forwards RollDiceIntent for the active player and acks acceptance", async () => {
		const { gateway, runtime } = await makeHarness();
		const active = runtime.gameEngines.turnSystem.activePlayerId as number;
		const socket = makeSocket(active);

		const ack = gateway.handleIntent(socket as unknown as Socket, {
			tournamentId: TOURNAMENT_ID,
			intent: { name: "RollDiceIntent" },
		});

		expect(ack).toEqual({ accepted: true });
		// The turn advanced server-side — the next player now holds the turn.
		expect(runtime.gameEngines.turnSystem.activePlayerId).not.toBe(active);
	});

	it("intent: rejects out-of-turn rolls and unknown intents (never state in the ack)", async () => {
		const { gateway, runtime } = await makeHarness();
		const active = runtime.gameEngines.turnSystem.activePlayerId as number;
		const bystander = PARTICIPANT_IDS.find((id) => id !== active) as number;

		expect(
			gateway.handleIntent(makeSocket(bystander) as unknown as Socket, {
				tournamentId: TOURNAMENT_ID,
				intent: { name: "RollDiceIntent" },
			}),
		).toEqual({ accepted: false, reason: "not_active_player" });

		expect(
			gateway.handleIntent(makeSocket(active) as unknown as Socket, {
				tournamentId: TOURNAMENT_ID,
				intent: { name: "HackTheEconomyIntent" } as never,
			}),
		).toEqual({ accepted: false, reason: "unknown_intent" });

		// The active turn is untouched by rejected intents.
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(active);
	});

	it("disconnect: exits the room and auto-resolves the leaver's active turn after the grace", async () => {
		const { gateway, runtime, sync, clock } = await makeHarness();
		const active = runtime.gameEngines.turnSystem.activePlayerId as number;
		const socket = makeSocket(active);
		gateway.handleJoin(socket as unknown as Socket, { tournamentId: TOURNAMENT_ID });

		gateway.handleDisconnect(socket as unknown as Socket);

		expect(socket.leave).toHaveBeenCalledWith(tournamentRoomName(TOURNAMENT_ID));
		// Grace first (quick rejoins must not skip the turn), then auto-resolve
		// (SPEC-005) and the baton moves on.
		expect(runtime.gameEngines.turnSystem.activePlayerId).toBe(active);
		clock.advance(3_000);
		expect(runtime.gameEngines.turnSystem.activePlayerId).not.toBe(active);
		await flushMicrotasks();
		const envelope = sync.buildEnvelope(TOURNAMENT_ID);
		expect(
			envelope?.snapshot.players.find((p) => p.userId === active)?.connected,
		).toBe(false);
	});

	it("leave: same exit path, idempotent for sockets that never joined", async () => {
		const { gateway } = await makeHarness();
		const socket = makeSocket(10);
		// Never joined: nothing to leave, no throw.
		gateway.handleLeave(socket as unknown as Socket);
		expect(socket.leave).not.toHaveBeenCalled();
	});

	it("quit: hands the seat to a CPU, persists the leave, and bars rejoin", async () => {
		const { gateway, runtime, sync, lobby, clock } = await makeHarness();
		const active = runtime.gameEngines.turnSystem.activePlayerId as number;
		const socket = makeSocket(active);
		gateway.handleJoin(socket as unknown as Socket, { tournamentId: TOURNAMENT_ID });

		await gateway.handleQuit(socket as unknown as Socket);

		// Left the room and was replaced by a CPU that keeps their seat.
		expect(socket.leave).toHaveBeenCalledWith(tournamentRoomName(TOURNAMENT_ID));
		expect(runtime.botPlayers.has(active)).toBe(true);
		// Persisted so the one-tournament-per-user gate frees them.
		expect(lobby.markParticipantLeft).toHaveBeenCalledWith(TOURNAMENT_ID, active);
		expect(sync.hasLeft(TOURNAMENT_ID, active)).toBe(true);

		// The CPU takes over the departed player's active turn (bot delay, well
		// below the roll timeout) and hands the baton on — the match plays on.
		clock.advance(1_500);
		await flushMicrotasks();
		expect(runtime.gameEngines.turnSystem.activePlayerId).not.toBe(active);

		// Reconnection is barred — only disconnected players may rejoin.
		const rejoin = gateway.handleJoin(makeSocket(active) as unknown as Socket, {
			tournamentId: TOURNAMENT_ID,
		});
		expect(rejoin).toEqual({ ok: false, reason: "left" });
	});

	it("quit: the LAST human leaving cancels the whole tournament (no all-CPU limbo)", async () => {
		const { gateway, runtime, runtimeService } = await makeHarness();

		// Every human quits, one after another.
		for (const id of PARTICIPANT_IDS) {
			const socket = makeSocket(id);
			gateway.handleJoin(socket as unknown as Socket, {
				tournamentId: TOURNAMENT_ID,
			});
			await gateway.handleQuit(socket as unknown as Socket);
		}

		expect(runtime.humanPlayerCount).toBe(0);
		// Cancelled exactly once — only when the final human left, not before.
		expect(runtimeService.cancelTournament).toHaveBeenCalledTimes(1);
		expect(runtimeService.cancelTournament).toHaveBeenCalledWith(
			TOURNAMENT_ID,
			expect.any(String),
		);
	});

	it("quit: is a no-op for a socket that never joined", async () => {
		const { gateway, lobby } = await makeHarness();
		const socket = makeSocket(10);
		await gateway.handleQuit(socket as unknown as Socket);
		expect(socket.leave).not.toHaveBeenCalled();
		expect(lobby.markParticipantLeft).not.toHaveBeenCalled();
	});

	it("quit from the arena: a body-supplied tournament id works for a participant socket outside the room", async () => {
		const { gateway, runtime, sync, lobby, runtimeService } = await makeHarness();
		// The player is mid-minigame: their socket LEFT the tournament room when
		// entering the arena, so socket.data carries no tournamentId.
		const socket = makeSocket(20);

		await gateway.handleQuit(socket as unknown as Socket, {
			tournamentId: TOURNAMENT_ID,
		});

		expect(runtime.botPlayers.has(20)).toBe(true);
		expect(sync.hasLeft(TOURNAMENT_ID, 20)).toBe(true);
		expect(lobby.markParticipantLeft).toHaveBeenCalledWith(TOURNAMENT_ID, 20);
		// Their live minigame seat is handed to a CPU stand-in too.
		expect(runtimeService.convertMinigameSeatToBot).toHaveBeenCalledWith(
			TOURNAMENT_ID,
			20,
		);
	});

	it("quit from the arena: a body id is rejected for non-participants and unknown tournaments", async () => {
		const { gateway, sync, lobby } = await makeHarness();

		// Authenticated but not seated in this tournament.
		await gateway.handleQuit(makeSocket(999) as unknown as Socket, {
			tournamentId: TOURNAMENT_ID,
		});
		expect(sync.hasLeft(TOURNAMENT_ID, 999)).toBe(false);

		// Unknown tournament id.
		await gateway.handleQuit(makeSocket(20) as unknown as Socket, {
			tournamentId: "missing",
		});
		expect(sync.hasLeft(TOURNAMENT_ID, 20)).toBe(false);
		expect(lobby.markParticipantLeft).not.toHaveBeenCalled();
	});
});
