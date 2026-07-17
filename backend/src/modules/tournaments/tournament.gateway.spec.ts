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
	} as unknown as TournamentRuntimeService;

	const sync = new TournamentSyncService(userRepo);
	sync.setServer(server);
	await sync.attach(TOURNAMENT_ID, runtime);
	runtime.start();
	await flushMicrotasks();

	const gateway = new TournamentGateway(runtimeService, sync);
	return { gateway, runtime, sync };
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

	it("disconnect: exits the room and auto-resolves the leaver's active turn", async () => {
		const { gateway, runtime, sync } = await makeHarness();
		const active = runtime.gameEngines.turnSystem.activePlayerId as number;
		const socket = makeSocket(active);
		gateway.handleJoin(socket as unknown as Socket, { tournamentId: TOURNAMENT_ID });

		gateway.handleDisconnect(socket as unknown as Socket);

		expect(socket.leave).toHaveBeenCalledWith(tournamentRoomName(TOURNAMENT_ID));
		// Their turn auto-resolved (SPEC-005) and the baton moved on.
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
});
