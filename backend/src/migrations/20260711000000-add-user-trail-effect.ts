import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserTrailEffect20260711000000 implements MigrationInterface {
	name = "AddUserTrailEffect20260711000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS "trailEffect" VARCHAR NOT NULL DEFAULT 'trail_classic'
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS "trailEffect"
    `);
	}
}
