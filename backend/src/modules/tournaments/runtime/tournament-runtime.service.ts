/**
 * tournament-runtime.service.ts — DI wrapper around TournamentRuntime
 * (SPEC-001) and its persistence, wired into the Match Lifecycle
 * (SPEC-023).
 *
 * This is the ONLY place that lets the Runtime touch the database: it owns
 * the persistence port (`onSnapshot`) and translates every Runtime snapshot
 * into `tournaments.state.runtime` (jsonb) plus the SPEC-023
 * Lifecycle/StateMachine/status correspondence table. The Runtime class
 * itself never imports TypeORM.
 *
 * Settings resolution follows SPEC-024/025: configuration is never
 * hardcoded, it is resolved by id through a Registry<TournamentSettings>
 * populated at construction with the v1 catalog.
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { DataSource } from "typeorm";
import { User } from "../../users/entities/user.entity";
import { lockUserForUpdate } from "../../users/user-lock.util";
import { TOURNAMENT_CHAMPION_COINS } from "../tournaments.constants";
import { TournamentMinigameAdapter } from "../tournament-minigame.adapter";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TournamentSettings, TOURNAMENT_SETTINGS_V1 } from "../config/settings.catalog";
import { validateTournamentSettings } from "../config/config.validator";
import { Tournament, TournamentStatus } from "../entities/tournament.entity";
import { TournamentParticipant } from "../entities/tournament-participant.entity";
import { SystemClock, TournamentClock } from "../infra/clock";
import { Registry } from "../registry/registry";
import { TournamentPhase } from "../state-machine/tournament-phase";
import { TournamentLobbyRecord } from "../tournament-lobby.service";
import {
	TournamentRuntime,
	TournamentRuntimeSnapshot,
} from "./tournament-runtime";

/** Injectable factory token so tests can supply a ManualClock (SPEC-028). */
export const TOURNAMENT_RUNTIME_CLOCK_FACTORY = Symbol(
	"TOURNAMENT_RUNTIME_CLOCK_FACTORY",
);
export type TournamentClockFactory = () => TournamentClock;

interface PhaseStatusMapping {
	readonly status: TournamentStatus;
	/** Whether the Runtime instance must be dropped from the live map. */
	readonly terminal: boolean;
}

/**
 * SPEC-023 "Relación con la State Machine del Runtime y el status en BD"
 * correspondence table, keyed by State Machine phase (SPEC-003):
 *
 * | Match Lifecycle | State Machine        | tournaments.status |
 * | Creating        | CREATED               | pending    |
 * | WaitingPlayers   | WAITING_PLAYERS       | pending    |
 * | Loading          | INITIALIZING          | active     |
 * | Running          | ROUND_START … REWARDS | active     |
 * | Finished/Closed  | FINISHED               | finished   |
 * | Cancelación      | CANCELLED              | cancelled  |
 *
 * DEFEAT is not listed in the table on its own: it is the pass-through
 * phase that DECIDES "no winner" right before the machine formally reaches
 * FINISHED (see TournamentRuntime.resolveCheckKeyItems), so it maps to the
 * same bucket as every other in-progress "Running" phase — `active` — and
 * only flips to `finished` once the machine actually reports FINISHED.
 */
export function mapTournamentPhaseToStatus(
	phase: TournamentPhase,
): PhaseStatusMapping {
	switch (phase) {
		case "CREATED":
		case "WAITING_PLAYERS":
			return { status: "pending", terminal: false };
		case "FINISHED":
			return { status: "finished", terminal: true };
		case "CANCELLED":
			return { status: "cancelled", terminal: true };
		default:
			// INITIALIZING, ROUND_START … REWARDS, and the DEFEAT pass-through.
			return { status: "active", terminal: false };
	}
}

@Injectable()
export class TournamentRuntimeService {
	private readonly logger = new Logger(TournamentRuntimeService.name);
	private readonly runtimes = new Map<string, TournamentRuntime>();
	/** Serializes snapshot writes per tournament (avoids out-of-order saves). */
	private readonly writeChains = new Map<string, Promise<void>>();
	private readonly settingsRegistry = new Registry<TournamentSettings>(
		"tournament-settings",
		validateTournamentSettings,
	);
	private readonly clockFactory: TournamentClockFactory;

