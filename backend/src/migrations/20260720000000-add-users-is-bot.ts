import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Rankings Bug Audit N1 (2026-07-20 follow-up): adds a durable `isBot`
 * marker for tournament CPU accounts. `tournament-lobby.service.ts`'s
 * `acquireBotUser` mints CPU participants as ordinary `users` rows
 * (`isGuest: false`) so their tournament minigame results persist through
 * the normal reward pipeline (`GameSessionService.persistFinishedRoom` →
 * `GameResultsService.submitResult`) — but neither leaderboard query filters
 * anything other than `isGuest`/`isDevAccount`, so a CPU could rank on the
 * public boards and even "win" a tournament.
 *
 * Backfills existing bot rows by their reserved, unreachable-via-
 * registration/OAuth email domain (`TOURNAMENT_BOT_EMAIL_DOMAIN` in
 * `tournaments.constants.ts`) — the only accounts that domain can ever
 * belong to.
 */
export class AddUsersIsBot20260720000000 implements MigrationInterface {
	name = "AddUsersIsBot20260720000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "users"
			ADD COLUMN IF NOT EXISTS "isBot" BOOLEAN NOT NULL DEFAULT false
		`);
		await queryRunner.query(`
			UPDATE "users"
			SET "isBot" = true
			WHERE "email" LIKE '%@bots.tournament.local'
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "users"
			DROP COLUMN IF EXISTS "isBot"
		`);
	}
}
