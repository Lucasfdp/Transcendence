import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWagers20260628000000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS wagers (
        id               SERIAL PRIMARY KEY,
        "userId"         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mode             VARCHAR      NOT NULL,
        stake            INTEGER      NOT NULL,
        paid             INTEGER      NOT NULL,
        "segmentId"      VARCHAR      NOT NULL,
        multiplier       REAL         NOT NULL,
        payout           INTEGER      NOT NULL,
        net              INTEGER      NOT NULL,
        "serverSeedHash" VARCHAR      NOT NULL,
        "serverSeed"     VARCHAR      NOT NULL,
        "clientSeed"     VARCHAR      NOT NULL DEFAULT '',
        nonce            INTEGER      NOT NULL,
        "createdAt"      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

		await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wagers_user_createdAt"
        ON wagers ("userId", "createdAt")
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_wagers_user_createdAt"`,
		);
		await queryRunner.query(`DROP TABLE IF EXISTS wagers`);
	}
}
