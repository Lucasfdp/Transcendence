/**
 * tournament-sync.service.spec.ts — snapshot-first sync tests (SPEC-022).
 *
 * Covers: attach → initial full V1 snapshot broadcast to the tournament room;
 * one synchronous burst of domain events (a whole turn) coalesces into ONE
 * broadcast with a monotonic seq; connected flags flow through markConnected/
 * markDisconnected; buildEnvelope serves the current state without bumping
 * seq (join ack / reconnection); the terminal snapshot detaches the sync.
 */

import { Logger } from "@nestjs/common";
import { Repository } from "typeorm";
import { Server } from "socket.io";
import { User } from "../users/entities/user.entity";
import { ManualClock } from "./infra/clock";
import { TOURNAMENT_SETTINGS_V1 } from "./config/settings.catalog";
import { TournamentRuntime } from "./runtime/tournament-runtime";
import {
	TournamentSyncService,
	tournamentRoomName,
} from "./tournament-sync.service";
import { TournamentSnapshotEnvelope } from "./tournaments.contracts";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PARTICIPANT_IDS = [10, 20, 30, 40];

const flushMicrotasks = (): Promise<void> =>
	new Promise((resolve) => setImmediate(resolve));

function makeHarness() {
	const emitted: {
		room: string;
		event: string;
		payload: TournamentSnapshotEnvelope;
	}[] = [];
	const server = {
		to: (room: string) => ({
			emit: (event: string, payload: TournamentSnapshotEnvelope) => {
				emitted.push({ room, event, payload });
			},
		}),
	} as unknown as Server;

	const userRepo = {
		find: jest
			.fn()
			.mockResolvedValue(
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

	const sync = new TournamentSyncService(userRepo);
	sync.setServer(server);
	return { sync, runtime, clock, emitted };
}

describe("TournamentSyncService (SPEC-022 snapshot-first)", () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(
			() => undefined,
		);
		jest.spyOn(Logger.prototype, "error").mockImplementation(
			() => undefined,
		);
		jest.spyOn(Logger.prototype, "debug").mockImplementation(
			() => undefined,
		);
		jest.spyOn(Logger.prototype, "verbose").mockImplementation(
			() => undefined,
		);
	});
	afterEach(() => jest.restoreAllMocks());

	it("attach broadcasts a complete V1 snapshot to the tournament room", async () => {
		const { sync, runtime, emitted } = makeHarness();
		await sync.attach(TOURNAMENT_ID, runtime);
		runtime.start();
		await flushMicrotasks();

		expect(emitted.length).toBeGreaterThanOrEqual(1);
		const { room, event, payload } = emitted[emitted.length - 1];
		expect(room).toBe(tournamentRoomName(TOURNAMENT_ID));
		expect(event).toBe("tournament:snapshot");

		const snapshot = payload.snapshot;
		expect(snapshot.version).toBe(1);
		expect(snapshot.tournamentId).toBe(TOURNAMENT_ID);
		expect(snapshot.status).toBe("active");
		expect(snapshot.phase).toBe("PLAYER_TURNS");
		expect(snapshot.round).toBe(1);
		expect(snapshot.maxRound).toBe(2);
		expect(snapshot.turnOrder).toHaveLength(4);
		expect(snapshot.activePlayerId).toBe(snapshot.turnOrder[0]);
		expect(snapshot.turnDeadlineAt).not.toBeNull();
		expect(snapshot.board.tiles).toHaveLength(28);
		expect(snapshot.board.tiles[0]).toEqual({
			id: "tile-0",
			kind: "start",
			order: 0,
		});
		expect(snapshot.board.tiles[5].kind).toBe("bonus");
		expect(snapshot.board.tiles[18].kind).toBe("shop");
		expect(snapshot.shop).toBeNull();
		expect(snapshot.players).toHaveLength(4);
		for (const player of snapshot.players) {
			expect(player.username).toBe(`user-${player.userId}`);
			expect(player.points).toBe(TOURNAMENT_SETTINGS_V1.initialPoints);
			expect(player.tileId).toBe("tile-0"); // everyone spawns on the start tile
			expect(player.connected).toBe(false);
		}
		expect(snapshot.keyItems).toEqual({
			unlocked: 0,
			required: TOURNAMENT_SETTINGS_V1.keyItemsRequired,
		});
		// JSON-safe (goes on the wire).
		expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
	});

	it("exposes an open shop session with the shopper-priced catalog (SPEC-012)", async () => {
		const { sync, runtime, emitted } = makeHarness();
		await sync.attach(TOURNAMENT_ID, runtime);
		runtime.start();
		await flushMicrotasks();

		const active = runtime.gameEngines.turnSystem.activePlayerId as number;
		runtime.gameEngines.shop.open(active);
		await flushMicrotasks();

		const snapshot = emitted[emitted.length - 1].payload.snapshot;
		expect(snapshot.shop).toMatchObject({ playerId: active });
		expect(snapshot.shop?.deadlineAt).toBeGreaterThan(0);
		expect(snapshot.shop?.offers.map((o) => o.id)).toEqual([
			"pointsPack",
			"luckyDiceOffer",
			"badgeOffer",
		]);
		// Round 1: the badge (minRound 2) is listed but not yet available.
		expect(
			snapshot.shop?.offers.find((o) => o.id === "badgeOffer")?.available,
		).toBe(false);
		expect(
			snapshot.shop?.offers.find((o) => o.id === "pointsPack"),
		).toMatchObject({ price: 40, available: true });

		// Closing the session clears the wire field again.
		runtime.gameEngines.shop.cancel(active);
		await flushMicrotasks();
		expect(emitted[emitted.length - 1].payload.snapshot.shop).toBeNull();
	});

	it("coalesces one whole turn (roll+move+resolve burst) into ONE broadcast, seq monotonic", async () => {
		const { sync, runtime, clock, emitted } = makeHarness();
		await sync.attach(TOURNAMENT_ID, runtime);
		runtime.start();
		await flushMicrotasks();
		const before = emitted.length;
		const seqBefore = emitted[emitted.length - 1].payload.seq;

		const active = runtime.gameEngines.turnSystem.activePlayerId as number;
		expect(runtime.handleRollDice(active)).toEqual({ status: "ok" });
		await flushMicrotasks();

		expect(emitted.length).toBe(before + 1); // ONE snapshot for the burst
		const after = emitted[emitted.length - 1].payload;
		expect(after.seq).toBe(seqBefore + 1);
		// The turn resolved; the baton passes only after the handoff pause
		// (the boards are walking the token), so this snapshot has no active
		// player yet — the next one carries turnOrder[1].
		expect(after.snapshot.activePlayerId).toBeNull();
		// The resolved roll rides the snapshot (dice reveal, SPEC-022): the
		// board client replays it as value-reveal + token walk.
		expect(after.snapshot.lastRoll).toEqual({
			playerId: active,
			round: 1,
			value: expect.any(Number),
			autoResolved: false,
		});

		clock.advance(3_000); // turn handoff → the next turn opens
		await flushMicrotasks();
		const next = emitted[emitted.length - 1].payload.snapshot;
		expect(next.activePlayerId).toBe(next.turnOrder[1]);

		const seqs = emitted.map((e) => e.payload.seq);
		expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // strictly increasing
	});

	it("markConnected / markDisconnected flow into the players' connected flags", async () => {
		const { sync, runtime, emitted } = makeHarness();
		await sync.attach(TOURNAMENT_ID, runtime);
		runtime.start();
		await flushMicrotasks();

		sync.markConnected(TOURNAMENT_ID, 20);
		await flushMicrotasks();
		let players = emitted[emitted.length - 1].payload.snapshot.players;
		expect(players.find((p) => p.userId === 20)?.connected).toBe(true);
		expect(players.find((p) => p.userId === 10)?.connected).toBe(false);

		sync.markDisconnected(TOURNAMENT_ID, 20);
		await flushMicrotasks();
		players = emitted[emitted.length - 1].payload.snapshot.players;
		expect(players.find((p) => p.userId === 20)?.connected).toBe(false);
	});

	it("buildEnvelope serves the current snapshot WITHOUT bumping seq (join ack)", async () => {
		const { sync, runtime, emitted } = makeHarness();
		await sync.attach(TOURNAMENT_ID, runtime);
		runtime.start();
		await flushMicrotasks();
		const lastSeq = emitted[emitted.length - 1].payload.seq;

		const envelope = sync.buildEnvelope(TOURNAMENT_ID);
		expect(envelope?.seq).toBe(lastSeq);
		expect(envelope?.snapshot.phase).toBe("PLAYER_TURNS");
		expect(sync.buildEnvelope("missing")).toBeNull();
	});

	it("the terminal snapshot is broadcast and the sync detaches", async () => {
		const { sync, runtime, clock, emitted } = makeHarness();
		await sync.attach(TOURNAMENT_ID, runtime);
		runtime.start();
		await flushMicrotasks();

		// Let every turn time out (+ the turn-handoff pause each):
		// 2 rounds × 4 players → DEFEAT → FINISHED.
		for (let i = 0; i < 8; i++) {
			clock.advance(
				TOURNAMENT_SETTINGS_V1.timeouts.turnSeconds * 1000 + 3_000,
			);
			await flushMicrotasks();
		}

		const last = emitted[emitted.length - 1].payload.snapshot;
		expect(last.phase).toBe("FINISHED");
		expect(last.status).toBe("finished");
		expect(sync.isAttached(TOURNAMENT_ID)).toBe(false);
		expect(sync.buildEnvelope(TOURNAMENT_ID)).toBeNull();
	});
});
