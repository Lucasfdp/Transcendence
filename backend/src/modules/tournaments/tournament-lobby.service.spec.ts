import {
	ConflictException,
	ForbiddenException,
	NotFoundException,
} from "@nestjs/common";
import { Tournament } from "./entities/tournament.entity";
import { TournamentParticipant } from "./entities/tournament-participant.entity";
import {
	TournamentLobbyRecord,
	TournamentLobbyService,
} from "./tournament-lobby.service";
import {
	TOURNAMENT_PIN_ALPHABET,
	TOURNAMENT_PIN_PREFIX,
	TournamentLobbyUpdatedPayload,
} from "./tournaments.contracts";
import { TOURNAMENT_PLAYERS } from "./tournaments.constants";
import { deriveTurnOrder } from "./turn-order.util";

type QueryBuilderMock = {
	where: jest.Mock;
	andWhere: jest.Mock;
	getOne: jest.Mock;
};

const FUTURE = new Date(Date.now() + 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

function makeRecord(
	overrides: Partial<TournamentLobbyRecord> = {},
): TournamentLobbyRecord {
	return {
		pin: "TABCDE",
		creatorUserId: 1,
		seed: "deadbeef",
		expiresAt: FUTURE,
		invitedUserIds: [],
		seatsAssigned: false,
		...overrides,
	};
}

function makeTournament(
	record: TournamentLobbyRecord,
	overrides: Partial<Tournament> = {},
): Tournament {
	return {
		id: "t-1",
		status: "pending",
		configId: "parrots-shell-v1",
		state: { lobby: record },
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

function makeParticipant(
	userId: number,
	seat: number,
	overrides: Partial<TournamentParticipant> = {},
): TournamentParticipant {
	return {
		id: `p-${userId}`,
		tournamentId: "t-1",
		tournament: undefined as never,
		userId,
		user: { id: userId, username: `user${userId}` } as never,
		seat,
		finalPoints: 0,
		outcome: null,
		...overrides,
	} as TournamentParticipant;
}

describe("TournamentLobbyService (SPEC-038 entry & lobby)", () => {
	let service: TournamentLobbyService;
	let tournamentRepo: {
		findOne: jest.Mock;
		save: jest.Mock;
		create: jest.Mock;
		createQueryBuilder: jest.Mock;
	};
	let participantRepo: {
		find: jest.Mock;
		save: jest.Mock;
		create: jest.Mock;
		delete: jest.Mock;
		update: jest.Mock;
	};
	let userRepo: { findOne: jest.Mock };
	let profileRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
	let friendsService: { areFriends: jest.Mock };
	let notifications: {
		create: jest.Mock;
		removeWhere: jest.Mock;
		pushLiveEvent: jest.Mock;
	};
	let presence: { isOnline: jest.Mock };
	let dataSource: { transaction: jest.Mock };
	let runtimeService: { startTournament: jest.Mock };
	let pinQueryBuilder: QueryBuilderMock;

	/** participantRepo.find rows keyed by intent (see mock below). */
	let membershipRows: TournamentParticipant[];
	let participantQueue: TournamentParticipant[][];

	beforeEach(() => {
		membershipRows = [];
		participantQueue = [];

		pinQueryBuilder = {
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			getOne: jest.fn().mockResolvedValue(null),
		};
		tournamentRepo = {
			findOne: jest.fn(),
			save: jest.fn().mockImplementation(async (t: Tournament) => ({
				id: "t-1",
				createdAt: new Date("2026-07-13T10:00:00Z"),
				...t,
			})),
			create: jest.fn().mockImplementation((t: Partial<Tournament>) => t),
			createQueryBuilder: jest.fn().mockReturnValue(pinQueryBuilder),
		};
		participantRepo = {
			// Dispatch on the where clause: loadParticipants filters by
			// tournamentId (dequeue successive snapshots), the one-lobby rule
			// filters by userId (membershipRows).
			find: jest.fn().mockImplementation(async (opts: {
				where: Record<string, unknown>;
			}) => {
				if ("tournamentId" in (opts?.where ?? {})) {
					return participantQueue.length > 1
						? participantQueue.shift()
						: (participantQueue[0] ?? []);
				}
				return membershipRows;
			}),
			save: jest.fn().mockImplementation(async (p: unknown) => p),
			create: jest
				.fn()
				.mockImplementation((p: Partial<TournamentParticipant>) => p),
			delete: jest.fn().mockResolvedValue({ affected: 1 }),
			update: jest.fn().mockResolvedValue({ affected: 1 }),
		};
		userRepo = { findOne: jest.fn() };
		profileRepo = {
			findOne: jest.fn().mockResolvedValue(null),
			create: jest.fn((data: unknown) => data),
			save: jest.fn(async (data: unknown) => data),
		};
		friendsService = { areFriends: jest.fn().mockResolvedValue(true) };
		notifications = {
			create: jest.fn().mockResolvedValue(undefined),
			removeWhere: jest.fn().mockResolvedValue(undefined),
			pushLiveEvent: jest.fn(),
		};
		presence = { isOnline: jest.fn().mockReturnValue(true) };
		runtimeService = { startTournament: jest.fn().mockResolvedValue(undefined) };

		// withLockedTournament() runs join()/start() inside a pessimistic-lock
		// transaction. The manager re-fetches the row under lock, so its
		// Tournament.findOne must return the SAME instance the entry path
		// already resolved (via tournamentRepo.findOne, or pinQueryBuilder for
		// joinByPin) — otherwise mutations to the locked record wouldn't be
		// visible on the object each test holds. All other repositories are the
		// same mocks the non-locked helpers use.
		const managerTournamentRepo = {
			...tournamentRepo,
			findOne: jest.fn().mockImplementation(async () => {
				return (
					(await tournamentRepo.findOne()) ??
					(await pinQueryBuilder.getOne())
				);
			}),
		};
		const manager = {
			getRepository: jest.fn((entity: unknown) =>
				entity === Tournament ? managerTournamentRepo : participantRepo,
			),
		};
		dataSource = {
			transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) =>
				work(manager),
			),
		};

		service = new TournamentLobbyService(
			tournamentRepo as never,
			participantRepo as never,
			userRepo as never,
			profileRepo as never,
			friendsService as never,
			notifications as never,
			presence as never,
			dataSource as never,
			runtimeService as never,
		);
	});

	function lastPushedCause(): string {
		const updates = notifications.pushLiveEvent.mock.calls.filter(
			([event]) => event === "tournament:lobby-updated",
		);
		const payload = updates[updates.length - 1]?.[2] as
			| TournamentLobbyUpdatedPayload
			| undefined;
		return payload?.cause ?? "";
	}

	// ── create ────────────────────────────────────────────────────────────────

	describe("createLobby", () => {
		it("creates a pending lobby with a valid PIN and the creator seated", async () => {
			participantQueue = [[makeParticipant(1, 0)]];

			const state = await service.createLobby(1);

			expect(state.status).toBe("pending");
			expect(state.creatorUserId).toBe(1);
			expect(state.pin).toHaveLength(6);
			expect(state.pin.startsWith(TOURNAMENT_PIN_PREFIX)).toBe(true);
			for (const char of state.pin.slice(1)) {
				expect(TOURNAMENT_PIN_ALPHABET).toContain(char);
			}
			expect(participantRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ userId: 1, seat: 0 }),
			);
			// Seats are provisional until the lobby completes.
			expect(state.participants).toEqual([
				expect.objectContaining({ userId: 1, seat: null }),
			]);
			expect(lastPushedCause()).toBe("TournamentLobbyCreated");
		});

		it("persists the seed and expiry in state.lobby (no new columns)", async () => {
			participantQueue = [[makeParticipant(1, 0)]];

			await service.createLobby(1);

			const saved = tournamentRepo.save.mock.calls[0][0];
			const record = saved.state.lobby as TournamentLobbyRecord;
			expect(record.seed).toMatch(/^[0-9a-f]{32}$/);
			expect(new Date(record.expiresAt).getTime()).toBeGreaterThan(
				Date.now(),
			);
			expect(record.invitedUserIds).toEqual([]);
		});

		it("rejects a user who is already in a pending/active tournament", async () => {
			membershipRows = [
				makeParticipant(1, 0, {
					tournament: makeTournament(makeRecord()),
				} as never),
			];

			await expect(service.createLobby(1)).rejects.toThrow(
				ConflictException,
			);
			expect(tournamentRepo.save).not.toHaveBeenCalled();
		});

		it("does not let an expired stale lobby block a new one (lazy expiry)", async () => {
			const stale = makeTournament(makeRecord({ expiresAt: PAST }));
			membershipRows = [
				makeParticipant(1, 0, { tournament: stale } as never),
			];
			participantQueue = [[makeParticipant(1, 0)], [makeParticipant(1, 0)]];

			const state = await service.createLobby(1);

			expect(state.status).toBe("pending");
			// The stale lobby was flipped to cancelled and persisted.
			expect(stale.status).toBe("cancelled");
			expect(tournamentRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ id: stale.id, status: "cancelled" }),
			);
		});
	});

	// ── invite ────────────────────────────────────────────────────────────────

	describe("invite", () => {
		beforeEach(() => {
			userRepo.findOne.mockResolvedValue({
				id: 2,
				username: "user2",
				isGuest: false,
			});
		});

		it("sends a tournament_invite notification to a friend", async () => {
			const record = makeRecord();
			tournamentRepo.findOne.mockResolvedValue(makeTournament(record));
			participantQueue = [[makeParticipant(1, 0)]];

			const state = await service.invite("t-1", 1, 2);

			expect(record.invitedUserIds).toContain(2);
			expect(notifications.create).toHaveBeenCalledWith(
				"tournament_invite",
				1,
				2,
				expect.objectContaining({ tournamentId: "t-1" }),
			);
			expect(state.participants).toHaveLength(1);
			expect(lastPushedCause()).toBe("TournamentInviteSent");
		});

		it("rejects inviting a non-friend", async () => {
			friendsService.areFriends.mockResolvedValue(false);
			tournamentRepo.findOne.mockResolvedValue(
				makeTournament(makeRecord()),
			);
			participantQueue = [[makeParticipant(1, 0)]];

			await expect(service.invite("t-1", 1, 2)).rejects.toThrow(
				ForbiddenException,
			);
			expect(notifications.create).not.toHaveBeenCalled();
		});

		it("rejects inviting a guest (as user-not-found, no status leak)", async () => {
			userRepo.findOne.mockResolvedValue({ id: 2, isGuest: true });
			tournamentRepo.findOne.mockResolvedValue(
				makeTournament(makeRecord()),
			);
			participantQueue = [[makeParticipant(1, 0)]];

			await expect(service.invite("t-1", 1, 2)).rejects.toThrow(
				NotFoundException,
			);
		});

		it("rejects inviting into a full lobby", async () => {
			tournamentRepo.findOne.mockResolvedValue(
				makeTournament(makeRecord()),
			);
			participantQueue = [
				[1, 3, 4, 5, 6].map((id, i) => makeParticipant(id, i)),
			];

			await expect(service.invite("t-1", 1, 2)).rejects.toThrow(
				"This lobby is already full",
			);
		});

		it("rejects invites from anyone but the creator", async () => {
			tournamentRepo.findOne.mockResolvedValue(
				makeTournament(makeRecord({ creatorUserId: 1 })),
			);

			await expect(service.invite("t-1", 3, 2)).rejects.toThrow(
				ForbiddenException,
			);
		});

		it("rejects a target already in another pending/active tournament", async () => {
			tournamentRepo.findOne.mockResolvedValue(
				makeTournament(makeRecord()),
			);
			participantQueue = [[makeParticipant(1, 0)]];
			membershipRows = [
				makeParticipant(2, 0, {
					tournament: makeTournament(makeRecord(), { id: "t-2" }),
				} as never),
			];

			await expect(service.invite("t-1", 1, 2)).rejects.toThrow(
				ConflictException,
			);
		});
	});

	// ── join by invite ────────────────────────────────────────────────────────

	describe("joinByInvite", () => {
		it("lets an invited user join and consumes the invitation", async () => {
			const record = makeRecord({ invitedUserIds: [2] });
			tournamentRepo.findOne.mockResolvedValue(makeTournament(record));
			participantQueue = [
				[makeParticipant(1, 0)],
				[makeParticipant(1, 0), makeParticipant(2, 1)],
			];

			const state = await service.joinByInvite("t-1", 2);

			expect(record.invitedUserIds).not.toContain(2);
			expect(notifications.removeWhere).toHaveBeenCalledWith(
				"tournament_invite",
				1,
				2,
			);
			expect(state.participants).toHaveLength(2);
			expect(lastPushedCause()).toBe("TournamentPlayerJoined");
		});

		it("rejects a user who was never invited", async () => {
			tournamentRepo.findOne.mockResolvedValue(
				makeTournament(makeRecord({ invitedUserIds: [] })),
			);

			await expect(service.joinByInvite("t-1", 2)).rejects.toThrow(
				ForbiddenException,
			);
		});
	});

	// ── join by PIN ───────────────────────────────────────────────────────────

	describe("joinByPin", () => {
		it("rejects a malformed PIN without a DB lookup", async () => {
			await expect(service.joinByPin(2, "XXXXXX")).rejects.toThrow(
				"No tournament found for this PIN",
			);
			await expect(service.joinByPin(2, "T01")).rejects.toThrow(
				NotFoundException,
			);
			expect(pinQueryBuilder.getOne).not.toHaveBeenCalled();
		});

		it("rejects an unknown PIN", async () => {
			pinQueryBuilder.getOne.mockResolvedValue(null);

			await expect(service.joinByPin(2, "tabcde")).rejects.toThrow(
				"No tournament found for this PIN",
			);
		});

		it("normalizes the PIN to uppercase before the lookup", async () => {
			const record = makeRecord();
			pinQueryBuilder.getOne.mockResolvedValue(makeTournament(record));
			participantQueue = [
				[makeParticipant(1, 0)],
				[makeParticipant(1, 0), makeParticipant(2, 1)],
			];

			await service.joinByPin(2, "  tabcde  ");

			expect(pinQueryBuilder.andWhere).toHaveBeenCalledWith(
				expect.stringContaining("'pin'"),
				{ pin: "TABCDE" },
			);
		});

		it("rejects joining an expired lobby and persists the cancellation", async () => {
			const record = makeRecord({ expiresAt: PAST });
			const tournament = makeTournament(record);
			pinQueryBuilder.getOne.mockResolvedValue(tournament);
			participantQueue = [[makeParticipant(1, 0)]];

			await expect(service.joinByPin(2, "TABCDE")).rejects.toThrow(
				"This lobby has expired",
			);
			expect(tournament.status).toBe("cancelled");
			expect(tournamentRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ status: "cancelled" }),
			);
			expect(lastPushedCause()).toBe("TournamentLobbyCancelled");
		});

		it("rejects joining a full lobby", async () => {
			pinQueryBuilder.getOne.mockResolvedValue(
				makeTournament(makeRecord()),
			);
			participantQueue = [
				[1, 3, 4, 5, 6].map((id, i) => makeParticipant(id, i)),
			];

			await expect(service.joinByPin(2, "TABCDE")).rejects.toThrow(
				"This lobby is already full",
			);
		});

		it("rejects a user who is already a member", async () => {
			pinQueryBuilder.getOne.mockResolvedValue(
				makeTournament(makeRecord()),
			);
			participantQueue = [[makeParticipant(1, 0), makeParticipant(2, 1)]];

			await expect(service.joinByPin(2, "TABCDE")).rejects.toThrow(
				"You are already in this lobby",
			);
		});

		it("assigns seed-derived seats when the 5th player completes the lobby", async () => {
			const record = makeRecord({ seed: "seed-x" });
			pinQueryBuilder.getOne.mockResolvedValue(makeTournament(record));
			const before = [1, 3, 4, 5].map((id, i) => makeParticipant(id, i));
			const after = [...before, makeParticipant(2, 4)];
			participantQueue = [before, after];

			const state = await service.joinByPin(2, "TABCDE");

			const expectedOrder = deriveTurnOrder("seed-x", [1, 3, 4, 5, 2]);
			expect(record.seatsAssigned).toBe(true);
			for (const participant of after) {
				expect(participant.seat).toBe(
					expectedOrder.indexOf(participant.userId as number),
				);
			}
			expect(state.participants.map((p) => p.userId)).toEqual(
				expectedOrder,
			);
			expect(state.participants.map((p) => p.seat)).toEqual([
				0, 1, 2, 3, 4,
			]);
			expect(lastPushedCause()).toBe("TournamentLobbyCompleted");
			// Every member got the live update.
			const updates = notifications.pushLiveEvent.mock.calls.filter(
				([event]) => event === "tournament:lobby-updated",
			);
			expect(updates).toHaveLength(TOURNAMENT_PLAYERS);
		});
	});

	// ── leave ─────────────────────────────────────────────────────────────────

	describe("leave", () => {
		it("removes a non-creator member and notifies the rest", async () => {
			const record = makeRecord();
			tournamentRepo.findOne.mockResolvedValue(makeTournament(record));
			participantQueue = [[makeParticipant(1, 0), makeParticipant(2, 1)]];

			const state = await service.leave("t-1", 2);

			expect(participantRepo.delete).toHaveBeenCalledWith({ id: "p-2" });
			expect(state.status).toBe("pending");
			expect(state.participants.map((p) => p.userId)).toEqual([1]);
			expect(lastPushedCause()).toBe("TournamentPlayerLeft");
		});

		it("re-opens the seats when a member leaves a completed lobby", async () => {
			const record = makeRecord({ seatsAssigned: true });
			tournamentRepo.findOne.mockResolvedValue(makeTournament(record));
			participantQueue = [
				[1, 2, 3, 4].map((id, i) => makeParticipant(id, i)),
			];

			const state = await service.leave("t-1", 4);

			expect(record.seatsAssigned).toBe(false);
			expect(state.participants.every((p) => p.seat === null)).toBe(true);
		});

		it("cancels the whole lobby when the creator leaves", async () => {
			const record = makeRecord({ creatorUserId: 1 });
			const tournament = makeTournament(record);
			tournamentRepo.findOne.mockResolvedValue(tournament);
			participantQueue = [[makeParticipant(1, 0), makeParticipant(2, 1)]];

			const state = await service.leave("t-1", 1);

			expect(tournament.status).toBe("cancelled");
			expect(state.status).toBe("cancelled");
			expect(participantRepo.delete).not.toHaveBeenCalled();
			expect(lastPushedCause()).toBe("TournamentLobbyCancelled");
		});

		it("rejects leaving a lobby the user is not in", async () => {
			tournamentRepo.findOne.mockResolvedValue(
				makeTournament(makeRecord()),
			);
			participantQueue = [[makeParticipant(1, 0)]];

			await expect(service.leave("t-1", 9)).rejects.toThrow(
				NotFoundException,
			);
		});
	});

	// ── start ─────────────────────────────────────────────────────────────────

	describe("start", () => {
		it("rejects a non-creator", async () => {
			tournamentRepo.findOne.mockResolvedValue(
				makeTournament(makeRecord({ creatorUserId: 1 })),
			);

			await expect(service.start("t-1", 2)).rejects.toThrow(
				ForbiddenException,
			);
		});

		it("rejects starting before the lobby is full", async () => {
			tournamentRepo.findOne.mockResolvedValue(
				makeTournament(makeRecord()),
			);
			participantQueue = [
				[1, 2, 3].map((id, i) => makeParticipant(id, i)),
			];

			await expect(service.start("t-1", 1)).rejects.toThrow(
				`The lobby needs exactly ${TOURNAMENT_PLAYERS} players to start`,
			);
		});

		it("rejects starting an expired lobby", async () => {
			const tournament = makeTournament(makeRecord({ expiresAt: PAST }));
			tournamentRepo.findOne.mockResolvedValue(tournament);
			participantQueue = [
				[1, 2, 3, 4, 5].map((id, i) => makeParticipant(id, i)),
			];

			await expect(service.start("t-1", 1)).rejects.toThrow(
				"This lobby has expired",
			);
			expect(tournament.status).toBe("cancelled");
		});

		it("flips to active with seed-derived seats and announces tournament:starting", async () => {
			const record = makeRecord({ seed: "seed-y" });
			const tournament = makeTournament(record);
			tournamentRepo.findOne.mockResolvedValue(tournament);
			const members = [1, 2, 3, 4, 5].map((id, i) =>
				makeParticipant(id, i),
			);
			participantQueue = [members];

			const state = await service.start("t-1", 1);

			expect(tournament.status).toBe("active");
			expect(tournament.startedAt).toBeInstanceOf(Date);
			expect(state.status).toBe("active");

			const expectedOrder = deriveTurnOrder("seed-y", [1, 2, 3, 4, 5]);
			expect(state.participants.map((p) => p.userId)).toEqual(
				expectedOrder,
			);

			const startingPushes = notifications.pushLiveEvent.mock.calls.filter(
				([event]) => event === "tournament:starting",
			);
			expect(startingPushes).toHaveLength(TOURNAMENT_PLAYERS);
			for (const [, , payload] of startingPushes) {
				expect(payload).toEqual({
					tournamentId: "t-1",
					turnOrder: expectedOrder,
				});
			}
			// Hands the started tournament off to the Runtime (SPEC-001/023);
			// the lobby itself never deletes participants on start.
			expect(runtimeService.startTournament).toHaveBeenCalledWith("t-1");
			expect(participantRepo.delete).not.toHaveBeenCalled();
		});
	});

	// ── hydration ─────────────────────────────────────────────────────────────

	describe("getLobby", () => {
		it("hydrates the lobby for a member (survives refresh from DB alone)", async () => {
			const record = makeRecord({ invitedUserIds: [5] });
			tournamentRepo.findOne.mockResolvedValue(makeTournament(record));
			participantQueue = [[makeParticipant(1, 0), makeParticipant(2, 1)]];

			const state = await service.getLobby("t-1", 2);

			expect(state.id).toBe("t-1");
			expect(state.pin).toBe("TABCDE");
			expect(state.expiresAt).toBe(record.expiresAt);
			expect(state.participants.map((p) => p.username)).toEqual([
				"user1",
				"user2",
			]);
		});

		it("hydrates for an invitee who has not joined yet", async () => {
			tournamentRepo.findOne.mockResolvedValue(
				makeTournament(makeRecord({ invitedUserIds: [5] })),
			);
			participantQueue = [[makeParticipant(1, 0)]];

			await expect(service.getLobby("t-1", 5)).resolves.toMatchObject({
				id: "t-1",
			});
		});

		it("404s for strangers (no public read, existence not leaked)", async () => {
			tournamentRepo.findOne.mockResolvedValue(
				makeTournament(makeRecord()),
			);
			participantQueue = [[makeParticipant(1, 0)]];

			await expect(service.getLobby("t-1", 9)).rejects.toThrow(
				NotFoundException,
			);
		});

		it("lazily cancels an expired lobby on read and returns it cancelled", async () => {
			const tournament = makeTournament(makeRecord({ expiresAt: PAST }));
			tournamentRepo.findOne.mockResolvedValue(tournament);
			participantQueue = [[makeParticipant(1, 0)]];

			const state = await service.getLobby("t-1", 1);

			expect(state.status).toBe("cancelled");
			expect(tournamentRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ status: "cancelled" }),
			);
		});
	});

	describe("markParticipantLeft", () => {
		it("flips the row to a forfeit and records a loss on the player's record", async () => {
			profileRepo.findOne.mockResolvedValue({ totalLosses: 2, gamesPlayed: 5 });

			await service.markParticipantLeft("t-1", 10);

			expect(participantRepo.update).toHaveBeenCalledWith(
				{ tournamentId: "t-1", userId: 10, hasLeft: false },
				{ hasLeft: true, outcome: "forfeit" },
			);
			expect(profileRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ totalLosses: 3, gamesPlayed: 6 }),
			);
		});

		it("records no loss when the row was already flipped (repeated quit)", async () => {
			participantRepo.update.mockResolvedValueOnce({ affected: 0 });

			await service.markParticipantLeft("t-1", 10);

			expect(profileRepo.save).not.toHaveBeenCalled();
		});
	});
});
