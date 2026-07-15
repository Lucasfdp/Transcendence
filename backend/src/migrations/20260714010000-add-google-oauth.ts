import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGoogleOauth20260714010000 implements MigrationInterface {
	name = "AddGoogleOauth20260714010000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS "googleId" VARCHAR UNIQUE
    `);
		await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS "githubId"
    `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS "githubId" VARCHAR UNIQUE
    `);
		await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS "googleId"
    `);
	}
}
