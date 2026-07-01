import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the reports table. Reporting a user always auto-blocks them
 * (see ReportsService.create) — this table exists purely for moderation
 * history, it does not gate the block itself.
 *
 * Column names are camelCase to match the newer-table convention (see
 * wagers, matchReplays) rather than the older snake_case friendships table.
 */
export class CreateReports20260701010000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id           SERIAL PRIMARY KEY,
        "reporterId" INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "reportedId" INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category     VARCHAR(32)  NOT NULL,
        message      TEXT         NULL,
        "createdAt"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_no_self_report CHECK ("reporterId" <> "reportedId")
      )
    `);

		await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reports_reportedId"
        ON reports ("reportedId")
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reports_reportedId"`);
		await queryRunner.query(`DROP TABLE IF EXISTS reports`);
	}
}
