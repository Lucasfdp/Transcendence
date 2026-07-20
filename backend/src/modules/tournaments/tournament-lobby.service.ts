import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomBytes } from "crypto";
import { DataSource, EntityManager, In, Like, Repository } from "typeorm";
import { NotificationsService } from "../notifications/notifications.service";
import { PresenceService } from "../presence/presence.service";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import { FriendsService } from "../friends/friends.service";
import { TournamentRuntimeService } from "./runtime/tournament-runtime.service";
import { TournamentSyncService } from "./tournament-sync.service";
import { Tournament } from "./entities/tournament.entity";
import { TournamentParticipant } from "./entities/tournament-participant.entity";
import {
	TOURNAMENT_PIN_ALPHABET,
	TOURNAMENT_PIN_LENGTH,
	TOURNAMENT_PIN_PREFIX,
	TOURNAMENT_WS_EVENTS,
	TournamentLobbyEventName,
	TournamentLobbyState,
	TournamentLobbyUpdatedPayload,
	TournamentStartingPayload,
} from "./tournaments.contracts";
import {
	TOURNAMENT_BOT_EMAIL_DOMAIN,
	TOURNAMENT_BOT_NAMES,
	TOURNAMENT_DEFAULT_CONFIG_ID,
	TOURNAMENT_LOBBY_EXPIRY_MS,
	TOURNAMENT_PLAYERS,
} from "./tournaments.constants";
import { deriveTurnOrder } from "./turn-order.util";

/**
 * Lobby-phase data persisted inside `tournaments.state` under the `lobby`
 * key (architect ruling #1 of the entry-lobby brief): the lobby IS the
 * pending `tournaments` row, so it survives refreshes and restarts with no
 * extra columns or migration.
 */
export interface TournamentLobbyRecord {
	/** Shareable join PIN — prefix "T" + 5 unambiguous chars (ruling #2). */
	pin: string;
	creatorUserId: number;
	/**
	 * Random seed persisted at creation. Source of the deterministic turn
	 * order (turn-order.util.ts); the Runtime reuses it in later phases.
	 */
	seed: string;
	/** ISO-8601 lobby expiry deadline (lazy enforcement, ruling #5). */
	expiresAt: string;
	/** Outstanding invitations (removed when the invitee joins). */
	invitedUserIds: number[];
	/**
	 * True once seats were derived from the seed (lobby completion). While
	 * false, participant seats are provisional join-order values and are
	 * exposed as null to clients.
	 */
	seatsAssigned: boolean;
	/**
	 * CPU participants seated by the creator (CPU v2). Absent on records
	 * persisted before the feature — treat as []. The Runtime drives these
	 * seats (board turns + gambling policy); the minigame adapter seats them
	 * as `bot:` stand-ins automatically (they are never online).
	 */
	botUserIds?: number[];
}

const PIN_GENERATION_MAX_ATTEMPTS = 20;
const PIN_NOT_FOUND_MESSAGE = "No tournament found for this PIN";

/**
 * TournamentLobbyService — SPEC-038 entry & lobby flow (Phase 0).
 *
 * DB-backed lobby on the `tournaments` row (status `pending`); realtime goes
 * exclusively through NotificationsService (persisted `tournament_invite`
 * bell entries + ephemeral `pushLiveEvent` lobby updates). No gateway, no
 * state machine, no gameplay: `start()` flips the row to `active` and hands
 * off to TournamentRuntimeService (SPEC-001/SPEC-023, Phase 1) — the lobby
 * never imports the Runtime class itself, only the service that owns it.
 *
 * Concurrency hardening (SPEC-023 accepted-risk closure): the join critical
 * section (`join()`) and `start()` both re-validate the seat count inside a
 * serialized DB transaction with a `pessimistic_write` lock on the
 * `tournaments` row (`withLockedTournament`), so concurrent joins can never
 * overfill the 5-seat lobby and a join can never race a start.
 */
@Injectable()
export class TournamentLobbyService {
	constructor(
		@InjectRepository(Tournament)
		private readonly tournamentRepo: Repository<Tournament>,
		@InjectRepository(TournamentParticipant)
		private readonly participantRepo: Repository<TournamentParticipant>,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
		@InjectRepository(Profile)
		private readonly profileRepo: Repository<Profile>,
		private readonly friendsService: FriendsService,
		private readonly notifications: NotificationsService,
		private readonly presence: PresenceService,
		private readonly dataSource: DataSource,
		private readonly runtimeService: TournamentRuntimeService,
		@Optional() private readonly sync?: TournamentSyncService,
	) {}

