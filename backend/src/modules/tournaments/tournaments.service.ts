import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Tournament } from "./entities/tournament.entity";
import { TournamentMatch } from "./entities/tournament-match.entity";
import { TournamentParticipant } from "./entities/tournament-participant.entity";

@Injectable()
export class TournamentsService implements OnModuleInit {
	private readonly logger = new Logger(TournamentsService.name);

	constructor(
		@InjectRepository(Tournament)
		private readonly tournamentRepo: Repository<Tournament>,
		@InjectRepository(TournamentParticipant)
		private readonly participantRepo: Repository<TournamentParticipant>,
		@InjectRepository(TournamentMatch)
		private readonly tournamentMatchRepo: Repository<TournamentMatch>,
	) {}

	/**
	 * v1 server-restart policy (SPEC-023): in-flight tournaments cannot
	 * survive a restart, so any `pending`/`active` rows found at boot are
	 * orphans from a previous process and get marked `cancelled` — same
	 * pattern as `GameSessionService.onModuleInit` for stale matches.
	 */
	async onModuleInit(): Promise<void> {
		try {
			const updated = await this.tournamentRepo.update(
				{ status: In(["pending", "active"]) },
				{ status: "cancelled" },
			);
			this.logger.log(
				`Boot cleanup: marked ${updated.affected ?? 0} stale tournaments as cancelled`,
			);
		} catch (err: unknown) {
			// Postgres 42P01: table does not exist — fresh DB before migrations run.
			// Safe to skip; migrations will create the table on first run.
			const pg = err as { code?: string };
			if (pg?.code === "42P01") {
				this.logger.log(
					"Boot cleanup skipped — tournaments table not yet created (fresh database)",
				);
				return;
			}
			this.logger.error("Boot cleanup failed unexpectedly", err);
			throw err;
		}
	}
}