	constructor(
		@InjectRepository(Tournament)
		private readonly tournamentRepo: Repository<Tournament>,
		@InjectRepository(TournamentParticipant)
		private readonly participantRepo: Repository<TournamentParticipant>,
		@Optional()
		@Inject(TOURNAMENT_RUNTIME_CLOCK_FACTORY)
		clockFactory?: TournamentClockFactory,
		// Optional so unit specs need no matchmaking wiring; production always
		// provides it via TournamentsModule → real minigames per round.
		@Optional()
		private readonly minigameAdapter?: TournamentMinigameAdapter,
		// Optional so unit specs need no live DataSource; required for the
		// persistent champion prize (SPEC-037/D10) in production.
		@Optional()
		private readonly dataSource?: DataSource,
	) {
		this.clockFactory = clockFactory ?? ((): TournamentClock => new SystemClock());
		// v1 catalog (SPEC-024/025): the only configId new tournaments stamp
		// today. Future catalogs are registered here as they ship.
		this.settingsRegistry.register(TOURNAMENT_SETTINGS_V1);
	}

	/**
	 * Loads the tournament row + participants, resolves its settings by
	 * `configId` and starts a fresh Runtime for it (SPEC-023 "Initialize
	 * Runtime" pipeline step). Wires the persistence port so every Runtime
	 * transition updates `tournaments.state.runtime` (preserving
	 * `state.lobby`) and maps phase → status per the table above. Resolves
	 * once every snapshot triggered by `runtime.start()` has been persisted.
	 */
	async startTournament(tournamentId: string): Promise<void> {
		const tournament = await this.tournamentRepo.findOne({
			where: { id: tournamentId },
		});
		if (!tournament) {
			throw new NotFoundException("Tournament not found");
		}

		const settings = this.settingsRegistry.get(tournament.configId);
		if (!settings) {
			throw new BadRequestException(
				`Unknown tournament settings configId "${tournament.configId}"`,
			);
		}

		const lobby = tournament.state?.lobby as TournamentLobbyRecord | undefined;
		if (!lobby) {
			throw new BadRequestException(
				"Tournament has no lobby state to start the Runtime from",
			);
		}

		const participants = await this.participantRepo.find({
			where: { tournamentId },
			order: { seat: "ASC" },
		});
		const participantIds = participants
			.map((p) => p.userId)
			.filter((id): id is number => id !== null);

		const runtime = new TournamentRuntime({
			tournamentId,
			seed: lobby.seed,
			participantIds,
			settings,
			clock: this.clockFactory(),
			// Production tournaments run interactively (Vertical Slice, SPEC-022):
			// PLAYER_TURNS drives real board turns from client intents, with the
			// Turn System's roll timeout keeping unattended games progressing.
			interactiveTurns: true,
			// CPU participants seated in the lobby (CPU v2): the Runtime plays
			// their board turns and gambling decisions.
			botPlayerIds: lobby.botUserIds ?? [],
			// The socket-bound SPEC-015 adapter (launch/lifecycle/reconcile/catalog
			// over the real platform); absent in unit tests ⇒ inert minigames.
			minigamePorts: this.minigameAdapter
				? {
						launcher: this.minigameAdapter,
						lifecycle: this.minigameAdapter,
						reconciler: this.minigameAdapter,
						catalog: this.minigameAdapter,
				  }
				: undefined,
			onSnapshot: (snapshot) => {
				this.enqueueSnapshotWrite(tournamentId, () =>
					this.applySnapshot(tournament, lobby, snapshot),
				);
			},
		});
		this.runtimes.set(tournamentId, runtime);

		runtime.start();

		await this.flush(tournamentId);
	}

	/**
	 * Cancels a live Runtime (SPEC-023: the Match Lifecycle is the only
	 * requester of CANCELLED). If no Runtime instance is live for this
	 * tournament — it never started, or the process restarted (v1: in-flight
	 * tournaments are not resumed, TournamentsService.onModuleInit already
	 * cancels them) — the row is flipped directly.
	 */
	async cancelTournament(tournamentId: string, reason: string): Promise<void> {
		const runtime = this.runtimes.get(tournamentId);
		if (runtime) {
			runtime.cancel(reason);
			await this.flush(tournamentId);
			return;
		}

		const tournament = await this.tournamentRepo.findOne({
			where: { id: tournamentId },
		});
		if (!tournament) {
			throw new NotFoundException("Tournament not found");
		}
		if (tournament.status === "finished" || tournament.status === "cancelled") {
			return;
		}
		tournament.status = "cancelled";
		tournament.finishedAt = new Date();
		await this.tournamentRepo.save(tournament);
	}