	// ── Public API (one method per SPEC-038 endpoint) ─────────────────────────

	/** POST /tournaments — create a lobby; the creator auto-joins seat 0. */
	async createLobby(creatorUserId: number): Promise<TournamentLobbyState> {
		await this.assertNotInAnotherTournament(creatorUserId);

		const now = Date.now();
		const record: TournamentLobbyRecord = {
			pin: await this.generateUniquePin(),
			creatorUserId,
			seed: randomBytes(16).toString("hex"),
			expiresAt: new Date(now + TOURNAMENT_LOBBY_EXPIRY_MS).toISOString(),
			invitedUserIds: [],
			seatsAssigned: false,
		};

		const tournament = await this.tournamentRepo.save(
			this.tournamentRepo.create({
				status: "pending",
				configId: TOURNAMENT_DEFAULT_CONFIG_ID,
				state: { lobby: record },
			}),
		);
		await this.participantRepo.save(
			this.participantRepo.create({
				tournamentId: tournament.id,
				userId: creatorUserId,
				seat: 0,
			}),
		);

		const state = await this.buildLobbyState(tournament, record);
		this.pushLobbyUpdate(state, "TournamentLobbyCreated");
		return state;
	}

	/**
	 * GET /tournaments/:id — hydration for members and invitees only
	 * (SPEC-038 grants no public read; strangers get a 404, not a 403, so
	 * lobby existence is never leaked).
	 */
	async getLobby(
		tournamentId: string,
		userId: number,
	): Promise<TournamentLobbyState> {
		const tournament = await this.loadTournament(tournamentId);
		const record = this.getLobbyRecord(tournament);
		await this.expireIfNeeded(tournament, record);

		const participants = await this.loadParticipants(tournament.id);
		const isMember = participants.some((p) => p.userId === userId);
		const isInvitee = record.invitedUserIds.includes(userId);
		if (!isMember && !isInvitee) {
			throw new NotFoundException("Tournament not found");
		}
		return this.toLobbyState(tournament, record, participants);
	}

	/**
	 * GET /tournaments/mine — the caller's current pending/active lobby, or null.
	 *
	 * One lobby per user (SPEC-038), so this returns at most one. Lets the entry
	 * UI re-hydrate an existing lobby after a refresh / reopen instead of offering
	 * create/join while the user is already committed. Stale pending lobbies past
	 * their expiry are lazily cancelled here (same as the create/join guard), so a
	 * dead lobby resolves to `null` rather than trapping the user.
	 */
	async getMyLobby(userId: number): Promise<TournamentLobbyState | null> {
		const rows = await this.participantRepo.find({
			where: {
				userId,
				// Quitters ("Leave match") are out for good: they no longer count
				// as being in this tournament, so they may join/create a new one.
				hasLeft: false,
				tournament: { status: In(["pending", "active"]) },
			},
			relations: ["tournament"],
		});
		for (const row of rows) {
			const tournament = row.tournament;
			const record = tournament.state?.lobby as
				| TournamentLobbyRecord
				| undefined;
			if (!record) continue;
			if (await this.expireIfNeeded(tournament, record)) {
				continue; // stale lobby, now cancelled — no longer blocks the user
			}
			const participants = await this.loadParticipants(tournament.id);
			return this.toLobbyState(tournament, record, participants);
		}
		return null;
	}

