import { MigrationInterface, QueryRunner } from "typeorm";

export class UnifyReplayContractV220260714000000 implements MigrationInterface {
	name = "UnifyReplayContractV220260714000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DELETE FROM match_replay_saves`);
		await queryRunner.query(`DELETE FROM match_replays`);
		await queryRunner.query(`
			ALTER TABLE match_replays
			ADD COLUMN "contractVersion" SMALLINT NOT NULL DEFAULT 2,
			ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
			ADD COLUMN "durationMs" INTEGER NOT NULL DEFAULT 0
		`);
		await queryRunner.query(`
			ALTER TABLE match_replays
			ALTER COLUMN "contractVersion" DROP DEFAULT,
			ALTER COLUMN metadata DROP DEFAULT,
			ALTER COLUMN "durationMs" DROP DEFAULT
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE match_replays
			DROP COLUMN "durationMs",
			DROP COLUMN metadata,
			DROP COLUMN "contractVersion"
		`);
	}
}
