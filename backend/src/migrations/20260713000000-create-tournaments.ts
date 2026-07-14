import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the Tournament persistence tables (SPEC-037 / SPEC-023):
 *
 * - `tournaments`: session row with status, config catalog id and the
 *   serialized Runtime snapshot (jsonb) so the session is reconstructible
 *   from Postgres.
 * - `tournament_participants`: one row per seat; user FK is SET NULL
 *   (same pattern as `match_players`).
 * - `tournament_matches`: bridge table linking each minigame to its
 *   `matches` row per round — no new MatchMode is introduced.
 *
 * Column set mirrors `modules/tournaments/entities/*` exactly. Manual
 * migration is mandatory (like `user_cards`): `synchronize` only covers dev.
 */
export class CreateTournaments20260713000000 implements MigrationInterface {
	name = "CreateTournaments20260713000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "tournaments" (
				"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				"status" varchar NOT NULL DEFAULT 'pending',
				"configId" varchar NOT NULL,
				"state" jsonb NULL DEFAULT NULL,
				"winnerUserId" integer NULL REFERENCES "users"("id") ON DELETE SET NULL,
				"createdAt" timestamptz NOT NULL DEFAULT now(),
				"startedAt" timestamptz NULL DEFAULT NULL,
				"finishedAt" timestamptz NULL DEFAULT NULL
			)
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_tournaments_winnerUserId"
			ON "tournaments" ("winnerUserId")
		`);

		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "tournament_participants" (
				"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				"tournamentId" uuid NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
				"userId" integer NULL REFERENCES "users"("id") ON DELETE SET NULL,
				"seat" integer NOT NULL,
				"finalPoints" integer NOT NULL DEFAULT 0,
				"outcome" varchar NULL DEFAULT NULL
			)
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_tournament_participants_tournamentId"
			ON "tournament_participants" ("tournamentId")
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_tournament_participants_userId"
			ON "tournament_participants" ("userId")
		`);

		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "tournament_matches" (
				"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				"tournamentId" uuid NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
				"matchId" uuid NOT NULL REFERENCES "matches"("id") ON DELETE CASCADE,
				"round" integer NOT NULL,
				"purpose" varchar NOT NULL
			)
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_tournament_matches_tournamentId"
			ON "tournament_matches" ("tournamentId")
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_tournament_matches_matchId"
			ON "tournament_matches" ("matchId")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_tournament_matches_matchId"`,
		);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_tournament_matches_tournamentId"`,
		);
		await queryRunner.query(`DROP TABLE IF EXISTS "tournament_matches"`);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_tournament_participants_userId"`,
		);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_tournament_participants_tournamentId"`,
		);
		await queryRunner.query(`DROP TABLE IF EXISTS "tournament_participants"`);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_tournaments_winnerUserId"`,
		);
		await queryRunner.query(`DROP TABLE IF EXISTS "tournaments"`);
	}
}