	/**
	 * POST /tournaments/:id/invite — creator invites a friend. Reuses the
	 * platform invitation rails: FriendsService validates the friendship,
	 * NotificationsService persists + pushes the `tournament_invite` bell
	 * entry (SPEC-038: never reimplement invitations).
	 */
	async invite(
		tournamentId: string,
		inviterUserId: number,
		targetUserId: number,
	): Promise<TournamentLobbyState> {
		const tournament = await this.loadTournament(tournamentId);
		const record = this.getLobbyRecord(tournament);
		await this.assertOpenLobby(tournament, record);
		if (record.creatorUserId !== inviterUserId) {
			throw new ForbiddenException(
				"Only the lobby creator can send invitations",
			);
		}
		if (targetUserId === inviterUserId) {
			throw new BadRequestException("You cannot invite yourself");
		}

		const participants = await this.loadParticipants(tournament.id);
		if (participants.length >= TOURNAMENT_PLAYERS) {
			throw new ConflictException("This lobby is already full");
		}
		if (participants.some((p) => p.userId === targetUserId)) {
			throw new ConflictException("This user is already in the lobby");
		}

		// Guests are ephemeral and cannot durably receive notifications —
		// treat a guest target as not-found rather than leaking guest status
		// (same policy as FriendsService.sendRequest).
		const target = await this.userRepo.findOne({
			where: { id: targetUserId },
		});
		if (!target || target.isGuest) {
			throw new NotFoundException("User not found");
		}
		const friends = await this.friendsService.areFriends(
			inviterUserId,
			targetUserId,
		);
		if (!friends) {
			throw new ForbiddenException("You can only invite your friends");
		}
		await this.assertNotInAnotherTournament(targetUserId);

		if (!record.invitedUserIds.includes(targetUserId)) {
			record.invitedUserIds.push(targetUserId);
			await this.persistLobbyRecord(tournament, record);
		}

		const inviter = await this.userRepo
			.findOne({ where: { id: inviterUserId } })
			.catch(() => null);
		// Persisted bell entry + live push — non-fatal if it fails.
		await this.notifications
			.create("tournament_invite", inviterUserId, targetUserId, {
				tournamentId: tournament.id,
				username: inviter?.username ?? "",
			})
			.catch(() => undefined);

		const state = this.toLobbyState(tournament, record, participants);
		this.pushLobbyUpdate(state, "TournamentInviteSent");
		return state;
	}

	/**
	 * POST /tournaments/:id/add-cpu — the creator seats a CPU participant
	 * (CPU v2, user-approved SPEC-038 extension). A bot is a pooled user row
	 * on the reserved bot email domain, marked in `record.botUserIds`: the
	 * Runtime plays its board turns/gambling and the minigame adapter seats
	 * it as a `bot:` stand-in (it is never online). Same locked critical
	 * section as `join()` so a CPU can never overfill the lobby.
	 */
	async addCpu(
		tournamentId: string,
		requesterUserId: number,
	): Promise<TournamentLobbyState> {
		const tournament = await this.loadTournament(tournamentId);
		const record = this.getLobbyRecord(tournament);
		await this.assertOpenLobby(tournament, record);
		if (record.creatorUserId !== requesterUserId) {
			throw new ForbiddenException("Only the lobby creator can add a CPU");
		}

		const botUser = await this.acquireBotUser();

		const { tournament: locked, record: lockedRecord, participants, cause } =
			await this.withLockedTournament(tournament.id, async (manager, lockedTournament) => {
				const lockedRecord = this.getLobbyRecord(lockedTournament);
				const lockedParticipants = await this.loadParticipants(
					lockedTournament.id,
					manager,
				);
				if (lockedParticipants.length >= TOURNAMENT_PLAYERS) {
					throw new ConflictException("This lobby is already full");
				}
				if (lockedParticipants.some((p) => p.userId === botUser.id)) {
					throw new ConflictException("This CPU is already in the lobby");
				}

				const participantRepo = manager.getRepository(TournamentParticipant);
				await participantRepo.save(
					participantRepo.create({
						tournamentId: lockedTournament.id,
						userId: botUser.id,
						seat: lockedParticipants.length,
					}),
				);
				lockedRecord.botUserIds = [
					...(lockedRecord.botUserIds ?? []),
					botUser.id,
				];

				let all = await this.loadParticipants(lockedTournament.id, manager);
				let cause: TournamentLobbyEventName = "TournamentPlayerJoined";
				if (all.length === TOURNAMENT_PLAYERS) {
					all = await this.assignSeats(lockedTournament, lockedRecord, all, manager);
					cause = "TournamentLobbyCompleted";
				}
				await this.persistLobbyRecord(lockedTournament, lockedRecord, manager);

				return {
					tournament: lockedTournament,
					record: lockedRecord,
					participants: all,
					cause,
				};
			});

		const state = this.toLobbyState(locked, lockedRecord, participants);
		this.pushLobbyUpdate(state, cause);
		return state;
	}

