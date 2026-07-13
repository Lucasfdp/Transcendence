import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Server-authored Three-Shell Monte shuffle.
 *
 * Adds the slot/shuffle columns the new flow needs. All nullable so rounds
 * written by the previous (client-shuffle) code keep loading — those rows are
 * never re-resolved (any still pending are expired by TTL), so the null slots
 * are inert history.
 */
export class MonteServerShuffle20260712120000 implements MigrationInterface {
	name = "MonteServerShuffle20260712120000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "casino_monte_rounds"
				ADD COLUMN IF NOT EXISTS "ballStartSlot" integer NULL DEFAULT NULL,
				ADD COLUMN IF NOT EXISTS "winningSlot" integer NULL DEFAULT NULL,
				ADD COLUMN IF NOT EXISTS "shuffle" jsonb NULL DEFAULT NULL,
				ADD COLUMN IF NOT EXISTS "stepCount" integer NULL DEFAULT NULL,
				ADD COLUMN IF NOT EXISTS "commitHash" varchar NULL DEFAULT NULL
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "casino_monte_rounds"
				DROP COLUMN IF EXISTS "commitHash",
				DROP COLUMN IF EXISTS "stepCount",
				DROP COLUMN IF EXISTS "shuffle",
				DROP COLUMN IF EXISTS "winningSlot",
				DROP COLUMN IF EXISTS "ballStartSlot"
		`);
	}
}