	/** Whether a live Runtime instance exists for this tournament. */
	hasRuntime(tournamentId: string): boolean {
		return this.runtimes.has(tournamentId);
	}

	/**
	 * The live Runtime for a tournament, if any (gateway/sync access: intents
	 * are forwarded to it and snapshots are built from its engines, SPEC-022).
	 */
	getRuntime(tournamentId: string): TournamentRuntime | undefined {
		return this.runtimes.get(tournamentId);
	}

	// ── Persistence port ─────────────────────────────────────────────────

	private async applySnapshot(
		tournament: Tournament,
		lobby: TournamentLobbyRecord,
		snapshot: TournamentRuntimeSnapshot,
	): Promise<void> {
		tournament.state = { ...(tournament.state ?? {}), lobby, runtime: snapshot };
		const mapping = mapTournamentPhaseToStatus(snapshot.machine.phase);
		tournament.status = mapping.status;
		if (mapping.status === "finished") {
			tournament.finishedAt = new Date();
			// The champion once VICTORY resolved (SPEC-021), or null on the
			// collective-DEFEAT exit (SPEC-001 DEFEAT: "winnerUserId queda nulo").
			tournament.winnerUserId = snapshot.winnerUserId;
			if (snapshot.winnerUserId !== null) {
				await this.grantChampionReward(tournament, snapshot.winnerUserId);
			}
		} else if (mapping.status === "cancelled") {
			tournament.finishedAt = new Date();
		}

		try {
			await this.tournamentRepo.save(tournament);
		} catch (err) {
			this.logger.error(
				`Failed to persist Runtime snapshot for tournament ${tournament.id}`,
				err instanceof Error ? err.stack : String(err),
			);
			throw err;
		}

		if (mapping.terminal) {
			this.runtimes.delete(tournament.id);
		}
	}

	/**
	 * The persistent champion prize (SPEC-037/D10): 500 coins to the winner,
	 * exactly once per tournament (idempotency marker inside `state`), under
	 * `lockUserForUpdate` so concurrent coin writers never race. The durable
	 * champion badge is the `tournament-champion` achievement, unlocked by the
	 * platform's normal lazy evaluation off `tournaments.winnerUserId`. A
	 * failed grant is logged and NEVER breaks the snapshot write.
	 */
	private async grantChampionReward(
		tournament: Tournament,
		winnerId: number,
	): Promise<void> {
		const state = (tournament.state ?? {}) as Record<string, unknown>;
		if (state.championReward !== undefined || !this.dataSource) {
			return;
		}
		try {
			await this.dataSource.transaction(async (manager) => {
				const user = await lockUserForUpdate(manager, winnerId);
				user.coins += TOURNAMENT_CHAMPION_COINS;
				await manager.getRepository(User).save(user);
			});
			tournament.state = {
				...state,
				championReward: {
					userId: winnerId,
					coins: TOURNAMENT_CHAMPION_COINS,
					grantedAt: new Date().toISOString(),
				},
			};
			this.logger.log(
				`Champion reward granted: ${TOURNAMENT_CHAMPION_COINS} coins to user ${winnerId} (tournament ${tournament.id})`,
			);
		} catch (err) {
			this.logger.error(
				`Failed to grant champion reward for tournament ${tournament.id}`,
				err instanceof Error ? err.stack : String(err),
			);
		}
	}

	/** Serializes writes per tournament so async saves can never race/reorder. */
	private enqueueSnapshotWrite(
		tournamentId: string,
		work: () => Promise<void>,
	): void {
		const prior = this.writeChains.get(tournamentId) ?? Promise.resolve();
		const next = prior.then(work);
		this.writeChains.set(tournamentId, next);
	}

	private async flush(tournamentId: string): Promise<void> {
		await (this.writeChains.get(tournamentId) ?? Promise.resolve());
		if (!this.runtimes.has(tournamentId)) {
			this.writeChains.delete(tournamentId);
		}
	}
}