	/**
	 * A free bot user row: pooled by the reserved email domain (unreachable
	 * via registration/OAuth — a real account can never be picked), skipping
	 * bots already seated in a pending/active tournament; created on demand
	 * with a collision-suffixed display name.
	 */
	private async acquireBotUser(): Promise<User> {
		const bots = await this.userRepo.find({
			where: { email: Like(`%@${TOURNAMENT_BOT_EMAIL_DOMAIN}`) },
		});
		for (const bot of bots) {
			const busy = await this.participantRepo.count({
				where: {
					userId: bot.id,
					tournament: { status: In(["pending", "active"]) },
				},
				relations: ["tournament"],
			});
			if (busy === 0) {
				return this.ensureBotProfile(bot);
			}
		}

		// Pool exhausted: mint a new bot account.
		const baseName =
			TOURNAMENT_BOT_NAMES[bots.length % TOURNAMENT_BOT_NAMES.length];
		for (let attempt = 0; attempt < 10; attempt++) {
			const suffix = attempt === 0 && bots.length < TOURNAMENT_BOT_NAMES.length
				? ""
				: ` ${bots.length + attempt + 1}`;
			try {
				const bot = await this.userRepo.save(
					this.userRepo.create({
						username: `${baseName}${suffix}`,
						email: `cpu-${Date.now()}-${attempt}@${TOURNAMENT_BOT_EMAIL_DOMAIN}`,
						isGuest: false,
						// Rankings Bug Audit N1: durable marker so bot accounts can
						// never rank on a public leaderboard or tournament board.
						isBot: true,
					}),
				);
				return await this.ensureBotProfile(bot);
			} catch (err) {
				// Unique-violation on the username: try the next suffix.
				if ((err as { code?: string })?.code !== "23505") throw err;
			}
		}
		throw new ConflictException("Could not allocate a CPU player");
	}

	/**
	 * Every user must own a Profile row — match-result persistence hard-fails
	 * without one (see GameResultsService). Real accounts get it in
	 * UsersService.create; bot accounts are minted here, so the invariant is
	 * enforced here too (and heals pre-existing profile-less bots).
	 */
	private async ensureBotProfile(bot: User): Promise<User> {
		const existing = await this.profileRepo.findOne({
			where: { user: { id: bot.id } },
		});
		if (!existing) {
			await this.profileRepo.save(this.profileRepo.create({ user: bot }));
		}
		return bot;
	}

	/** POST /tournaments/:id/join — accept an invitation. */
	async joinByInvite(
		tournamentId: string,
		userId: number,
	): Promise<TournamentLobbyState> {
		const tournament = await this.loadTournament(tournamentId);
		const record = this.getLobbyRecord(tournament);
		await this.assertOpenLobby(tournament, record);
		if (!record.invitedUserIds.includes(userId)) {
			throw new ForbiddenException(
				"You have not been invited to this tournament",
			);
		}
		return this.join(tournament, record, userId);
	}

	/** POST /tournaments/join-pin — join a pending lobby by its PIN. */
	async joinByPin(
		userId: number,
		rawPin: string,
	): Promise<TournamentLobbyState> {
		const pin = this.normalizePin(rawPin);
		this.assertValidPinShape(pin);

		const tournament = await this.findPendingByPin(pin);
		if (!tournament) {
			throw new NotFoundException(PIN_NOT_FOUND_MESSAGE);
		}
		const record = this.getLobbyRecord(tournament);
		await this.assertOpenLobby(tournament, record);
		return this.join(tournament, record, userId);
	}

	/**
	 * POST /tournaments/:id/leave — leave before start. If the creator
	 * leaves, the whole lobby is cancelled (SPEC-038).
	 */
	async leave(
		tournamentId: string,
		userId: number,
	): Promise<TournamentLobbyState> {
		const tournament = await this.loadTournament(tournamentId);
		const record = this.getLobbyRecord(tournament);
		await this.assertOpenLobby(tournament, record);

		const participants = await this.loadParticipants(tournament.id);
		const me = participants.find((p) => p.userId === userId);
		if (!me) {
			throw new NotFoundException("You are not in this lobby");
		}

		if (record.creatorUserId === userId) {
			// Creator leaving cancels the whole lobby (SPEC-038).
			return this.cancelLobby(tournament, record, participants);
		}

		await this.participantRepo.delete({ id: me.id });
		const remaining = participants.filter((p) => p.id !== me.id);
		if (record.seatsAssigned) {
			// The lobby is no longer complete — seats become provisional again
			// and will be re-derived from the seed on the next completion.
			record.seatsAssigned = false;
			await this.persistLobbyRecord(tournament, record);
		}

		const state = this.toLobbyState(tournament, record, remaining);
		// Include the leaver in the push so their other tabs resync too.
		this.pushLobbyUpdate(state, "TournamentPlayerLeft", [
			...remaining.map((p) => p.userId),
			userId,
		]);
		return state;
	}

