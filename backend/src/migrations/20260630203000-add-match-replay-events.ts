import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMatchReplayEvents20260630203000
	implements MigrationInterface
{
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE match_replays
			ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]'
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE match_replays
			DROP COLUMN IF EXISTS events
		`);
	}
}
