import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { ManualClock, TournamentClock } from "../infra/clock";
import { TOURNAMENT_SETTINGS_V1 } from "../config/settings.catalog";
import { Tournament } from "../entities/tournament.entity";
import { TournamentParticipant } from "../entities/tournament-participant.entity";
import {
	mapTournamentPhaseToStatus,
	TournamentRuntimeService,
} from "./tournament-runtime.service";

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
	return {
		id: "t-1",
		status: "pending",
		configId: TOURNAMENT_SETTINGS_V1.id,
		state: { lobby: { seed: "seed-a", pin: "TABCDE" } },
		winnerUser: null,
		winnerUserId: null,
		createdAt: new Date("2026-07-13T10:00:00Z"),
		startedAt: null,
		finishedAt: null,
		participants: [],
		matches: [],
		...overrides,
	} as Tournament;
}

function makeParticipant(userId: number, seat: number): TournamentParticipant {
	return { id: `p-${userId}`, tournamentId: "t-1", userId, seat } as TournamentParticipant;
}

describe("mapTournamentPhaseToStatus (SPEC-023 correspondence table)", () => {
	it("maps CREATED / WAITING_PLAYERS to a non-terminal pending row", () => {
		for (const phase of ["CREATED", "WAITING_PLAYERS"] as const) {
			expect(mapTournamentPhaseToStatus(phase)).toEqual({
				status: "pending",
				terminal: false,
			});
		}
	});

	it("maps every in-progress phase (incl. the DEFEAT pass-through) to non-terminal active", () => {
		for (const phase of [
			"INITIALIZING",
			"ROUND_START",
			"PLAYER_TURNS",
			"MINIGAME",
			"GAMBLING_PHASE",
			"CHECK_KEY_ITEMS",
			"BOSS_EVENT",
			"FINAL_CHALLENGE",
			"VICTORY",
			"REWARDS",
			"DEFEAT",
		] as const) {
			expect(mapTournamentPhaseToStatus(phase)).toEqual({
				status: "active",
				terminal: false,
			});
		}
	});

	it("maps FINISHED and CANCELLED to their terminal rows", () => {
		expect(mapTournamentPhaseToStatus("FINISHED")).toEqual({
			status: "finished",
			terminal: true,
		});
		expect(mapTournamentPhaseToStatus("CANCELLED")).toEqual({
			status: "cancelled",
			terminal: true,
		});
	});
});

describe("TournamentRuntimeService (SPEC-001/SPEC-023)", () => {
	let service: TournamentRuntimeService;
	let tournamentRepo: { findOne: jest.Mock; save: jest.Mock };
	let participantRepo: { find: jest.Mock };
	let tournament: Tournament;

	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

		tournament = makeTournament();
		tournamentRepo = {
			findOne: jest.fn().mockImplementation(async () => tournament),
			save: jest.fn().mockImplementation(async (t: Tournament) => t),
		};
		participantRepo = {
			find: jest
				.fn()
				.mockResolvedValue([10, 20, 30, 40].map((id, i) => makeParticipant(id, i))),
		};
		const clockFactory = (): TournamentClock => new ManualClock(0);
		service = new TournamentRuntimeService(
			tournamentRepo as never,
			participantRepo as never,
			clockFactory,
		);
	});

	afterEach(() => jest.restoreAllMocks());

	it("starts a Runtime, persists the snapshot into state.runtime and preserves state.lobby", async () => {
		const lobby = tournament.state?.lobby;

		await service.startTournament("t-1");

		expect(service.hasRuntime("t-1")).toBe(true);
		// start() walks to ROUND_START and (interactive mode) HOLDS there —
		// round 1's turns wait for the players to reach the board (or the
		// first-turns grace) → row is active, not terminal.
		expect(tournament.status).toBe("active");
		expect(tournamentRepo.save).toHaveBeenCalled();
		const state = tournament.state as Record<string, unknown>;
		expect(state.lobby).toBe(lobby); // untouched
		expect(state.runtime).toBeDefined();
		expect((state.runtime as { machine: { phase: string } }).machine.phase).toBe(
			"ROUND_START",
		);
		expect(service.getRuntime("t-1")?.currentPhase).toBe("ROUND_START");

		// Every human reaches the board → the first turn opens for the derived
		// first player (nobody is skipped while still navigating).
		const runtime = service.getRuntime("t-1");
		for (const id of [10, 20, 30, 40]) runtime?.handlePlayerConnected(id);
		expect(runtime?.currentPhase).toBe("PLAYER_TURNS");
	});

	it("rejects an unknown configId", async () => {
		tournament = makeTournament({ configId: "does-not-exist" });
		await expect(service.startTournament("t-1")).rejects.toThrow(
			BadRequestException,
		);
	});

	it("404s when the tournament row is missing", async () => {
		tournamentRepo.findOne.mockResolvedValue(null);
		await expect(service.startTournament("t-1")).rejects.toThrow(
			NotFoundException,
		);
	});

	it("rejects a tournament with no lobby state to start from", async () => {
		tournament = makeTournament({ state: {} });
		await expect(service.startTournament("t-1")).rejects.toThrow(
			BadRequestException,
		);
	});

	it("cancel via a live Runtime flips the row to cancelled and drops the instance", async () => {
		await service.startTournament("t-1");
		await service.cancelTournament("t-1", "administrative");

		expect(tournament.status).toBe("cancelled");
		expect(tournament.finishedAt).toBeInstanceOf(Date);
		expect(service.hasRuntime("t-1")).toBe(false);
	});

	it("cancel with no live Runtime flips the persisted row directly", async () => {
		tournament = makeTournament({ status: "active" });
		await service.cancelTournament("t-1", "restart cleanup");

		expect(tournament.status).toBe("cancelled");
		expect(tournamentRepo.save).toHaveBeenCalled();
		expect(service.hasRuntime("t-1")).toBe(false);
	});

	it("cancel is a no-op on an already-terminal row (no live Runtime)", async () => {
		tournament = makeTournament({ status: "finished" });
		await service.cancelTournament("t-1", "late cancel");

		expect(tournament.status).toBe("finished");
		expect(tournamentRepo.save).not.toHaveBeenCalled();
	});
});