	/**
	 * POST /tournaments/:id/start — creator only, exactly 5 players. Flips
	 * the row to `active`, assigns seed-derived seats if the completion path
	 * has not already done so, announces `tournament:starting`, and hands off
	 * to TournamentRuntimeService (SPEC-001/SPEC-023, Phase 1). The seat
	 * count and the status flip are re-validated under the tournament row
	 * lock (`withLockedTournament`) so a start can never race a concurrent
	 * join overfilling or half-filling the lobby.
	 */
	async start(
		tournamentId: string,
		userId: number,
	): Promise<TournamentLobbyState> {
		const tournament = await this.loadTournament(tournamentId);
		const record = this.getLobbyRecord(tournament);
		await this.assertOpenLobby(tournament, record);
		if (record.creatorUserId !== userId) {
			throw new ForbiddenException(
				"Only the lobby creator can start the tournament",
			);
		}

		const {
			tournament: locked,
			record: lockedRecord,
			participants,
		} = await this.withLockedTournament(tournamentId, async (manager, lockedTournament) => {
			const lockedRecord = this.getLobbyRecord(lockedTournament);
			if (lockedTournament.status !== "pending") {
				throw new ConflictException("This lobby is no longer open");
			}
			if (lockedRecord.creatorUserId !== userId) {
				throw new ForbiddenException(
					"Only the lobby creator can start the tournament",
				);
			}

			let lockedParticipants = await this.loadParticipants(
				lockedTournament.id,
				manager,
			);
			if (lockedParticipants.length !== TOURNAMENT_PLAYERS) {
				throw new ConflictException(
					`The lobby needs exactly ${TOURNAMENT_PLAYERS} players to start`,
				);
			}
			if (!lockedRecord.seatsAssigned) {
				lockedParticipants = await this.assignSeats(
					lockedTournament,
					lockedRecord,
					lockedParticipants,
					manager,
				);
			}

			lockedTournament.status = "active";
			lockedTournament.startedAt = new Date();
			await this.persistLobbyRecord(lockedTournament, lockedRecord, manager);

			return {
				tournament: lockedTournament,
				record: lockedRecord,
				participants: lockedParticipants,
			};
		});

		const state = this.toLobbyState(locked, lockedRecord, participants);
		this.pushLobbyUpdate(state, "TournamentStartRequested");

		const startingPayload: TournamentStartingPayload = {
			tournamentId: locked.id,
			turnOrder: deriveTurnOrder(
				lockedRecord.seed,
				this.memberIds(participants),
			),
		};
		for (const memberId of this.memberIds(participants)) {
			this.notifications.pushLiveEvent(
				TOURNAMENT_WS_EVENTS.STARTING,
				memberId,
				{ ...startingPayload },
			);
		}

		await this.runtimeService.startTournament(locked.id);

		// Snapshot-first sync (SPEC-022): attach the broadcaster to the live
		// Runtime so every authoritative change reaches the tournament room.
		// Optional so lobby unit tests need no sync wiring; production always
		// provides it via TournamentsModule.
		if (this.sync) {
			const runtime = this.runtimeService.getRuntime(locked.id);
			if (runtime) {
				await this.sync.attach(locked.id, runtime);
			}
		}

		return state;
	}

	// ── Join core ─────────────────────────────────────────────────────────────

	private async join(
		tournament: Tournament,
		record: TournamentLobbyRecord,
		userId: number,
	): Promise<TournamentLobbyState> {
		// Cross-tournament check: unrelated to this row's seat-overfill race,
		// left outside the lock (same as before).
		await this.assertNotInAnotherTournament(userId);

		const {
			tournament: locked,
			record: lockedRecord,
			participants,
			cause,
			wasInvited,
		} = await this.withLockedTournament(tournament.id, async (manager, lockedTournament) => {
			const lockedRecord = this.getLobbyRecord(lockedTournament);

			const lockedParticipants = await this.loadParticipants(
				lockedTournament.id,
				manager,
			);
			if (lockedParticipants.some((p) => p.userId === userId)) {
				throw new ConflictException("You are already in this lobby");
			}
			if (lockedParticipants.length >= TOURNAMENT_PLAYERS) {
				throw new ConflictException("This lobby is already full");
			}

			const participantRepo = manager.getRepository(TournamentParticipant);
			await participantRepo.save(
				participantRepo.create({
					tournamentId: lockedTournament.id,
					userId,
					// Provisional join-order seat; real seats are seed-derived at
					// completion. Exposed as null until then.
					seat: lockedParticipants.length,
				}),
			);
			// Reload with the user relation so the summary carries the username.
			let all = await this.loadParticipants(lockedTournament.id, manager);

			// The invitation (if any) is now consumed; the bell entry is cleared
			// outside the lock (best-effort, same as every other notification
			// call in this file).
			const invitedIdx = lockedRecord.invitedUserIds.indexOf(userId);
			const wasInvited = invitedIdx >= 0;
			if (wasInvited) {
				lockedRecord.invitedUserIds.splice(invitedIdx, 1);
			}

			let cause: TournamentLobbyEventName = "TournamentPlayerJoined";
			if (all.length === TOURNAMENT_PLAYERS) {
				all = await this.assignSeats(lockedTournament, lockedRecord, all, manager);
				cause = "TournamentLobbyCompleted";
			}
			await this.persistLobbyRecord(lockedTournament, lockedRecord, manager);

			return {
				tournament: lockedTournament,
				record: lockedRecord,
				participants: all,
				cause,
				wasInvited,
			};
		});

		if (wasInvited) {
			await this.notifications
				.removeWhere("tournament_invite", lockedRecord.creatorUserId, userId)
				.catch(() => undefined);
		}

		const state = this.toLobbyState(locked, lockedRecord, participants);
		this.pushLobbyUpdate(state, cause);
		return state;
	}

	/**
	 * Concurrency hardening (SPEC-023 accepted-risk closure): runs `work`
	 * inside a DB transaction after taking a `pessimistic_write` lock on the
	 * `tournaments` row, so concurrent joins/starts on the SAME tournament
	 * serialize instead of racing on a stale participant count — the 5-seat
	 * lobby can never be overfilled and `start()` can never race a `join()`.
	 * Same lock-then-mutate discipline as `AchievementsService.applyReward`
	 * (`lockUserForUpdate`).
	 */
	private async withLockedTournament<T>(
		tournamentId: string,
		work: (manager: EntityManager, tournament: Tournament) => Promise<T>,
	): Promise<T> {
		return this.dataSource.transaction(async (manager) => {
			const locked = await manager.getRepository(Tournament).findOne({
				where: { id: tournamentId },
				lock: { mode: "pessimistic_write" },
			});
			if (!locked) {
				throw new NotFoundException("Tournament not found");
			}
			return work(manager, locked);
		});
	}

	// ── Lobby lifecycle helpers ───────────────────────────────────────────────

	private async loadTournament(tournamentId: string): Promise<Tournament> {
		const tournament = await this.tournamentRepo.findOne({
			where: { id: tournamentId },
		});
		if (!tournament) {
			throw new NotFoundException("Tournament not found");
		}
		return tournament;
	}

	private getLobbyRecord(tournament: Tournament): TournamentLobbyRecord {
		const record = tournament.state?.lobby as
			| TournamentLobbyRecord
			| undefined;
		if (!record) {
			// A tournaments row without lobby data predates this flow (or was
			// created by a future phase); it cannot be operated as a lobby.
			throw new NotFoundException("Tournament lobby not found");
		}
		return record;
	}

	private async persistLobbyRecord(
		tournament: Tournament,
		record: TournamentLobbyRecord,
		manager?: EntityManager,
	): Promise<void> {
		tournament.state = { ...(tournament.state ?? {}), lobby: record };
		const repo = manager
			? manager.getRepository(Tournament)
			: this.tournamentRepo;
		await repo.save(tournament);
	}

	/**
	 * Lazy expiry (ruling #5): a pending lobby past its deadline is flipped
	 * to `cancelled` on the spot — persisted, and members are notified.
	 * Returns true if the lobby was (or already had been) expired-cancelled.
	 */
	private async expireIfNeeded(
		tournament: Tournament,
		record: TournamentLobbyRecord,
	): Promise<boolean> {
		if (tournament.status !== "pending") return false;
		if (Date.now() < new Date(record.expiresAt).getTime()) return false;

		const participants = await this.loadParticipants(tournament.id);
		await this.cancelLobby(tournament, record, participants);
		return true;
	}

	/**
	 * Cancel a pending lobby (creator left, or expiry). Participant rows are
	 * kept for the historical record; the row status is the source of truth.
	 */
	private async cancelLobby(
		tournament: Tournament,
		record: TournamentLobbyRecord,
		participants: TournamentParticipant[],
	): Promise<TournamentLobbyState> {
		tournament.status = "cancelled";
		tournament.finishedAt = new Date();
		await this.persistLobbyRecord(tournament, record);

		const state = this.toLobbyState(tournament, record, participants);
		this.pushLobbyUpdate(state, "TournamentLobbyCancelled");
		return state;
	}

	/** Throws unless the lobby is a live (pending, unexpired) one. */
	private async assertOpenLobby(
		tournament: Tournament,
		record: TournamentLobbyRecord,
	): Promise<void> {
		if (await this.expireIfNeeded(tournament, record)) {
			throw new ConflictException("This lobby has expired");
		}
		if (tournament.status !== "pending") {
			throw new ConflictException("This lobby is no longer open");
		}
	}

	/**
	 * One lobby/tournament per user at a time (SPEC-038, same rule as queues
	 * and matches): reject if the user already sits in any pending/active
	 * tournament. A pending row past its expiry deadline is lazily cancelled
	 * here too, so a stale lobby never blocks its members.
	 */
	private async assertNotInAnotherTournament(userId: number): Promise<void> {
		const rows = await this.participantRepo.find({
			where: {
				userId,
				// Quitters ("Leave match") are out for good: they no longer count
				// as being in this tournament, so they may join/create a new one.
				hasLeft: false,
				tournament: { status: In(["pending", "active"]) },
			},
			relations: ["tournament"],
		});
		for (const row of rows) {
			const record = row.tournament.state?.lobby as
				| TournamentLobbyRecord
				| undefined;
			if (
				record &&
				(await this.expireIfNeeded(row.tournament, record))
			) {
				continue; // stale lobby, now cancelled — does not block
			}
			throw new ConflictException(
				"You are already in a tournament lobby or game",
			);
		}
	}

	/**
	 * Mark a participant as having quit the match for good (tournament:quit /
	 * the "Leave match" button). Persisted so the one-tournament-per-user gate
	 * (`assertNotInAnotherTournament`) and `getMyLobby` stop counting them in
	 * this tournament — the player is free to create/join a new one, and can
	 * never rejoin this one. The quit is recorded as a `forfeit` and counts as
	 * a loss on the player's overall record (a bare stat bump — no consolation
	 * XP/coins for quitting). Idempotent-ish: the row update is a no-op if the
	 * row is gone; the loss is only recorded when the row actually flips (so a
	 * repeated quit never double-counts).
	 */
	async markParticipantLeft(
		tournamentId: string,
		userId: number,
	): Promise<void> {
		const result = await this.participantRepo.update(
			// Only the first quit flips the row (hasLeft was false) — this makes
			// the loss below fire exactly once even on a repeated tournament:quit.
			{ tournamentId, userId, hasLeft: false },
			{ hasLeft: true, outcome: "forfeit" },
		);
		if (!result.affected) {
			return;
		}
		const profile = await this.profileRepo.findOne({
			where: { user: { id: userId } },
		});
		if (profile) {
			profile.totalLosses += 1;
			profile.gamesPlayed += 1;
			await this.profileRepo.save(profile);
		}
	}

	// ── Seats & turn order ────────────────────────────────────────────────────

	/**
	 * Derive the definitive seats from the persisted seed (ruling #2) and
	 * store them on the participant rows. Returns the participants with
	 * their final seats, in seat order.
	 */
	private async assignSeats(
		tournament: Tournament,
		record: TournamentLobbyRecord,
		participants: TournamentParticipant[],
		manager?: EntityManager,
	): Promise<TournamentParticipant[]> {
		const order = deriveTurnOrder(
			record.seed,
			this.memberIds(participants),
		);
		for (const participant of participants) {
			if (participant.userId === null) continue;
			participant.seat = order.indexOf(participant.userId);
		}
		const repo = manager
			? manager.getRepository(TournamentParticipant)
			: this.participantRepo;
		await repo.save(participants);
		record.seatsAssigned = true;
		return [...participants].sort((a, b) => a.seat - b.seat);
	}

	private memberIds(participants: TournamentParticipant[]): number[] {
		return participants
			.map((p) => p.userId)
			.filter((id): id is number => id !== null);
	}

	// ── PIN helpers (mold: PrivateLobbiesService, ruling #2 of seams audit) ───

	private normalizePin(pin: string): string {
		return String(pin ?? "")
			.trim()
			.toUpperCase();
	}

	private assertValidPinShape(pin: string): void {
		const body = pin.slice(TOURNAMENT_PIN_PREFIX.length);
		const bodyValid = [...body].every((char) =>
			TOURNAMENT_PIN_ALPHABET.includes(char),
		);
		if (
			pin.length !== TOURNAMENT_PIN_LENGTH ||
			!pin.startsWith(TOURNAMENT_PIN_PREFIX) ||
			!bodyValid
		) {
			// Same message as an unknown PIN: shape validity is not leaked.
			throw new NotFoundException(PIN_NOT_FOUND_MESSAGE);
		}
	}

	private async findPendingByPin(pin: string): Promise<Tournament | null> {
		return this.tournamentRepo
			.createQueryBuilder("tournament")
			.where("tournament.status = :status", { status: "pending" })
			.andWhere("tournament.state -> 'lobby' ->> 'pin' = :pin", { pin })
			.getOne();
	}

	private async generateUniquePin(): Promise<string> {
		for (let i = 0; i < PIN_GENERATION_MAX_ATTEMPTS; i++) {
			const body = Array.from(
				{ length: TOURNAMENT_PIN_LENGTH - TOURNAMENT_PIN_PREFIX.length },
				() =>
					TOURNAMENT_PIN_ALPHABET[
						Math.floor(Math.random() * TOURNAMENT_PIN_ALPHABET.length)
					],
			).join("");
			const pin = TOURNAMENT_PIN_PREFIX + body;
			if (!(await this.findPendingByPin(pin))) return pin;
		}
		throw new ConflictException(
			"Could not allocate a tournament PIN — try again",
		);
	}

	// ── Wire mapping & realtime ───────────────────────────────────────────────

	private async loadParticipants(
		tournamentId: string,
		manager?: EntityManager,
	): Promise<TournamentParticipant[]> {
		const repo = manager
			? manager.getRepository(TournamentParticipant)
			: this.participantRepo;
		return repo.find({
			where: { tournamentId },
			relations: ["user"],
			order: { seat: "ASC" },
		});
	}

	private async buildLobbyState(
		tournament: Tournament,
		record: TournamentLobbyRecord,
	): Promise<TournamentLobbyState> {
		const participants = await this.loadParticipants(tournament.id);
		return this.toLobbyState(tournament, record, participants);
	}

	private toLobbyState(
		tournament: Tournament,
		record: TournamentLobbyRecord,
		participants: TournamentParticipant[],
	): TournamentLobbyState {
		const botIds = new Set(record.botUserIds ?? []);
		return {
			id: tournament.id,
			status: tournament.status,
			pin: record.pin,
			creatorUserId: record.creatorUserId,
			participants: participants.map((participant) => {
				const isBot =
					participant.userId !== null && botIds.has(participant.userId);
				return {
					userId: participant.userId,
					username: participant.user?.username ?? "",
					seat: record.seatsAssigned ? participant.seat : null,
					// Phase 0 approximation of "connected to the lobby room":
					// coarse presence. CPUs are server-driven ⇒ always ready.
					ready:
						isBot ||
						(participant.userId !== null &&
							this.presence.isOnline(participant.userId)),
					isBot,
				};
			}),
			createdAt: tournament.createdAt.toISOString(),
			expiresAt: record.expiresAt,
		};
	}

	/**
	 * Ephemeral `tournament:lobby-updated` push to every current member
	 * (Phase 0 realtime goes through NotificationsService only, ruling #3).
	 */
	private pushLobbyUpdate(
		state: TournamentLobbyState,
		cause: TournamentLobbyEventName,
		memberIds?: (number | null)[],
	): void {
		const payload: TournamentLobbyUpdatedPayload = { lobby: state, cause };
		const targets =
			memberIds ?? state.participants.map((p) => p.userId);
		for (const memberId of targets) {
			if (memberId === null) continue;
			this.notifications.pushLiveEvent(
				TOURNAMENT_WS_EVENTS.LOBBY_UPDATED,
				memberId,
				{ ...payload },
			);
		}
	}
}
